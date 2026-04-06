import bcrypt from 'bcryptjs';
import { MongoClient, ObjectId } from 'mongodb';
import { ROLES, getRolePermissions } from './permissions.js';
import { decryptValue, encryptValue } from './secure-settings.js';
import { listWebmailEnvEntries } from './env-file-manager.js';

const ADMIN_USERS = 'admin_users';
const ADMIN_AUDIT_LOGS = 'admin_audit_logs';
const ADMIN_SETTINGS = 'admin_settings';
const ADMIN_SUPPORT_NOTES = 'admin_support_notes';
const BILLING_ACCOUNTS = 'billing_accounts';
const BILLING_PAYMENTS = 'billing_payments';
const BILLING_PLANS = 'billing_plans';
const MARKETING_RECIPIENTS = 'marketing_recipients';
const MARKETING_SENDER_PROFILES = 'marketing_sender_profiles';
const MARKETING_CAMPAIGNS = 'marketing_campaigns';
const WILDDUCK_USERS = 'users';
const SHARED_WEBMAIL_ENV_KEYS = new Set([
  'ADMIN_NOTIFICATION_EMAILS',
  'ADMIN_NOTIFICATION_FROM',
  'ADMIN_NOTIFICATION_SMTP_HOST',
  'ADMIN_NOTIFICATION_SMTP_PORT',
  'ADMIN_NOTIFICATION_SMTP_SECURE',
  'ADMIN_NOTIFICATION_SMTP_USER',
  'ADMIN_NOTIFICATION_SMTP_PASS',
  'AUTHORIZE_API_LOGIN_ID',
  'AUTHORIZE_TRANSACTION_KEY',
  'AUTHORIZE_CLIENT_KEY',
  'AUTHORIZE_SIGNATURE_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'STRIPE_SECRET_KEY'
]);

const SETTINGS_DEFINITIONS = [
  {
    key: 'OPS_PRIMARY_DOMAIN',
    label: 'Primary Mail Domain',
    description: 'Primary domain used for mailbox creation and service identity.',
    sensitive: false
  },
  {
    key: 'OPS_WEB_HOSTS',
    label: 'Web Hostnames',
    description: 'Comma-separated hostnames routed to the webmail frontend.',
    sensitive: false
  },
  {
    key: 'OPS_IMAP_HOST',
    label: 'IMAP Hostname',
    description: 'Hostname shown to users for IMAP setup.',
    sensitive: false
  },
  {
    key: 'OPS_POP3_HOST',
    label: 'POP3 Hostname',
    description: 'Hostname shown to users for POP3 setup.',
    sensitive: false
  },
  {
    key: 'OPS_SMTP_HOST',
    label: 'SMTP Hostname',
    description: 'Hostname shown to users for SMTP setup.',
    sensitive: false
  },
  {
    key: 'OPS_ALLOWED_SIGNUP_DOMAINS',
    label: 'Allowed Signup Domains',
    description: 'Comma-separated domains allowed for mailbox creation.',
    sensitive: false
  },
  {
    key: 'SECURITY_SESSION_HOURS',
    label: 'Admin Session Hours',
    description: 'How long an admin session should remain valid.',
    sensitive: false
  },
  {
    key: 'SECURITY_PASSWORD_MIN_LENGTH',
    label: 'Minimum Password Length',
    description: 'Minimum password length recommended for admin-created accounts.',
    sensitive: false
  },
  {
    key: 'SECURITY_REQUIRE_STRONG_PASSWORDS',
    label: 'Require Strong Passwords',
    description: 'Whether to enforce stronger password standards operationally.',
    sensitive: false
  },
  {
    key: 'SECURITY_REQUIRE_2FA_FOR_ADMINS',
    label: 'Require 2FA For Admins',
    description: 'Operational flag indicating whether admins should be required to enable 2FA.',
    sensitive: false
  },
  {
    key: 'SECURITY_ALLOW_TEST_SIGNUP_LINK',
    label: 'Allow Test Signup Link',
    description: 'Operational switch for the public test-signup experience.',
    sensitive: false
  },
  {
    key: 'MAILBOX_DEFAULT_QUOTA_MB',
    label: 'Default Mailbox Quota (MB)',
    description: 'Default quota applied to newly created mailbox users and customer mailboxes.',
    sensitive: false
  },
  {
    key: 'MAILBOX_DEFAULT_DAILY_EMAIL_LIMIT',
    label: 'Default Daily Email Limit',
    description: 'Default daily sending limit applied to newly created mailbox users and customer mailboxes.',
    sensitive: false
  }
];

let db;
let billingDb;
let wildduckDb;

const now = () => new Date();
const daysAgo = days => new Date(Date.now() - days * 24 * 60 * 60 * 1000);
const BILLING_PLAN_DEFAULTS = [
  {
    code: 'yearly',
    name: 'Yearly',
    summary: 'Best value annual plan billed once per year.',
    description: 'Lower effective cost for customers who want a long-term mailbox identity.',
    price: 39.9,
    currency: 'USD',
    intervalLength: 12,
    intervalUnit: 'months',
    featured: true,
    active: true,
    checkoutEnabled: true,
    highlightTag: 'Best value',
    benefits: ['Lower effective cost than monthly billing', 'Same mailbox experience and account controls', 'Built for long-term personal identity'],
    sortOrder: 10
  },
  {
    code: 'monthly',
    name: 'Monthly',
    summary: 'Flexible monthly plan billed once every month.',
    description: 'Ideal when you want to get started quickly with lower commitment.',
    price: 9,
    currency: 'USD',
    intervalLength: 1,
    intervalUnit: 'months',
    featured: false,
    active: true,
    checkoutEnabled: true,
    highlightTag: 'Flexible',
    benefits: ['Professional address on @yoover.com', 'Responsive webmail and mobile setup', 'In-account billing management'],
    sortOrder: 20
  }
];

const normalizeBenefits = benefits =>
  []
    .concat(benefits || [])
    .map(item => String(item || '').trim())
    .filter(Boolean);

