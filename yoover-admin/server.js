import express from 'express';
import path from 'path';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import {
  connectStore,
  bootstrapAdminUser,
  createOrUpdateCustomerAccount,
  createAdminUser,
  createManualPayment,
  createSupportNote,
  exportMarketingRecipientsCsv,
  findAdminByEmail,
  findAdminById,
  getDashboardSummary,
  getCustomerDetail,
  getMailboxUserDetail,
  getMarketingCampaignDetail,
  getOperationsOverview,
  getPaymentById,
  importMarketingRecipients,
  listMarketingCampaigns,
  listCustomers,
  listMailboxUsers,
  listMarketingRecipients,
  listMarketingSenderProfiles,
  listAdminUsers,
  listAuditLogs,
  listRecentPayments,
  markMarketingCampaignSent,
  importMailboxUserToCustomer,
  removeMarketingRecipient,
  removeMarketingSenderProfile,
  getSettingsSnapshot,
  recordAuditLog,
  updateMarketingRecipient,
  updateCustomerAccount,
  updateAdminUser,
  upsertMarketingCampaign,
  upsertMarketingSenderProfile,
  upsertAdminSetting
} from './lib/admin-store.js';
import { sendTestAdminNotification } from './lib/admin-notification-test.js';
import buildInvoicePdf from './lib/invoice-pdf.js';
import { getSystemHealth } from './lib/health-checks.js';
import { sendMarketingCampaign } from './lib/marketing-mailer.js';
import { listWebmailEnvEntries, removeWebmailEnvEntry, upsertWebmailEnvEntry } from './lib/env-file-manager.js';
import { hasPermission, PERMISSIONS, ROLE_LABELS, ROLES } from './lib/permissions.js';
import { listManagedServices, restartManagedService } from './lib/service-control.js';
import { createMailbox, getServiceDomain } from './lib/wildduck-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.ADMIN_PANEL_PORT || 3101);
const mongoUri = process.env.ADMIN_PANEL_MONGO_URI;
const secureCookie = ['true', '1', 'yes'].includes(String(process.env.ADMIN_PANEL_SECURE_COOKIE || '').toLowerCase());

if (!mongoUri) {
  throw new Error('ADMIN_PANEL_MONGO_URI is required');
}

await connectStore(mongoUri);

await bootstrapAdminUser({
  email: String(process.env.ADMIN_PANEL_BOOTSTRAP_EMAIL || 'admin@yoover.com').trim().toLowerCase(),
  password: process.env.ADMIN_PANEL_BOOTSTRAP_PASSWORD || 'ChangeThisAdminPassword123!',
  name: process.env.ADMIN_PANEL_BOOTSTRAP_NAME || 'Yoover Super Admin'
});

app.set('trust proxy', 1);
app.use(express.json());
app.use(
  session({
    name: 'yoover_admin_sid',
    secret: process.env.ADMIN_PANEL_SESSION_SECRET || 'change-this-admin-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookie,
      maxAge: 1000 * 60 * 60 * 12
    },
    store: MongoStore.create({
      mongoUrl: mongoUri,
      collectionName: 'admin_sessions'
    })
  })
);

const sanitizeAdmin = admin => ({
  id: String(admin._id),
  email: admin.email,
  name: admin.name,
  role: admin.role,
  roleLabel: ROLE_LABELS[admin.role] || admin.role,
  permissions: admin.permissions || [],
  status: admin.status,
  createdAt: admin.createdAt
});

const requireAdmin = async (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const admin = await findAdminById(req.session.adminId);
  if (!admin || admin.status !== 'active') {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Admin account not available' });
  }

  req.admin = admin;
  next();
};

const requirePermission = permission => async (req, res, next) => {
  if (!req.admin && req.session.adminId) {
    req.admin = await findAdminById(req.session.adminId);
  }

  if (!req.admin || !hasPermission(req.admin.role, permission)) {
    return res.status(403).json({ error: 'Permission denied' });
  }

  next();
};