const resolvePlanCadence = (intervalLength, intervalUnit) => {
  const length = Math.max(1, Number(intervalLength) || 1);
  const unit = String(intervalUnit || 'months').toLowerCase();

  if (unit === 'weeks' || unit === 'weekly') {
    return {
      intervalLength: length * 7,
      intervalUnit: 'days',
      cadence: 'weeks',
      displayLength: length
    };
  }

  if (unit === 'years' || unit === 'yearly' || unit === 'year') {
    return {
      intervalLength: length * 12,
      intervalUnit: 'months',
      cadence: 'years',
      displayLength: length
    };
  }

  if (unit === 'months' && length % 12 === 0 && length >= 12) {
    return {
      intervalLength: length,
      intervalUnit: 'months',
      cadence: 'years',
      displayLength: length / 12
    };
  }

  if (unit === 'months' || unit === 'monthly' || unit === 'month') {
    return {
      intervalLength: length,
      intervalUnit: 'months',
      cadence: 'months',
      displayLength: length
    };
  }

  if (unit === 'days' && length % 7 === 0 && length >= 7) {
    return {
      intervalLength: length,
      intervalUnit: 'days',
      cadence: 'weeks',
      displayLength: length / 7
    };
  }

  return {
    intervalLength: length,
    intervalUnit: 'days',
    cadence: 'days',
    displayLength: length
  };
};

const formatPlanIntervalLabel = (intervalLength, intervalUnit) => {
  const resolved = resolvePlanCadence(intervalLength, intervalUnit);
  const length = resolved.displayLength;

  if (resolved.cadence === 'weeks') {
    return length === 1 ? 'week' : `${length} weeks`;
  }

  if (resolved.cadence === 'months') {
    return length === 1 ? 'month' : `${length} months`;
  }

  if (resolved.cadence === 'years') {
    return length === 1 ? 'year' : `${length} years`;
  }

  return length === 1 ? 'day' : `${length} days`;
};

const formatPlanPrice = (price, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(price) || 0);

const normalizePlanDocument = plan => {
  const resolvedCadence = resolvePlanCadence(plan.intervalLength, plan.intervalUnit);
  const intervalLength = resolvedCadence.intervalLength;
  const intervalUnit = resolvedCadence.intervalUnit;
  const price = Number(plan.price) || 0;
  const currency = String(plan.currency || 'USD').trim().toUpperCase() || 'USD';

  return {
    _id: plan._id,
    code: String(plan.code || '').trim().toLowerCase(),
    name: String(plan.name || '').trim(),
    summary: String(plan.summary || '').trim(),
    description: String(plan.description || '').trim(),
    price,
    currency,
    formattedPrice: formatPlanPrice(price, currency),
    intervalLength,
    intervalUnit,
    cadence: resolvedCadence.cadence,
    displayIntervalLength: resolvedCadence.displayLength,
    billingLabel: formatPlanIntervalLabel(intervalLength, intervalUnit),
    featured: Boolean(plan.featured),
    active: plan.active !== false,
    checkoutEnabled: plan.checkoutEnabled !== false,
    highlightTag: String(plan.highlightTag || '').trim(),
    benefits: normalizeBenefits(plan.benefits),
    sortOrder: Number(plan.sortOrder || 0),
    createdAt: plan.createdAt || null,
    updatedAt: plan.updatedAt || null
  };
};

const ensureDefaultBillingPlans = async () => {
  const count = await billingDb.collection(BILLING_PLANS).countDocuments();
  if (count) {
    return;
  }

  await billingDb.collection(BILLING_PLANS).insertMany(
    BILLING_PLAN_DEFAULTS.map(plan => ({
      ...plan,
      createdAt: now(),
      updatedAt: now()
    }))
  );
};

const getDefaultSettingValue = key => {
  const defaults = {
    OPS_PRIMARY_DOMAIN: process.env.ADMIN_PANEL_SERVICE_DOMAIN || 'yoover.com',
    OPS_WEB_HOSTS: 'yoover.com,www.yoover.com,mail.yoover.com,email.yoover.com,app.yoover.com,dev.yoover.com,mobile.yoover.com,development.yoover.com',
    OPS_IMAP_HOST: 'imap.yoover.com',
    OPS_POP3_HOST: 'pop3.yoover.com',
    OPS_SMTP_HOST: 'smtp.yoover.com',
    OPS_ALLOWED_SIGNUP_DOMAINS: process.env.ADMIN_PANEL_SERVICE_DOMAIN || 'yoover.com',
    SECURITY_SESSION_HOURS: '12',
    SECURITY_PASSWORD_MIN_LENGTH: '12',
    SECURITY_REQUIRE_STRONG_PASSWORDS: 'true',
    SECURITY_REQUIRE_2FA_FOR_ADMINS: 'false',
    SECURITY_ALLOW_TEST_SIGNUP_LINK: 'true',
    MAILBOX_DEFAULT_QUOTA_MB: String(process.env.ADMIN_PANEL_DEFAULT_QUOTA_MB || '1024'),
    MAILBOX_DEFAULT_DAILY_EMAIL_LIMIT: String(process.env.ADMIN_PANEL_DEFAULT_RECIPIENTS || '2000')
  };

  return defaults[key] || '';
};

const getSharedWebmailEnvMap = async () => {
  const { entries } = await listWebmailEnvEntries();
  return new Map(entries.map(entry => [entry.key, entry.value || '']));
};

const parseCsvLine = line => {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
};

const parseRecipientsCsv = csvText => {
  const text = String(csvText || '').trim();
  if (!text) {
    return [];
  }

  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const firstRow = parseCsvLine(lines[0]).map(value => value.toLowerCase());
  const hasHeader = firstRow.includes('email');
  const header = hasHeader ? firstRow : ['email', 'name', 'status', 'segment'];
  const rows = hasHeader ? lines.slice(1) : lines;

  return rows
    .map(line => {
      const values = parseCsvLine(line);
      const record = {};
      header.forEach((column, index) => {
        record[column] = values[index] || '';
      });
      return {
        email: String(record.email || '').trim().toLowerCase(),
        name: String(record.name || '').trim(),
        status: String(record.status || 'subscribed').trim().toLowerCase() || 'subscribed',
        segment: String(record.segment || 'general').trim().toLowerCase() || 'general'
      };
    })
    .filter(entry => entry.email);
};

const formatRecipientsCsv = entries =>
  ['email,name,status,segment', ...entries.map(entry => [entry.email, entry.name || '', entry.status || '', entry.segment || ''].map(value => `"${String(value).replace(/"/g, '""')}"`).join(','))].join('\n');

export const connectStore = async mongoUri => {
  const client = new MongoClient(mongoUri);
  await client.connect();
  db = client.db();
  billingDb = client.db(process.env.ADMIN_PANEL_BILLING_DB_NAME || db.databaseName);
  wildduckDb = client.db(process.env.ADMIN_PANEL_WILDDUCK_DB_NAME || db.databaseName);

  await Promise.all([
    db.collection(ADMIN_USERS).createIndex({ email: 1 }, { unique: true }),
    db.collection(ADMIN_AUDIT_LOGS).createIndex({ createdAt: -1 }),
    db.collection(ADMIN_SETTINGS).createIndex({ key: 1 }, { unique: true }),
    db.collection(ADMIN_SUPPORT_NOTES).createIndex({ accountId: 1, createdAt: -1 }),
    billingDb.collection(BILLING_ACCOUNTS).createIndex({ updatedAt: -1 }),
    billingDb.collection(BILLING_PAYMENTS).createIndex({ createdAt: -1 }),
    billingDb.collection(BILLING_PLANS).createIndex({ code: 1 }, { unique: true }),
    billingDb.collection(BILLING_PLANS).createIndex({ active: 1, checkoutEnabled: 1, sortOrder: 1 }),
    db.collection(MARKETING_RECIPIENTS).createIndex({ email: 1 }, { unique: true }),
    db.collection(MARKETING_RECIPIENTS).createIndex({ status: 1, segment: 1 }),
    db.collection(MARKETING_SENDER_PROFILES).createIndex({ name: 1 }),
    db.collection(MARKETING_CAMPAIGNS).createIndex({ updatedAt: -1 })
  ]);

  await ensureDefaultBillingPlans();

  return db;
};

export const bootstrapAdminUser = async ({ email, password, name }) => {
  const existing = await db.collection(ADMIN_USERS).findOne({ email });
  if (existing) {
    return existing;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = {
    email,
    name,
    role: ROLES.SUPER_ADMIN,
    permissions: getRolePermissions(ROLES.SUPER_ADMIN),
    passwordHash,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    createdBy: 'bootstrap'
  };

  await db.collection(ADMIN_USERS).insertOne(admin);
  return db.collection(ADMIN_USERS).findOne({ email });
};

export const findAdminByEmail = email => db.collection(ADMIN_USERS).findOne({ email });
export const findAdminById = id => db.collection(ADMIN_USERS).findOne({ _id: new ObjectId(id) });

export const createAdminUser = async ({ email, password, name, role, createdBy }) => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !password || !name || !role) {
    throw new Error('Name, email, password, and role are required');
  }

  if (!Object.values(ROLES).includes(role)) {
    throw new Error('Invalid admin role');
  }

  const existing = await db.collection(ADMIN_USERS).findOne({ email: normalizedEmail });
  if (existing) {
    throw new Error('Admin user already exists');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = {
    email: normalizedEmail,
    name: String(name).trim(),
    role,
    permissions: getRolePermissions(role),
    passwordHash,
    status: 'active',
    createdAt: now(),
    updatedAt: now(),
    createdBy: createdBy ? new ObjectId(createdBy) : null
  };

  const result = await db.collection(ADMIN_USERS).insertOne(admin);
  return db.collection(ADMIN_USERS).findOne({ _id: result.insertedId }, { projection: { passwordHash: 0 } });
};

export const updateAdminUser = async ({ adminId, role, status }) => {
  const updates = { updatedAt: now() };

  if (role) {
    if (!Object.values(ROLES).includes(role)) {
      throw new Error('Invalid admin role');
    }
    updates.role = role;
    updates.permissions = getRolePermissions(role);
  }

  if (status) {
    if (!['active', 'disabled'].includes(status)) {
      throw new Error('Invalid admin status');
    }
    updates.status = status;
  }

  await db.collection(ADMIN_USERS).updateOne({ _id: new ObjectId(adminId) }, { $set: updates });
  return db.collection(ADMIN_USERS).findOne({ _id: new ObjectId(adminId) }, { projection: { passwordHash: 0 } });
};

export const recordAuditLog = async ({ adminId, action, targetType, targetId, details }) => {
  await db.collection(ADMIN_AUDIT_LOGS).insertOne({
    adminId: adminId ? new ObjectId(adminId) : null,
    action,
    targetType: targetType || '',
    targetId: targetId || '',
    details: details || {},
    createdAt: now()
  });
};

export const listAdminUsers = async () =>
  db
    .collection(ADMIN_USERS)
    .find({}, { projection: { passwordHash: 0 } })
    .sort({ createdAt: -1 })
    .toArray();

export const listAuditLogs = async (limit = 50) =>
  db
    .collection(ADMIN_AUDIT_LOGS)
    .aggregate([
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: ADMIN_USERS,
          localField: 'adminId',
          foreignField: '_id',
          as: 'admin'
        }
      },
      {
        $project: {
          action: 1,
          targetType: 1,
          targetId: 1,
          details: 1,
          createdAt: 1,
          adminName: { $arrayElemAt: ['$admin.name', 0] },
          adminEmail: { $arrayElemAt: ['$admin.email', 0] }
        }
      }
    ])
    .toArray();

export const listCustomers = async ({ search = '', status = '', plan = '', limit = 50 } = {}) => {
  const filter = {};

  if (search) {
    filter.$or = [
      { emailAddress: { $regex: search, $options: 'i' } },
      { username: { $regex: search, $options: 'i' } },
      { fullName: { $regex: search, $options: 'i' } },
      { billingEmail: { $regex: search, $options: 'i' } }
    ];
  }

  if (status) {
    filter.status = status;
  }

  if (plan) {
    filter['plan.name'] = plan;
  }

  return billingDb
    .collection(BILLING_ACCOUNTS)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .project({
      username: 1,
      emailAddress: 1,
      fullName: 1,
      billingEmail: 1,
      recoveryEmail: 1,
      status: 1,
      plan: 1,
      subscription: 1,
      createdAt: 1,
      updatedAt: 1
    })
    .toArray();
};