app.post('/api/auth/login', async (req, res) => {
  const email = String((req.body && req.body.email) || '')
    .trim()
    .toLowerCase();
  const password = String((req.body && req.body.password) || '');

  const admin = await findAdminByEmail(email);
  if (!admin) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await bcrypt.compare(password, admin.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  req.session.adminId = String(admin._id);

  await recordAuditLog({
    adminId: admin._id,
    action: 'auth.login',
    targetType: 'admin_user',
    targetId: String(admin._id),
    details: { email: admin.email }
  });

  res.json({ admin: sanitizeAdmin(admin) });
});

app.post('/api/auth/logout', requireAdmin, async (req, res) => {
  await recordAuditLog({
    adminId: req.admin._id,
    action: 'auth.logout',
    targetType: 'admin_user',
    targetId: String(req.admin._id),
    details: { email: req.admin.email }
  });

  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.get('/api/auth/me', requireAdmin, async (req, res) => {
  res.json({ admin: sanitizeAdmin(req.admin) });
});

app.get('/api/dashboard/summary', requireAdmin, requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => {
  res.json({ summary: await getDashboardSummary() });
});

app.get('/api/dashboard/health', requireAdmin, requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (req, res) => {
  res.json(await getSystemHealth());
});

app.get('/api/operations/overview', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_VIEW), async (req, res) => {
  res.json(await getOperationsOverview());
});

app.post('/api/operations/test-notification', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_EDIT), async (req, res) => {
  const result = await sendTestAdminNotification({
    requestedBy: req.admin.email,
    requestedTo: req.body && req.body.recipient
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'operations.test_notification',
    targetType: 'notification',
    targetId: result.recipient,
    details: { recipient: result.recipient }
  });

  res.json({
    success: true,
    recipient: result.recipient
  });
});

app.get('/api/operations/services', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_VIEW), async (req, res) => {
  res.json({ services: await listManagedServices() });
});

app.post('/api/operations/services/:serviceKey/restart', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_EDIT), async (req, res) => {
  const result = await restartManagedService(req.params.serviceKey);

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'operations.service_restart',
    targetType: 'service',
    targetId: result.service.key,
    details: {
      service: result.service.label
    }
  });

  res.json(result);
});

app.get('/api/customers', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const plan = String(req.query.plan || '').trim();
  const limit = Math.min(Number(req.query.limit || 50) || 50, 200);
  res.json({ customers: await listCustomers({ search, status, plan, limit }) });
});

app.get('/api/marketing/recipients', requireAdmin, requirePermission(PERMISSIONS.MARKETING_VIEW), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const status = String(req.query.status || '').trim();
  const limit = Math.min(Number(req.query.limit || 200) || 200, 1000);
  res.json({ recipients: await listMarketingRecipients({ search, status, limit }) });
});

app.post('/api/marketing/recipients/import', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  const result = await importMarketingRecipients({
    csvText: req.body.csvText,
    adminId: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.recipients.import',
    targetType: 'marketing_recipient',
    targetId: '',
    details: result
  });

  res.json({
    result,
    recipients: await listMarketingRecipients({})
  });
});

app.get('/api/marketing/recipients/export', requireAdmin, requirePermission(PERMISSIONS.MARKETING_VIEW), async (req, res) => {
  const csv = await exportMarketingRecipientsCsv();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="yoover-marketing-recipients.csv"');
  return res.send(csv);
});

app.patch('/api/marketing/recipients/:recipientId', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  const recipient = await updateMarketingRecipient({
    recipientId: req.params.recipientId,
    status: req.body.status,
    name: req.body.name,
    segment: req.body.segment
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.recipient.update',
    targetType: 'marketing_recipient',
    targetId: req.params.recipientId,
    details: { status: req.body.status, segment: req.body.segment }
  });

  res.json({ recipient });
});