export const listMailboxUsers = async ({ search = '', limit = 50 } = {}) => {
  const filter = search
    ? {
        $or: [
          { username: { $regex: search, $options: 'i' } },
          { address: { $regex: search, $options: 'i' } },
          { name: { $regex: search, $options: 'i' } }
        ]
      }
    : {};

  const users = await wildduckDb
    .collection(WILDDUCK_USERS)
    .find(filter)
    .sort({ created: -1 })
    .limit(limit)
    .project({
      username: 1,
      address: 1,
      name: 1,
      disabled: 1,
      quota: 1,
      storageUsed: 1,
      created: 1,
      tagsview: 1
    })
    .toArray();

  const emailAddresses = users.map(user => user.address).filter(Boolean);
  const usernames = users.map(user => user.username).filter(Boolean);
  const linkedCustomers = await billingDb
    .collection(BILLING_ACCOUNTS)
    .find({
      $or: [{ emailAddress: { $in: emailAddresses } }, { username: { $in: usernames } }]
    })
    .project({
      username: 1,
      emailAddress: 1,
      fullName: 1,
      status: 1
    })
    .toArray();

  const linkedByEmail = new Map(linkedCustomers.map(entry => [entry.emailAddress, entry]));
  const linkedByUsername = new Map(linkedCustomers.map(entry => [entry.username, entry]));

  return users.map(user => ({
    ...user,
    linkedCustomer: linkedByEmail.get(user.address) || linkedByUsername.get(user.username) || null
  }));
};

export const listAllMailboxUsersForAdminUpdate = async () =>
  wildduckDb
    .collection(WILDDUCK_USERS)
    .find({})
    .project({
      _id: 1,
      username: 1,
      address: 1,
      name: 1,
      disabled: 1,
      quota: 1,
      recipients: 1
    })
    .toArray();

export const getMailboxUserDetail = async userId => {
  const user = await wildduckDb.collection(WILDDUCK_USERS).findOne(
    { _id: typeof userId === 'string' ? new ObjectId(userId) : userId },
    {
      projection: {
        username: 1,
        address: 1,
        name: 1,
        disabled: 1,
        quota: 1,
        recipients: 1,
        storageUsed: 1,
        created: 1,
        targets: 1,
        tagsview: 1
      }
    }
  );

  if (!user) {
    return null;
  }

  const linkedCustomer = await billingDb.collection(BILLING_ACCOUNTS).findOne({
    $or: [{ emailAddress: user.address }, { username: user.username }]
  });

  return {
    user,
    linkedCustomer
  };
};

export const importMailboxUserToCustomer = async userId => {
  const detail = await getMailboxUserDetail(userId);
  if (!detail || !detail.user) {
    throw new Error('Mailbox user not found');
  }

  const mailboxUser = detail.user;
  const account = await createOrUpdateCustomerAccount({
    username: mailboxUser.username,
    emailAddress: mailboxUser.address,
    fullName: mailboxUser.name || mailboxUser.username,
    wildduckUserId: String(mailboxUser._id),
    status: mailboxUser.disabled ? 'disabled' : 'active',
    plan: detail.linkedCustomer && detail.linkedCustomer.plan ? detail.linkedCustomer.plan : { name: 'Mailbox Imported', price: 0 },
    subscription:
      detail.linkedCustomer && detail.linkedCustomer.subscription
        ? detail.linkedCustomer.subscription
        : {
            id: null,
            status: 'imported'
          },
    meta: {
      importedFromMailboxUsers: true,
      importedAt: new Date().toISOString(),
      storageUsed: mailboxUser.storageUsed || 0,
      quota: mailboxUser.quota || 0
    }
  });

  return {
    account,
    mailboxUser
  };
};

export const createOrUpdateCustomerAccount = async account => {
  const emailAddress = String(account.emailAddress || '').trim().toLowerCase();
  if (!emailAddress) {
    throw new Error('Email address is required');
  }

  const existing = await billingDb.collection(BILLING_ACCOUNTS).findOne({ emailAddress });
  const createdAt = existing ? existing.createdAt : now();
  const document = {
    username: account.username,
    emailAddress,
    fullName: account.fullName || '',
    billingEmail: account.billingEmail || '',
    recoveryEmail: account.recoveryEmail || '',
    wildduckUserId: account.wildduckUserId || (existing && existing.wildduckUserId) || null,
    plan: account.plan || (existing && existing.plan) || null,
    status: account.status || (existing && existing.status) || 'active',
    authorizeNet: account.authorizeNet || (existing && existing.authorizeNet) || {},
    paymentMethods: account.paymentMethods || (existing && existing.paymentMethods) || [],
    subscription: account.subscription || (existing && existing.subscription) || {},
    meta: Object.assign({}, (existing && existing.meta) || {}, account.meta || {}),
    createdAt,
    updatedAt: now()
  };

  await billingDb.collection(BILLING_ACCOUNTS).updateOne({ emailAddress }, { $set: document }, { upsert: true });
  return billingDb.collection(BILLING_ACCOUNTS).findOne({ emailAddress });
};

export const updateCustomerAccount = async ({ accountId, updates }) => {
  const patch = {
    updatedAt: now()
  };

  ['fullName', 'billingEmail', 'recoveryEmail', 'status'].forEach(field => {
    if (typeof updates[field] === 'string') {
      patch[field] = updates[field].trim();
    }
  });

  if (updates.planName || updates.planPrice) {
    patch.plan = {
      name: updates.planName || '',
      price: Number(updates.planPrice) || 0
    };
  }

  await billingDb.collection(BILLING_ACCOUNTS).updateOne({ _id: new ObjectId(accountId) }, { $set: patch });
  return getCustomerDetail(accountId);
};

export const createManualPayment = async ({ accountId, amount, notes, invoiceNumber, status = 'paid', adminId }) => {
  const account = await billingDb.collection(BILLING_ACCOUNTS).findOne({ _id: new ObjectId(accountId) });
  if (!account) {
    throw new Error('Customer account not found');
  }

  const payment = {
    accountId: account._id,
    emailAddress: account.emailAddress,
    username: account.username,
    transactionId: '',
    subscriptionId: '',
    invoiceNumber: invoiceNumber || `MAN-${Date.now()}`,
    amount: Number(amount) || 0,
    status,
    type: 'manual_adjustment',
    gateway: 'admin.manual',
    cardNumber: '',
    cardType: '',
    authCode: '',
    notes: notes || '',
    createdAt: now(),
    createdBy: adminId ? new ObjectId(adminId) : null
  };

  const result = await billingDb.collection(BILLING_PAYMENTS).insertOne(payment);
  return {
    ...payment,
    _id: result.insertedId
  };
};

export const getCustomerDetail = async accountId => {
  const _id = typeof accountId === 'string' ? new ObjectId(accountId) : accountId;
  const [account, payments, notes] = await Promise.all([
    billingDb.collection(BILLING_ACCOUNTS).findOne({ _id }),
    billingDb.collection(BILLING_PAYMENTS).find({ accountId: _id }).sort({ createdAt: -1 }).limit(50).toArray(),
    db
      .collection(ADMIN_SUPPORT_NOTES)
      .aggregate([
        { $match: { accountId: _id } },
        { $sort: { createdAt: -1 } },
        {
          $lookup: {
            from: ADMIN_USERS,
            localField: 'adminId',
            foreignField: '_id',
            as: 'admin'
          }
        },
        {
          $project: {
            body: 1,
            createdAt: 1,
            adminName: { $arrayElemAt: ['$admin.name', 0] },
            adminEmail: { $arrayElemAt: ['$admin.email', 0] }
          }
        }
      ])
      .toArray()
  ]);

  return {
    account,
    payments,
    notes
  };
};

export const listRecentPayments = async ({ search = '', limit = 50 } = {}) => {
  const pipeline = [];

  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { emailAddress: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
          { transactionId: { $regex: search, $options: 'i' } },
          { invoiceNumber: { $regex: search, $options: 'i' } }
        ]
      }
    });
  }

  pipeline.push({ $sort: { createdAt: -1 } }, { $limit: limit });

  return billingDb.collection(BILLING_PAYMENTS).aggregate(pipeline).toArray();
};

export const getPaymentById = async paymentId => billingDb.collection(BILLING_PAYMENTS).findOne({ _id: new ObjectId(paymentId) });

export const listBillingPlans = async ({ includeInactive = true } = {}) => {
  const filter = includeInactive ? {} : { active: true, checkoutEnabled: true };
  const plans = await billingDb
    .collection(BILLING_PLANS)
    .find(filter)
    .sort({ sortOrder: 1, price: 1, createdAt: 1 })
    .toArray();

  return plans.map(normalizePlanDocument);
};

export const getBillingPlanById = async planId => {
  const plan = await billingDb.collection(BILLING_PLANS).findOne({ _id: new ObjectId(planId) });
  return plan ? normalizePlanDocument(plan) : null;
};

export const upsertBillingPlan = async ({ planId, code, name, summary, description, price, currency, intervalLength, intervalUnit, featured, active, checkoutEnabled, highlightTag, benefits, sortOrder, adminId }) => {
  const normalizedCode = String(code || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalizedCode || !name) {
    throw new Error('Plan code and plan name are required');
  }

  const resolvedCadence = resolvePlanCadence(intervalLength, intervalUnit);
  const nextIntervalUnit = resolvedCadence.intervalUnit;
  const nextIntervalLength = resolvedCadence.intervalLength;
  if (resolvedCadence.cadence === 'days' && nextIntervalLength > 365) {
    throw new Error('Day-based billing interval length must be between 1 and 365');
  }

  if (resolvedCadence.cadence === 'weeks' && resolvedCadence.displayLength > 52) {
    throw new Error('Week-based billing interval length must be between 1 and 52');
  }

  if (resolvedCadence.cadence === 'months' && resolvedCadence.displayLength > 24) {
    throw new Error('Month-based billing interval length must be between 1 and 24');
  }

  if (resolvedCadence.cadence === 'years' && resolvedCadence.displayLength > 10) {
    throw new Error('Year-based billing interval length must be between 1 and 10');
  }

  const nextPlan = {
    code: normalizedCode,
    name: String(name || '').trim(),
    summary: String(summary || '').trim(),
    description: String(description || '').trim(),
    price: Number(price) || 0,
    currency: String(currency || 'USD').trim().toUpperCase() || 'USD',
    intervalLength: nextIntervalLength,
    intervalUnit: nextIntervalUnit,
    featured: Boolean(featured),
    active: active !== false,
    checkoutEnabled: checkoutEnabled !== false,
    highlightTag: String(highlightTag || '').trim(),
    benefits: normalizeBenefits(Array.isArray(benefits) ? benefits : String(benefits || '').split(/\r?\n/)),
    sortOrder: Number(sortOrder || 0),
    updatedAt: now(),
    updatedBy: adminId ? new ObjectId(adminId) : null
  };

  const existingByCode = await billingDb.collection(BILLING_PLANS).findOne({ code: normalizedCode });
  if (existingByCode && (!planId || String(existingByCode._id) !== String(planId))) {
    throw new Error('A plan with this code already exists');
  }

  if (nextPlan.featured) {
    await billingDb.collection(BILLING_PLANS).updateMany({}, { $set: { featured: false, updatedAt: now() } });
  }

  if (planId) {
    await billingDb.collection(BILLING_PLANS).updateOne({ _id: new ObjectId(planId) }, { $set: nextPlan });
    return getBillingPlanById(planId);
  }

  nextPlan.createdAt = now();
  const result = await billingDb.collection(BILLING_PLANS).insertOne(nextPlan);
  return getBillingPlanById(result.insertedId);
};