app.delete('/api/marketing/recipients/:recipientId', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  await removeMarketingRecipient(req.params.recipientId);

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.recipient.remove',
    targetType: 'marketing_recipient',
    targetId: req.params.recipientId,
    details: {}
  });

  res.json({ success: true });
});

app.get('/api/marketing/senders', requireAdmin, requirePermission(PERMISSIONS.MARKETING_VIEW), async (req, res) => {
  res.json({ senderProfiles: await listMarketingSenderProfiles() });
});

app.post('/api/marketing/senders', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  const senderProfile = await upsertMarketingSenderProfile({
    profileId: req.body.profileId,
    name: req.body.name,
    fromName: req.body.fromName,
    fromEmail: req.body.fromEmail,
    replyTo: req.body.replyTo,
    smtpHost: req.body.smtpHost,
    smtpPort: req.body.smtpPort,
    smtpSecure: req.body.smtpSecure,
    smtpUser: req.body.smtpUser,
    smtpPass: req.body.smtpPass,
    adminId: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.sender.upsert',
    targetType: 'marketing_sender_profile',
    targetId: String(senderProfile._id || ''),
    details: { name: senderProfile.name, fromEmail: senderProfile.fromEmail }
  });

  res.json({ senderProfile, senderProfiles: await listMarketingSenderProfiles() });
});

app.delete('/api/marketing/senders/:profileId', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  await removeMarketingSenderProfile(req.params.profileId);

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.sender.remove',
    targetType: 'marketing_sender_profile',
    targetId: req.params.profileId,
    details: {}
  });

  res.json({ success: true, senderProfiles: await listMarketingSenderProfiles() });
});

app.get('/api/marketing/campaigns', requireAdmin, requirePermission(PERMISSIONS.MARKETING_VIEW), async (req, res) => {
  res.json({ campaigns: await listMarketingCampaigns() });
});

app.get('/api/marketing/campaigns/:campaignId', requireAdmin, requirePermission(PERMISSIONS.MARKETING_VIEW), async (req, res) => {
  const campaign = await getMarketingCampaignDetail(req.params.campaignId);
  if (!campaign) {
    return res.status(404).json({ error: 'Marketing campaign not found' });
  }
  res.json({ campaign });
});

app.post('/api/marketing/campaigns', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  const campaign = await upsertMarketingCampaign({
    campaignId: req.body.campaignId,
    name: req.body.name,
    subject: req.body.subject,
    previewText: req.body.previewText,
    htmlBody: req.body.htmlBody,
    textBody: req.body.textBody,
    senderProfileId: req.body.senderProfileId,
    segment: req.body.segment,
    adminId: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.campaign.upsert',
    targetType: 'marketing_campaign',
    targetId: String(campaign._id || ''),
    details: { name: campaign.name, subject: campaign.subject }
  });

  res.json({ campaign, campaigns: await listMarketingCampaigns() });
});

app.post('/api/marketing/campaigns/:campaignId/send', requireAdmin, requirePermission(PERMISSIONS.MARKETING_EDIT), async (req, res) => {
  const result = await sendMarketingCampaign({
    campaignId: req.params.campaignId
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'marketing.campaign.send',
    targetType: 'marketing_campaign',
    targetId: req.params.campaignId,
    details: {
      delivered: result.delivered,
      failed: result.failed,
      recipients: result.recipients
    }
  });

  res.json({
    result,
    campaigns: await listMarketingCampaigns()
  });
});

app.get('/api/customers/:accountId', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
  res.json(await getCustomerDetail(req.params.accountId));
});

app.get('/api/mailbox-users', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Number(req.query.limit || 50) || 50, 200);
  res.json({ mailboxUsers: await listMailboxUsers({ search, limit }) });
});

app.get('/api/mailbox-users/:userId', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_VIEW), async (req, res) => {
  const detail = await getMailboxUserDetail(req.params.userId);
  if (!detail || !detail.user) {
    return res.status(404).json({ error: 'Mailbox user not found' });
  }

  res.json(detail);
});

app.post('/api/mailbox-users/:userId/import-customer', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_EDIT), async (req, res) => {
  const result = await importMailboxUserToCustomer(req.params.userId);

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'mailbox_user.import_customer',
    targetType: 'mailbox_user',
    targetId: req.params.userId,
    details: {
      emailAddress: result.mailboxUser.address,
      billingAccountId: String(result.account._id || '')
    }
  });

  res.json({
    mailboxUser: result.mailboxUser,
    account: result.account
  });
});

app.post('/api/customers/manual-provision', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_EDIT), async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const fullName = String(req.body.fullName || '').trim();
  const billingEmail = String(req.body.billingEmail || '').trim().toLowerCase();
  const recoveryEmail = String(req.body.recoveryEmail || '').trim().toLowerCase();

  if (!username || !password || !fullName) {
    return res.status(400).json({ error: 'Full name, username, and password are required' });
  }

  const wildduckUser = await createMailbox({
    fullName,
    username,
    password,
    sessionId: req.session.id,
    ip: req.ip
  });

  const account = await createOrUpdateCustomerAccount({
    username,
    emailAddress: `${username}@${getServiceDomain()}`,
    fullName,
    billingEmail,
    recoveryEmail,
    wildduckUserId: wildduckUser && wildduckUser.id,
    status: 'active',
    plan: {
      name: 'Admin Provisioned',
      price: 0
    },
    subscription: {
      id: null,
      status: 'manual'
    },
    meta: {
      provisionedByAdmin: true,
      provisionedAt: new Date().toISOString()
    }
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'customer.manual_provision',
    targetType: 'billing_account',
    targetId: String(account._id),
    details: { emailAddress: account.emailAddress }
  });

  res.status(201).json(await getCustomerDetail(account._id));
});

app.patch('/api/customers/:accountId', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_EDIT), async (req, res) => {
  const detail = await updateCustomerAccount({
    accountId: req.params.accountId,
    updates: req.body || {}
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'customer.update',
    targetType: 'billing_account',
    targetId: req.params.accountId,
    details: { fields: Object.keys(req.body || {}) }
  });

  res.json(detail);
});

app.post('/api/customers/:accountId/notes', requireAdmin, requirePermission(PERMISSIONS.CUSTOMERS_EDIT), async (req, res) => {
  await createSupportNote({
    accountId: req.params.accountId,
    adminId: req.admin._id,
    body: req.body.body
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'customer.note.create',
    targetType: 'billing_account',
    targetId: req.params.accountId,
    details: {}
  });

  res.json(await getCustomerDetail(req.params.accountId));
});

app.get('/api/admin-users', requireAdmin, requirePermission(PERMISSIONS.ADMINS_VIEW), async (req, res) => {
  res.json({ admins: await listAdminUsers() });
});

app.post('/api/admin-users', requireAdmin, requirePermission(PERMISSIONS.ADMINS_EDIT), async (req, res) => {
  const admin = await createAdminUser({
    email: req.body.email,
    password: req.body.password,
    name: req.body.name,
    role: req.body.role || ROLES.READ_ONLY_ADMIN,
    createdBy: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'admin.create',
    targetType: 'admin_user',
    targetId: String(admin._id),
    details: { email: admin.email, role: admin.role }
  });

  res.status(201).json({ admin });
});

app.patch('/api/admin-users/:adminId', requireAdmin, requirePermission(PERMISSIONS.ADMINS_EDIT), async (req, res) => {
  const admin = await updateAdminUser({
    adminId: req.params.adminId,
    role: req.body.role,
    status: req.body.status
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'admin.update',
    targetType: 'admin_user',
    targetId: req.params.adminId,
    details: { role: req.body.role, status: req.body.status }
  });

  res.json({ admin });
});

app.get('/api/audit-logs', requireAdmin, requirePermission(PERMISSIONS.AUDIT_VIEW), async (req, res) => {
  const limit = Math.min(Number(req.query.limit || 50) || 50, 200);
  res.json({ auditLogs: await listAuditLogs(limit) });
});