export const removeBillingPlan = async planId => {
  const plan = await billingDb.collection(BILLING_PLANS).findOne({ _id: new ObjectId(planId) });
  if (!plan) {
    throw new Error('Plan not found');
  }

  const usageCount = await billingDb.collection(BILLING_ACCOUNTS).countDocuments({
    $or: [{ 'plan.code': plan.code }, { 'plan.name': plan.name }]
  });

  if (usageCount > 0) {
    throw new Error('This plan is already attached to customer records. Disable it instead of deleting it.');
  }

  await billingDb.collection(BILLING_PLANS).deleteOne({ _id: plan._id });
  return normalizePlanDocument(plan);
};

export const listMarketingRecipients = async ({ search = '', status = '', limit = 200 } = {}) => {
  const filter = {};

  if (search) {
    filter.$or = [{ email: { $regex: search, $options: 'i' } }, { name: { $regex: search, $options: 'i' } }, { segment: { $regex: search, $options: 'i' } }];
  }

  if (status) {
    filter.status = status;
  }

  return db
    .collection(MARKETING_RECIPIENTS)
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .toArray();
};

export const importMarketingRecipients = async ({ csvText, adminId }) => {
  const records = parseRecipientsCsv(csvText);
  if (!records.length) {
    throw new Error('No valid recipient rows were found in the imported file');
  }

  let imported = 0;
  for (const record of records) {
    await db.collection(MARKETING_RECIPIENTS).updateOne(
      { email: record.email },
      {
        $set: {
          email: record.email,
          name: record.name,
          status: ['subscribed', 'unsubscribed', 'suppressed'].includes(record.status) ? record.status : 'subscribed',
          segment: record.segment || 'general',
          updatedAt: now(),
          updatedBy: adminId ? new ObjectId(adminId) : null
        },
        $setOnInsert: {
          createdAt: now()
        }
      },
      { upsert: true }
    );
    imported += 1;
  }

  return {
    imported,
    total: records.length
  };
};

export const exportMarketingRecipientsCsv = async () => {
  const recipients = await db
    .collection(MARKETING_RECIPIENTS)
    .find({})
    .sort({ createdAt: -1 })
    .project({ email: 1, name: 1, status: 1, segment: 1 })
    .toArray();

  return formatRecipientsCsv(recipients);
};

export const updateMarketingRecipient = async ({ recipientId, status, name, segment }) => {
  const patch = {
    updatedAt: now()
  };

  if (typeof name === 'string') {
    patch.name = name.trim();
  }

  if (typeof segment === 'string') {
    patch.segment = segment.trim().toLowerCase();
  }

  if (typeof status === 'string') {
    patch.status = status.trim().toLowerCase();
  }

  await db.collection(MARKETING_RECIPIENTS).updateOne({ _id: new ObjectId(recipientId) }, { $set: patch });
  return db.collection(MARKETING_RECIPIENTS).findOne({ _id: new ObjectId(recipientId) });
};

export const removeMarketingRecipient = async recipientId => {
  await db.collection(MARKETING_RECIPIENTS).deleteOne({ _id: new ObjectId(recipientId) });
};

export const listMarketingSenderProfiles = async () => {
  const profiles = await db.collection(MARKETING_SENDER_PROFILES).find({}).sort({ updatedAt: -1, createdAt: -1 }).toArray();
  return profiles.map(profile => ({
    ...profile,
    smtpPass: '',
    hasPassword: Boolean(profile.smtpPassEncrypted)
  }));
};

export const upsertMarketingSenderProfile = async ({ profileId, name, fromName, fromEmail, replyTo, smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, adminId }) => {
  const normalizedName = String(name || '').trim();
  const normalizedFromEmail = String(fromEmail || '').trim().toLowerCase();
  if (!normalizedName || !normalizedFromEmail || !smtpHost) {
    throw new Error('Profile name, from email, and SMTP host are required');
  }

  const existing = profileId ? await db.collection(MARKETING_SENDER_PROFILES).findOne({ _id: new ObjectId(profileId) }) : null;
  const document = {
    name: normalizedName,
    fromName: String(fromName || '').trim(),
    fromEmail: normalizedFromEmail,
    replyTo: String(replyTo || '').trim().toLowerCase(),
    smtpHost: String(smtpHost || '').trim(),
    smtpPort: Number(smtpPort || 587) || 587,
    smtpSecure: ['true', '1', 'yes'].includes(String(smtpSecure || '').toLowerCase()),
    smtpUser: String(smtpUser || '').trim(),
    smtpPassEncrypted: smtpPass ? encryptValue(String(smtpPass)) : existing?.smtpPassEncrypted || '',
    updatedAt: now(),
    updatedBy: adminId ? new ObjectId(adminId) : null
  };

  if (existing) {
    await db.collection(MARKETING_SENDER_PROFILES).updateOne({ _id: existing._id }, { $set: document });
    const profile = await db.collection(MARKETING_SENDER_PROFILES).findOne({ _id: existing._id });
    return { ...profile, smtpPass: '', hasPassword: Boolean(profile.smtpPassEncrypted) };
  }

  document.createdAt = now();
  const result = await db.collection(MARKETING_SENDER_PROFILES).insertOne(document);
  const profile = await db.collection(MARKETING_SENDER_PROFILES).findOne({ _id: result.insertedId });
  return { ...profile, smtpPass: '', hasPassword: Boolean(profile.smtpPassEncrypted) };
};

export const getMarketingSenderProfileForDelivery = async profileId => {
  const profile = await db.collection(MARKETING_SENDER_PROFILES).findOne({ _id: new ObjectId(profileId) });
  if (!profile) {
    throw new Error('Sender profile not found');
  }

  return {
    ...profile,
    smtpPass: profile.smtpPassEncrypted ? decryptValue(profile.smtpPassEncrypted) : ''
  };
};

export const removeMarketingSenderProfile = async profileId => {
  await db.collection(MARKETING_SENDER_PROFILES).deleteOne({ _id: new ObjectId(profileId) });
};

export const listMarketingCampaigns = async () =>
  db
    .collection(MARKETING_CAMPAIGNS)
    .aggregate([
      { $sort: { updatedAt: -1, createdAt: -1 } },
      {
        $lookup: {
          from: MARKETING_SENDER_PROFILES,
          localField: 'senderProfileId',
          foreignField: '_id',
          as: 'sender'
        }
      },
      {
        $project: {
          name: 1,
          subject: 1,
          segment: 1,
          status: 1,
          createdAt: 1,
          updatedAt: 1,
          lastRunAt: 1,
          stats: 1,
          senderName: { $arrayElemAt: ['$sender.name', 0] },
          senderEmail: { $arrayElemAt: ['$sender.fromEmail', 0] }
        }
      }
    ])
    .toArray();