app.get('/api/billing/payments', requireAdmin, requirePermission(PERMISSIONS.BILLING_VIEW), async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Number(req.query.limit || 50) || 50, 200);
  res.json({ payments: await listRecentPayments({ search, limit }) });
});

app.post('/api/billing/adjustments', requireAdmin, requirePermission(PERMISSIONS.BILLING_EDIT), async (req, res) => {
  const payment = await createManualPayment({
    accountId: req.body.accountId,
    amount: req.body.amount,
    notes: req.body.notes,
    invoiceNumber: req.body.invoiceNumber,
    status: req.body.status || 'paid',
    adminId: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'billing.manual_adjustment',
    targetType: 'billing_payment',
    targetId: String(payment._id || ''),
    details: { accountId: req.body.accountId, amount: req.body.amount }
  });

  res.status(201).json({ payment });
});

app.get('/api/billing/payments/:paymentId/invoice', requireAdmin, requirePermission(PERMISSIONS.BILLING_VIEW), async (req, res) => {
  const payment = await getPaymentById(req.params.paymentId);
  if (!payment) {
    return res.status(404).json({ error: 'Payment not found' });
  }

  const detail = await getCustomerDetail(payment.accountId);
  const account = detail.account || {};
  const pdf = await buildInvoicePdf({
    invoiceNumber: payment.invoiceNumber,
    fullName: account.fullName,
    billingEmail: account.billingEmail,
    emailAddress: account.emailAddress || payment.emailAddress,
    createdAt: payment.createdAt,
    planName: account.plan && account.plan.name,
    transactionId: payment.transactionId,
    amount: payment.amount,
    paymentStatus: payment.status
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${payment.invoiceNumber || 'yoover-invoice'}.pdf"`);
  return res.send(pdf);
});

app.get('/api/settings', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_VIEW), async (req, res) => {
  res.json({
    settings: await getSettingsSnapshot(),
    webmailEnv: await listWebmailEnvEntries(),
    envPreview: [
      { key: 'ADMIN_PANEL_SERVICE_DOMAIN', value: process.env.ADMIN_PANEL_SERVICE_DOMAIN || 'Not configured' },
      { key: 'ADMIN_PANEL_COMPOSE_PROJECT', value: process.env.ADMIN_PANEL_COMPOSE_PROJECT || 'Not configured' },
      { key: 'ADMIN_PANEL_WEBMAIL_ENV_FILE', value: process.env.ADMIN_PANEL_WEBMAIL_ENV_FILE || 'Not configured' }
    ]
  });
});

app.post('/api/settings/webmail-env', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_EDIT), async (req, res) => {
  const key = String((req.body && req.body.key) || '').trim();
  const value = String((req.body && req.body.value) || '');

  const webmailEnv = await upsertWebmailEnvEntry({ key, value });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'webmail_env.upsert',
    targetType: 'env_file',
    targetId: key,
    details: { key }
  });

  res.json({ webmailEnv });
});

app.delete('/api/settings/webmail-env/:key', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_EDIT), async (req, res) => {
  const key = String(req.params.key || '').trim();
  const webmailEnv = await removeWebmailEnvEntry(key);

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'webmail_env.remove',
    targetType: 'env_file',
    targetId: key,
    details: { key }
  });

  res.json({ webmailEnv });
});

app.post('/api/settings', requireAdmin, requirePermission(PERMISSIONS.SETTINGS_EDIT), async (req, res) => {
  const key = String((req.body && req.body.key) || '').trim();
  const value = String((req.body && req.body.value) || '');

  await upsertAdminSetting({
    key,
    value,
    adminId: req.admin._id
  });

  await recordAuditLog({
    adminId: req.admin._id,
    action: 'setting.upsert',
    targetType: 'admin_setting',
    targetId: key,
    details: { key }
  });

  res.json({
    settings: await getSettingsSnapshot()
  });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Yoover admin listening on ${port}`);
});