export const getMarketingCampaignDetail = async campaignId =>
  db.collection(MARKETING_CAMPAIGNS).findOne({ _id: new ObjectId(campaignId) });

export const upsertMarketingCampaign = async ({ campaignId, name, subject, previewText, htmlBody, textBody, senderProfileId, segment, adminId }) => {
  if (!name || !subject || !senderProfileId) {
    throw new Error('Campaign name, subject, and sender profile are required');
  }

  const document = {
    name: String(name).trim(),
    subject: String(subject).trim(),
    previewText: String(previewText || '').trim(),
    htmlBody: String(htmlBody || '').trim(),
    textBody: String(textBody || '').trim(),
    senderProfileId: new ObjectId(senderProfileId),
    segment: String(segment || 'all').trim().toLowerCase() || 'all',
    status: 'draft',
    updatedAt: now(),
    updatedBy: adminId ? new ObjectId(adminId) : null
  };

  if (campaignId) {
    await db.collection(MARKETING_CAMPAIGNS).updateOne({ _id: new ObjectId(campaignId) }, { $set: document });
    return getMarketingCampaignDetail(campaignId);
  }

  document.createdAt = now();
  document.stats = {
    delivered: 0,
    failed: 0,
    recipients: 0
  };

  const result = await db.collection(MARKETING_CAMPAIGNS).insertOne(document);
  return getMarketingCampaignDetail(result.insertedId);
};

export const markMarketingCampaignSent = async ({ campaignId, delivered, failed, recipients }) => {
  await db.collection(MARKETING_CAMPAIGNS).updateOne(
    { _id: new ObjectId(campaignId) },
    {
      $set: {
        status: 'sent',
        lastRunAt: now(),
        updatedAt: now(),
        stats: {
          delivered,
          failed,
          recipients
        }
      }
    }
  );

  return getMarketingCampaignDetail(campaignId);
};

export const listMarketingEligibleRecipients = async segment =>
  db
    .collection(MARKETING_RECIPIENTS)
    .find({
      status: 'subscribed',
      ...(segment && segment !== 'all' ? { segment } : {})
    })
    .sort({ createdAt: -1 })
    .toArray();

export const createSupportNote = async ({ accountId, adminId, body }) => {
  const text = String(body || '').trim();
  if (!text) {
    throw new Error('Support note text is required');
  }

  await db.collection(ADMIN_SUPPORT_NOTES).insertOne({
    accountId: typeof accountId === 'string' ? new ObjectId(accountId) : accountId,
    adminId: adminId ? new ObjectId(adminId) : null,
    body: text,
    createdAt: now()
  });
};

export const getDashboardSummary = async () => {
  const [accountsTotal, activeAccounts, paidAccounts, recentAccounts, revenueAgg, recentPayments, revenueTrend, signupTrend, funnelCounts, riskCounts] = await Promise.all([
    billingDb.collection(BILLING_ACCOUNTS).countDocuments(),
    billingDb.collection(BILLING_ACCOUNTS).countDocuments({ status: { $in: ['active', 'active-pending-billing', 'payment-captured'] } }),
    billingDb.collection(BILLING_ACCOUNTS).countDocuments({ 'subscription.status': { $in: ['active', 'pending_activation'] } }),
    billingDb.collection(BILLING_ACCOUNTS).countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    }),
    billingDb
      .collection(BILLING_PAYMENTS)
      .aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
      .toArray(),
    billingDb.collection(BILLING_PAYMENTS).countDocuments({
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      status: 'paid'
    }),
    billingDb
      .collection(BILLING_PAYMENTS)
      .aggregate([
        { $match: { createdAt: { $gte: daysAgo(30) }, status: { $in: ['paid', 'pending', 'failed'] } } },
        {
          $group: {
            _id: {
              day: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
              }
            },
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.day': 1 } }
      ])
      .toArray(),
    billingDb
      .collection(BILLING_ACCOUNTS)
      .aggregate([
        { $match: { createdAt: { $gte: daysAgo(30) } } },
        {
          $group: {
            _id: {
              day: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
              }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.day': 1 } }
      ])
      .toArray(),
    Promise.all([
      billingDb.collection(BILLING_ACCOUNTS).countDocuments(),
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ status: { $in: ['payment-captured', 'active', 'active-pending-billing', 'manual'] } }),
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ 'subscription.status': { $in: ['active', 'pending_activation', 'manual'] } }),
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ status: 'canceled' })
    ]),
    Promise.all([
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ status: 'active-pending-billing' }),
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ createdAt: { $gte: daysAgo(1) } }),
      billingDb.collection(BILLING_PAYMENTS).countDocuments({ type: 'manual_adjustment', createdAt: { $gte: daysAgo(7) } }),
      billingDb.collection(BILLING_PAYMENTS).countDocuments({ status: 'failed', createdAt: { $gte: daysAgo(14) } })
    ])
  ]);

  return {
    accountsTotal,
    activeAccounts,
    paidAccounts,
    recentAccounts,
    revenueTotal: (revenueAgg[0] && revenueAgg[0].total) || 0,
    paymentsLast30Days: recentPayments,
    revenueTrend: revenueTrend.map(entry => ({
      day: entry._id.day,
      total: entry.total,
      count: entry.count
    })),
    signupTrend: signupTrend.map(entry => ({
      day: entry._id.day,
      count: entry.count
    })),
    signupFunnel: {
      leads: funnelCounts[0],
      provisioned: funnelCounts[1],
      subscribed: funnelCounts[2],
      canceled: funnelCounts[3]
    },
    riskBoard: {
      pendingBilling: riskCounts[0],
      recentSignups24h: riskCounts[1],
      manualAdjustments7d: riskCounts[2],
      failedPayments14d: riskCounts[3]
    }
  };
};

export const getSettingsSnapshot = async () => {
  const stored = await db
    .collection(ADMIN_SETTINGS)
    .find({ key: { $in: SETTINGS_DEFINITIONS.map(item => item.key) } })
    .sort({ key: 1 })
    .toArray();

  const storedByKey = new Map(stored.map(entry => [entry.key, entry]));

  return SETTINGS_DEFINITIONS.map(definition => {
    const entry = storedByKey.get(definition.key);
    const storedValue = entry ? decryptValue(entry.value) : '';
    const envValue = process.env[definition.key] || getDefaultSettingValue(definition.key) || '';
    const effectiveValue = storedValue || envValue;

    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      sensitive: definition.sensitive,
      source: storedValue ? 'database' : envValue ? 'environment' : 'unset',
      value: definition.sensitive ? '' : effectiveValue,
      maskedValue: definition.sensitive
        ? storedValue
          ? 'Encrypted value stored'
          : envValue
            ? 'Configured from environment'
            : 'Not configured'
        : effectiveValue,
      hasStoredValue: Boolean(storedValue),
      updatedAt: entry ? entry.updatedAt || entry.createdAt : null
    };
  });
};

export const getResolvedSettingsMap = async () => {
  const settings = await getSettingsSnapshot();
  return settings.reduce((acc, entry) => {
    acc[entry.key] = entry.source === 'database' ? entry.maskedValue === 'Encrypted value stored' ? null : entry.maskedValue : entry.maskedValue;
    return acc;
  }, {});
};

export const getResolvedSetting = async key => {
  if (SHARED_WEBMAIL_ENV_KEYS.has(key)) {
    const envMap = await getSharedWebmailEnvMap();
    return envMap.get(key) || process.env[key] || '';
  }

  const definition = SETTINGS_DEFINITIONS.find(item => item.key === key);
  if (!definition) {
    return '';
  }

  const entry = await db.collection(ADMIN_SETTINGS).findOne({ key });
  const storedValue = entry ? decryptValue(entry.value) : '';
  return storedValue || process.env[key] || getDefaultSettingValue(key) || '';
};

export const getOperationsOverview = async () => {
  const [domainSettings, notificationSettings, securitySettings, queueInsight] = await Promise.all([
    Promise.all([
      getResolvedSetting('OPS_PRIMARY_DOMAIN'),
      getResolvedSetting('OPS_WEB_HOSTS'),
      getResolvedSetting('OPS_IMAP_HOST'),
      getResolvedSetting('OPS_POP3_HOST'),
      getResolvedSetting('OPS_SMTP_HOST'),
      getResolvedSetting('OPS_ALLOWED_SIGNUP_DOMAINS')
    ]),
    Promise.all([
      getResolvedSetting('ADMIN_NOTIFICATION_EMAILS'),
      getResolvedSetting('ADMIN_NOTIFICATION_FROM'),
      getResolvedSetting('ADMIN_NOTIFICATION_SMTP_HOST'),
      getResolvedSetting('ADMIN_NOTIFICATION_SMTP_PORT'),
      getResolvedSetting('ADMIN_NOTIFICATION_SMTP_USER')
    ]),
    Promise.all([
      getResolvedSetting('SECURITY_SESSION_HOURS'),
      getResolvedSetting('SECURITY_PASSWORD_MIN_LENGTH'),
      getResolvedSetting('SECURITY_REQUIRE_STRONG_PASSWORDS'),
      getResolvedSetting('SECURITY_REQUIRE_2FA_FOR_ADMINS'),
      getResolvedSetting('SECURITY_ALLOW_TEST_SIGNUP_LINK')
    ]),
    Promise.all([
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ status: 'active-pending-billing' }),
      billingDb.collection(BILLING_ACCOUNTS).countDocuments({ 'subscription.status': 'pending_activation' }),
      billingDb.collection(BILLING_PAYMENTS).countDocuments({ status: 'failed', createdAt: { $gte: daysAgo(7) } }),
      billingDb.collection(BILLING_PAYMENTS).countDocuments({ type: 'manual_adjustment', createdAt: { $gte: daysAgo(7) } }),
      db.collection(ADMIN_SUPPORT_NOTES).countDocuments({ createdAt: { $gte: daysAgo(7) } })
    ])
  ]);

  return {
    domains: {
      primaryDomain: domainSettings[0],
      webHosts: domainSettings[1],
      imapHost: domainSettings[2],
      pop3Host: domainSettings[3],
      smtpHost: domainSettings[4],
      allowedSignupDomains: domainSettings[5]
    },
    notifications: {
      recipients: notificationSettings[0],
      from: notificationSettings[1],
      smtpHost: notificationSettings[2],
      smtpPort: notificationSettings[3],
      smtpUser: notificationSettings[4]
    },
    security: {
      sessionHours: securitySettings[0],
      passwordMinLength: securitySettings[1],
      requireStrongPasswords: securitySettings[2],
      require2faForAdmins: securitySettings[3],
      allowTestSignupLink: securitySettings[4]
    },
    queueInsight: {
      pendingBilling: queueInsight[0],
      pendingSubscriptionActivation: queueInsight[1],
      failedPayments7d: queueInsight[2],
      manualAdjustments7d: queueInsight[3],
      supportNotes7d: queueInsight[4]
    }
  };
};

export const upsertAdminSetting = async ({ key, value, adminId }) => {
  const definition = SETTINGS_DEFINITIONS.find(item => item.key === key);
  if (!definition) {
    throw new Error('Unknown setting key');
  }

  const normalizedValue = String(value || '').trim();
  const payload = {
    key,
    description: definition.description,
    sensitive: definition.sensitive,
    updatedAt: now(),
    updatedBy: adminId ? new ObjectId(adminId) : null
  };

  if (definition.sensitive) {
    if (!normalizedValue) {
      throw new Error('A value is required for sensitive settings');
    }
    payload.value = encryptValue(normalizedValue);
  } else {
    payload.value = normalizedValue;
  }

  await db.collection(ADMIN_SETTINGS).updateOne(
    { key },
    {
      $set: payload,
      $setOnInsert: {
        createdAt: now()
      }
    },
    { upsert: true }
  );

  return db.collection(ADMIN_SETTINGS).findOne({ key });
};
