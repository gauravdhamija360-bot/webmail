import React, { useEffect, useState } from 'react';

const sections = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'operations', label: 'Operations' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'mailbox-users', label: 'Mailbox Users' },
  { id: 'customers', label: 'Customers' },
  { id: 'billing', label: 'Billing' },
  { id: 'plans', label: 'Plans' },
  { id: 'settings', label: 'Settings' },
  { id: 'admins', label: 'Admin Users' },
  { id: 'audit', label: 'Audit Logs' }
];

const defaultSectionId = sections[0].id;
const validSectionIds = new Set(sections.map(section => section.id));
const normalizeSectionId = value => (validSectionIds.has(value) ? value : defaultSectionId);
const getSectionFromHash = () => normalizeSectionId(String(window.location.hash || '').replace(/^#/, ''));

const roleOptions = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'billing_admin', label: 'Billing Admin' },
  { value: 'support_admin', label: 'Support Admin' },
  { value: 'ops_admin', label: 'Operations Admin' },
  { value: 'read_only_admin', label: 'Read Only' }
];

const statusOptions = ['active', 'payment-captured', 'active-pending-billing', 'manual', 'disabled', 'canceled'];

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
};

const StatCard = ({ label, value, hint }) => (
  <div className="stat-card">
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{hint}</small>
  </div>
);

const MiniMetric = ({ label, value }) => (
  <div className="detail-item">
    <strong>{label}</strong>
    <span>{value}</span>
  </div>
);

const EmptyState = ({ title, copy }) => (
  <div className="panel-empty">
    <strong>{title}</strong>
    <span>{copy}</span>
  </div>
);

const formatMoney = amount =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(amount) || 0);

const SimpleBarChart = ({ title, rows, valueFormatter = value => value }) => {
  const max = Math.max(...rows.map(row => Number(row.value) || 0), 1);

  return (
    <section className="panel-card">
      <div className="panel-card-header">
        <h3>{title}</h3>
        <span>Last 30 days</span>
      </div>
      <div className="chart-stack">
        {rows.length ? (
          rows.map(row => (
            <div key={row.label} className="chart-row">
              <div className="chart-meta">
                <strong>{row.label}</strong>
                <span>{valueFormatter(row.value)}</span>
              </div>
              <div className="chart-track">
                <div className="chart-bar" style={{ width: `${Math.max(8, (Number(row.value) / max) * 100)}%` }} />
              </div>
            </div>
          ))
        ) : (
          <p className="empty-state">No trend data available yet.</p>
        )}
      </div>
    </section>
  );
};

export default function App() {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState(() => getSectionFromHash());
  const [error, setError] = useState('');
  const [login, setLogin] = useState({ email: '', password: '' });
  const [dashboard, setDashboard] = useState(null);
  const [health, setHealth] = useState(null);
  const [operations, setOperations] = useState(null);
  const [managedServices, setManagedServices] = useState([]);
  const [serviceAction, setServiceAction] = useState({ activeKey: '', output: '', status: '', logs: '' });
  const [marketingRecipients, setMarketingRecipients] = useState([]);
  const [marketingSenders, setMarketingSenders] = useState([]);
  const [marketingCampaigns, setMarketingCampaigns] = useState([]);
  const [marketingSearch, setMarketingSearch] = useState('');
  const [marketingStatus, setMarketingStatus] = useState('');
  const [marketingImportText, setMarketingImportText] = useState('');
  const [marketingActionStatus, setMarketingActionStatus] = useState('');
  const [senderForm, setSenderForm] = useState({
    profileId: '',
    name: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: 'false',
    smtpUser: '',
    smtpPass: ''
  });
  const [campaignForm, setCampaignForm] = useState({
    campaignId: '',
    name: '',
    subject: '',
    previewText: '',
    senderProfileId: '',
    segment: 'all',
    textBody: '',
    htmlBody: ''
  });
  const [mailboxUsers, setMailboxUsers] = useState([]);
  const [mailboxUserDetail, setMailboxUserDetail] = useState(null);
  const [selectedMailboxUserId, setSelectedMailboxUserId] = useState('');
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [mailboxCreateForm, setMailboxCreateForm] = useState({
    fullName: '',
    username: '',
    password: ''
  });
  const [mailboxEditForm, setMailboxEditForm] = useState({
    fullName: '',
    status: 'active',
    password: '',
    quotaMb: '1024',
    dailyEmails: '2000'
  });
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [plans, setPlans] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [settings, setSettings] = useState({ settings: [], envPreview: [], webmailEnv: { entries: [], filePath: '' } });
  const [customerDetail, setCustomerDetail] = useState(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerStatus, setCustomerStatus] = useState('');
  const [customerPlan, setCustomerPlan] = useState('');
  const [billingSearch, setBillingSearch] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [adminForm, setAdminForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'read_only_admin'
  });
  const [manualProvisionForm, setManualProvisionForm] = useState({
    fullName: '',
    username: '',
    password: '',
    billingEmail: '',
    recoveryEmail: ''
  });
  const [detailForm, setDetailForm] = useState({
    fullName: '',
    billingEmail: '',
    recoveryEmail: '',
    status: '',
    planName: '',
    planPrice: ''
  });
  const [manualAdjustmentForm, setManualAdjustmentForm] = useState({
    accountId: '',
    amount: '',
    invoiceNumber: '',
    notes: '',
    status: 'paid'
  });
  const [planForm, setPlanForm] = useState({
    planId: '',
    code: '',
    name: '',
    summary: '',
    description: '',
    price: '',
    currency: 'USD',
    intervalLength: '1',
    intervalUnit: 'months',
    featured: false,
    active: true,
    checkoutEnabled: true,
    highlightTag: '',
    benefits: '',
    sortOrder: '10'
  });
  const [adminSaving, setAdminSaving] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [plansActionStatus, setPlansActionStatus] = useState('');
  const [settingsDrafts, setSettingsDrafts] = useState({});
  const [webmailEnvDrafts, setWebmailEnvDrafts] = useState({});
  const [webmailEnvForm, setWebmailEnvForm] = useState({ key: '', value: '' });
  const [settingsSavingKey, setSettingsSavingKey] = useState('');
  const [webmailEnvSavingKey, setWebmailEnvSavingKey] = useState('');
  const [testNotificationRecipient, setTestNotificationRecipient] = useState('');
  const [testNotificationStatus, setTestNotificationStatus] = useState('');
  const [mailboxDefaultsStatus, setMailboxDefaultsStatus] = useState('');
  const [sectionLoading, setSectionLoading] = useState({});

  const loadSession = async () => {
    try {
      const data = await api('/api/auth/me');
      setAdmin(data.admin);
      setError('');
    } catch (err) {
      setAdmin(null);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerDetail = async accountId => {
    if (!accountId) {
      setCustomerDetail(null);
      return;
    }

    const data = await api(`/api/customers/${accountId}`);
    setCustomerDetail(data);
  };

  const loadMailboxUserDetail = async userId => {
    if (!userId) {
      setMailboxUserDetail(null);
      return;
    }

    const data = await api(`/api/mailbox-users/${userId}`);
    setMailboxUserDetail(data);
  };

  const loadSectionData = async section => {
    setSectionLoading(current => ({ ...current, [section]: true }));
    const loaders = {
      dashboard: async () => {
        const [summaryData, healthData] = await Promise.all([api('/api/dashboard/summary'), api('/api/dashboard/health')]);
        setDashboard(summaryData.summary);
        setHealth(healthData);
      },
      operations: async () => {
        const [operationsData, servicesData] = await Promise.all([api('/api/operations/overview'), api('/api/operations/services')]);
        setOperations(operationsData);
        setManagedServices(servicesData.services || []);
      },
      marketing: async () => {
        const recipientQuery = new URLSearchParams({
          search: marketingSearch,
          status: marketingStatus
        });
        const [recipientsData, sendersData, campaignsData] = await Promise.all([
          api(`/api/marketing/recipients?${recipientQuery.toString()}`),
          api('/api/marketing/senders'),
          api('/api/marketing/campaigns')
        ]);
        setMarketingRecipients(recipientsData.recipients || []);
        setMarketingSenders(sendersData.senderProfiles || []);
        setMarketingCampaigns(campaignsData.campaigns || []);
      },
      'mailbox-users': async () => {
        const data = await api(`/api/mailbox-users?search=${encodeURIComponent(mailboxSearch)}`);
        setMailboxUsers(data.mailboxUsers);
      },
      customers: async () => {
        const query = new URLSearchParams({
          search: customerSearch,
          status: customerStatus,
          plan: customerPlan
        });
        const data = await api(`/api/customers?${query.toString()}`);
        setCustomers(data.customers);
      },
      billing: async () => {
        const data = await api(`/api/billing/payments?search=${encodeURIComponent(billingSearch)}`);
        setPayments(data.payments);
      },
      plans: async () => {
        const data = await api('/api/billing/plans');
        setPlans(data.plans || []);
      },
      settings: async () => setSettings(await api('/api/settings')),
      admins: async () => setAdmins((await api('/api/admin-users')).admins),
      audit: async () => setAuditLogs((await api('/api/audit-logs')).auditLogs)
    };

    try {
      if (loaders[section]) {
        await loaders[section]();
      }
    } finally {
      setSectionLoading(current => ({ ...current, [section]: false }));
    }
  };

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      const nextSection = getSectionFromHash();
      setActiveSection(current => (current === nextSection ? current : nextSection));
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);

    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, []);

  useEffect(() => {
    const nextHash = `#${activeSection}`;
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    }
  }, [activeSection]);

  useEffect(() => {
    if (!admin) {
      return;
    }

    loadSectionData(activeSection).catch(err => setError(err.message));
  }, [admin, activeSection]);

  useEffect(() => {
    if (activeSection !== 'marketing' || !admin) {
      return;
    }

    loadSectionData('marketing').catch(err => setError(err.message));
  }, [marketingSearch, marketingStatus]);

  useEffect(() => {
    if (activeSection !== 'mailbox-users' || !admin) {
      return;
    }

    loadSectionData('mailbox-users').catch(err => setError(err.message));
  }, [mailboxSearch]);

  useEffect(() => {
    if (activeSection !== 'customers' || !admin) {
      return;
    }

    loadSectionData('customers').catch(err => setError(err.message));
  }, [customerSearch, customerStatus, customerPlan]);

  useEffect(() => {
    if (activeSection !== 'billing' || !admin) {
      return;
    }

    loadSectionData('billing').catch(err => setError(err.message));
  }, [billingSearch]);

  useEffect(() => {
    const nextDrafts = {};
    settings.settings.forEach(entry => {
      nextDrafts[entry.key] = entry.value || '';
    });
    setSettingsDrafts(nextDrafts);
  }, [settings.settings]);

  useEffect(() => {
    const nextDrafts = {};
    (settings.webmailEnv?.entries || []).forEach(entry => {
      nextDrafts[entry.key] = entry.value || '';
    });
    setWebmailEnvDrafts(nextDrafts);
  }, [settings.webmailEnv]);

  useEffect(() => {
    if (!mailboxUserDetail || !mailboxUserDetail.user) {
      setMailboxEditForm({
        fullName: '',
        status: 'active',
        password: '',
        quotaMb: '1024',
        dailyEmails: '2000'
      });
      return;
    }

    setMailboxEditForm({
      fullName: mailboxUserDetail.user.name || '',
      status: mailboxUserDetail.user.disabled ? 'disabled' : 'active',
      password: '',
      quotaMb: String(Math.max(1, Math.round((Number(mailboxUserDetail.user.quota || 0) || 0) / (1024 * 1024)) || 1024)),
      dailyEmails: String(Number(mailboxUserDetail.user.recipients || 0) || 2000)
    });
  }, [mailboxUserDetail]);

  useEffect(() => {
    if (!selectedMailboxUserId || activeSection !== 'mailbox-users') {
      return;
    }

    loadMailboxUserDetail(selectedMailboxUserId).catch(err => setError(err.message));
  }, [selectedMailboxUserId, activeSection]);

  useEffect(() => {
    if (!mailboxUsers.length) {
      setSelectedMailboxUserId('');
      setMailboxUserDetail(null);
      return;
    }

    const selectedStillVisible = mailboxUsers.some(user => String(user._id) === selectedMailboxUserId);
    if (!selectedMailboxUserId || !selectedStillVisible) {
      setSelectedMailboxUserId(String(mailboxUsers[0]._id));
    }
  }, [mailboxUsers, selectedMailboxUserId]);

  useEffect(() => {
    if (!selectedCustomerId || activeSection !== 'customers') {
      return;
    }

    loadCustomerDetail(selectedCustomerId).catch(err => setError(err.message));
  }, [selectedCustomerId, activeSection]);

  useEffect(() => {
    if (!customers.length) {
      setSelectedCustomerId('');
      setCustomerDetail(null);
      return;
    }

    const selectedStillVisible = customers.some(customer => customer._id === selectedCustomerId);
    if (!selectedCustomerId || !selectedStillVisible) {
      setSelectedCustomerId(customers[0]._id);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    const account = customerDetail && customerDetail.account;
    if (!account) {
      return;
    }

    setDetailForm({
      fullName: account.fullName || '',
      billingEmail: account.billingEmail || '',
      recoveryEmail: account.recoveryEmail || '',
      status: account.status || '',
      planName: (account.plan && account.plan.name) || '',
      planPrice: account.plan && account.plan.price ? String(account.plan.price) : ''
    });

    setManualAdjustmentForm(current => ({
      ...current,
      accountId: String(account._id || '')
    }));
  }, [customerDetail]);

  useEffect(() => {
    if (!plans.length) {
      setPlanForm({
        planId: '',
        code: '',
        name: '',
        summary: '',
        description: '',
        price: '',
        currency: 'USD',
        intervalLength: '1',
        intervalUnit: 'months',
        featured: false,
        active: true,
        checkoutEnabled: true,
        highlightTag: '',
        benefits: '',
        sortOrder: '10'
      });
      return;
    }
  }, [plans]);

  const handleLogin = async event => {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(login)
      });
      setAdmin(data.admin);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleLogout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setAdmin(null);
    setDashboard(null);
    setHealth(null);
  };

  const handleAdminCreate = async event => {
    event.preventDefault();
    setAdminSaving(true);
    setError('');

    try {
      await api('/api/admin-users', {
        method: 'POST',
        body: JSON.stringify(adminForm)
      });
      setAdminForm({
        name: '',
        email: '',
        password: '',
        role: 'read_only_admin'
      });
      await loadSectionData('admins');
    } catch (err) {
      setError(err.message);
    } finally {
      setAdminSaving(false);
    }
  };

  const handleAdminUpdate = async (adminId, payload) => {
    setError('');
    try {
      await api(`/api/admin-users/${adminId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await loadSectionData('admins');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSettingSave = async entry => {
    setSettingsSavingKey(entry.key);
    setError('');

    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          key: entry.key,
          value: settingsDrafts[entry.key] || ''
        })
      });
      await loadSectionData('settings');
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsSavingKey('');
    }
  };

  const handleApplyMailboxDefaultsToExisting = async () => {
    setError('');
    setMailboxDefaultsStatus('');

    try {
      const data = await api('/api/settings/mailbox-defaults/apply', {
        method: 'POST',
        body: JSON.stringify({
          quotaMb: settingsDrafts.MAILBOX_DEFAULT_QUOTA_MB || '',
          dailyEmails: settingsDrafts.MAILBOX_DEFAULT_DAILY_EMAIL_LIMIT || ''
        })
      });
      setMailboxDefaultsStatus(`Updated ${data.updated || 0} existing mailbox users.`);
      if (activeSection === 'mailbox-users') {
        await loadSectionData('mailbox-users');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleNoteSave = async event => {
    event.preventDefault();
    if (!selectedCustomerId) {
      return;
    }

    setError('');
    try {
      const data = await api(`/api/customers/${selectedCustomerId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ body: noteBody })
      });
      setCustomerDetail(data);
      setNoteBody('');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleManualProvision = async event => {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/api/customers/manual-provision', {
        method: 'POST',
        body: JSON.stringify(manualProvisionForm)
      });
      setManualProvisionForm({
        fullName: '',
        username: '',
        password: '',
        billingEmail: '',
        recoveryEmail: ''
      });
      await loadSectionData('customers');
      if (data && data.account && data.account._id) {
        setSelectedCustomerId(String(data.account._id));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCustomerUpdate = async event => {
    event.preventDefault();
    if (!selectedCustomerId) {
      return;
    }

    setError('');
    try {
      const data = await api(`/api/customers/${selectedCustomerId}`, {
        method: 'PATCH',
        body: JSON.stringify(detailForm)
      });
      setCustomerDetail(data);
      await loadSectionData('customers');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleManualAdjustment = async event => {
    event.preventDefault();
    setError('');
    try {
      await api('/api/billing/adjustments', {
        method: 'POST',
        body: JSON.stringify(manualAdjustmentForm)
      });
      setManualAdjustmentForm(current => ({
        ...current,
        amount: '',
        invoiceNumber: '',
        notes: '',
        status: 'paid'
      }));
      if (selectedCustomerId) {
        await loadCustomerDetail(selectedCustomerId);
      }
      await loadSectionData('billing');
    } catch (err) {
      setError(err.message);
    }
  };

  const getEmptyPlanForm = () => ({
    planId: '',
    code: '',
    name: '',
    summary: '',
    description: '',
    price: '',
    currency: 'USD',
    intervalLength: '1',
    intervalUnit: 'months',
    featured: false,
    active: true,
    checkoutEnabled: true,
    highlightTag: '',
    benefits: '',
    sortOrder: '10'
  });

  const handlePlanSave = async event => {
    event.preventDefault();
    setPlanSaving(true);
    setPlansActionStatus('');
    setError('');

    try {
      const data = await api('/api/billing/plans', {
        method: 'POST',
        body: JSON.stringify({
          ...planForm,
          benefits: String(planForm.benefits || '')
            .split(/\r?\n/)
            .map(item => item.trim())
            .filter(Boolean)
        })
      });
      setPlans(data.plans || []);
      setPlanForm(getEmptyPlanForm());
      setPlansActionStatus(planForm.planId ? 'Plan updated successfully.' : 'Plan created successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPlanSaving(false);
    }
  };

  const handlePlanEdit = plan => {
    setPlansActionStatus('');
    setPlanForm({
      planId: String(plan._id || ''),
      code: plan.code || '',
      name: plan.name || '',
      summary: plan.summary || '',
      description: plan.description || '',
      price: String(plan.price ?? ''),
      currency: plan.currency || 'USD',
      intervalLength: String(plan.displayIntervalLength || plan.intervalLength || 1),
      intervalUnit: plan.cadence || plan.intervalUnit || 'months',
      featured: Boolean(plan.featured),
      active: plan.active !== false,
      checkoutEnabled: plan.checkoutEnabled !== false,
      highlightTag: plan.highlightTag || '',
      benefits: (plan.benefits || []).join('\n'),
      sortOrder: String(plan.sortOrder || 0)
    });
  };

  const handlePlanDelete = async planId => {
    setPlanSaving(true);
    setPlansActionStatus('');
    setError('');

    try {
      const data = await api(`/api/billing/plans/${planId}`, {
        method: 'DELETE'
      });
      setPlans(data.plans || []);
      if (planForm.planId === String(planId)) {
        setPlanForm(getEmptyPlanForm());
      }
      setPlansActionStatus('Plan removed successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPlanSaving(false);
    }
  };

  const handlePlanCreateNew = () => {
    setPlansActionStatus('');
    setPlanForm(getEmptyPlanForm());
  };

  const handleMailboxImport = async userId => {
    setError('');
    try {
      const data = await api(`/api/mailbox-users/${userId}/import-customer`, {
        method: 'POST'
      });
      await Promise.all([loadSectionData('mailbox-users'), loadSectionData('customers')]);
      await loadMailboxUserDetail(userId);
      if (data && data.account && data.account._id) {
        setSelectedCustomerId(String(data.account._id));
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMailboxCreate = async event => {
    event.preventDefault();
    setError('');
    try {
      const data = await api('/api/mailbox-users', {
        method: 'POST',
        body: JSON.stringify(mailboxCreateForm)
      });
      setMailboxCreateForm({
        fullName: '',
        username: '',
        password: ''
      });
      await loadSectionData('mailbox-users');
      const nextId = String((data && data.mailboxUser && data.mailboxUser.id) || '');
      if (nextId) {
        setSelectedMailboxUserId(nextId);
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMailboxUpdate = async event => {
    event.preventDefault();
    if (!selectedMailboxUserId) {
      return;
    }

    setError('');
    try {
      const data = await api(`/api/mailbox-users/${selectedMailboxUserId}`, {
        method: 'PATCH',
        body: JSON.stringify(mailboxEditForm)
      });
      setMailboxUserDetail(data);
      setMailboxEditForm(current => ({ ...current, password: '' }));
      await loadSectionData('mailbox-users');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMailboxDelete = async () => {
    if (!selectedMailboxUserId || !mailboxUserDetail || !mailboxUserDetail.user) {
      return;
    }

    const confirmed = window.confirm(
      `Delete mailbox ${mailboxUserDetail.user.address || mailboxUserDetail.user.username}? This removes the mailbox from WildDuck.`
    );

    if (!confirmed) {
      return;
    }

    setError('');
    try {
      await api(`/api/mailbox-users/${selectedMailboxUserId}`, {
        method: 'DELETE'
      });
      setMailboxUserDetail(null);
      setSelectedMailboxUserId('');
      await loadSectionData('mailbox-users');
    } catch (err) {
      setError(err.message);
    }
  };

  const openLinkedCustomer = async accountId => {
    setActiveSection('customers');
    setSelectedCustomerId(String(accountId));
    try {
      await loadCustomerDetail(accountId);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTestNotification = async event => {
    event.preventDefault();
    setError('');
    setTestNotificationStatus('');
    try {
      const data = await api('/api/operations/test-notification', {
        method: 'POST',
        body: JSON.stringify({ recipient: testNotificationRecipient })
      });
      setTestNotificationStatus(`Test notification sent to ${data.recipient}`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleServiceRestart = async serviceKey => {
    setError('');
    setServiceAction({
      activeKey: serviceKey,
      output: 'Restart request sent to Docker...',
      status: '',
      logs: ''
    });

    try {
      const data = await api(`/api/operations/services/${encodeURIComponent(serviceKey)}/restart`, {
        method: 'POST'
      });
      await loadSectionData('operations');
      setServiceAction({
        activeKey: '',
        output: data.commandOutput || 'Restart completed.',
        status: data.statusOutput || '',
        logs: data.logsOutput || ''
      });
    } catch (err) {
      setServiceAction(current => ({ ...current, activeKey: '', output: '' }));
      setError(err.message);
    }
  };

  const handleMarketingImport = async event => {
    event.preventDefault();
    setError('');
    setMarketingActionStatus('');

    try {
      const data = await api('/api/marketing/recipients/import', {
        method: 'POST',
        body: JSON.stringify({ csvText: marketingImportText })
      });
      setMarketingRecipients(data.recipients || []);
      setMarketingImportText('');
      setMarketingActionStatus(`Imported ${data.result.imported} recipient(s).`);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMarketingFile = async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setMarketingImportText(text);
  };

  const handleRecipientStatusChange = async (recipientId, status) => {
    setError('');
    try {
      await api(`/api/marketing/recipients/${recipientId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await loadSectionData('marketing');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRecipientRemove = async recipientId => {
    setError('');
    try {
      await api(`/api/marketing/recipients/${recipientId}`, {
        method: 'DELETE'
      });
      await loadSectionData('marketing');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSenderSave = async event => {
    event.preventDefault();
    setError('');
    setMarketingActionStatus('');
    try {
      const data = await api('/api/marketing/senders', {
        method: 'POST',
        body: JSON.stringify(senderForm)
      });
      setMarketingSenders(data.senderProfiles || []);
      setSenderForm({
        profileId: '',
        name: '',
        fromName: '',
        fromEmail: '',
        replyTo: '',
        smtpHost: '',
        smtpPort: '587',
        smtpSecure: 'false',
        smtpUser: '',
        smtpPass: ''
      });
      setMarketingActionStatus('Sender profile saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSenderEdit = profile => {
    setSenderForm({
      profileId: String(profile._id || ''),
      name: profile.name || '',
      fromName: profile.fromName || '',
      fromEmail: profile.fromEmail || '',
      replyTo: profile.replyTo || '',
      smtpHost: profile.smtpHost || '',
      smtpPort: String(profile.smtpPort || 587),
      smtpSecure: String(Boolean(profile.smtpSecure)),
      smtpUser: profile.smtpUser || '',
      smtpPass: ''
    });
  };

  const handleSenderRemove = async profileId => {
    setError('');
    try {
      const data = await api(`/api/marketing/senders/${profileId}`, {
        method: 'DELETE'
      });
      setMarketingSenders(data.senderProfiles || []);
      if (senderForm.profileId === String(profileId)) {
        setSenderForm({
          profileId: '',
          name: '',
          fromName: '',
          fromEmail: '',
          replyTo: '',
          smtpHost: '',
          smtpPort: '587',
          smtpSecure: 'false',
          smtpUser: '',
          smtpPass: ''
        });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCampaignSave = async event => {
    event.preventDefault();
    setError('');
    setMarketingActionStatus('');
    try {
      const data = await api('/api/marketing/campaigns', {
        method: 'POST',
        body: JSON.stringify(campaignForm)
      });
      setMarketingCampaigns(data.campaigns || []);
      setCampaignForm(current => ({
        ...current,
        campaignId: String(data.campaign?._id || current.campaignId)
      }));
      setMarketingActionStatus('Campaign saved.');
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCampaignEdit = async campaignId => {
    setError('');
    try {
      const data = await api(`/api/marketing/campaigns/${campaignId}`);
      const campaign = data.campaign;
      setCampaignForm({
        campaignId: String(campaign._id || ''),
        name: campaign.name || '',
        subject: campaign.subject || '',
        previewText: campaign.previewText || '',
        senderProfileId: String(campaign.senderProfileId || ''),
        segment: campaign.segment || 'all',
        textBody: campaign.textBody || '',
        htmlBody: campaign.htmlBody || ''
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const handleCampaignSend = async campaignId => {
    setError('');
    setMarketingActionStatus('Sending campaign...');
    try {
      const data = await api(`/api/marketing/campaigns/${campaignId}/send`, {
        method: 'POST'
      });
      setMarketingCampaigns(data.campaigns || []);
      setMarketingActionStatus(`Campaign sent to ${data.result.recipients} recipients. Delivered: ${data.result.delivered}, failed: ${data.result.failed}.`);
    } catch (err) {
      setMarketingActionStatus('');
      setError(err.message);
    }
  };

  const handleWebmailEnvSave = async entry => {
    setWebmailEnvSavingKey(entry.key);
    setError('');

    try {
      const nextValue =
        entry.key === 'AUTHORIZE_MODE'
          ? webmailEnvDrafts[entry.key] ?? entry.value ?? 'sandbox'
          : webmailEnvDrafts[entry.key] ?? '';

      const data = await api('/api/settings/webmail-env', {
        method: 'POST',
        body: JSON.stringify({
          key: entry.key,
          value: nextValue
        })
      });
      setSettings(current => ({ ...current, webmailEnv: data.webmailEnv }));
    } catch (err) {
      setError(err.message);
    } finally {
      setWebmailEnvSavingKey('');
    }
  };

  const handleWebmailEnvRemove = async key => {
    setWebmailEnvSavingKey(key);
    setError('');

    try {
      const data = await api(`/api/settings/webmail-env/${encodeURIComponent(key)}`, {
        method: 'DELETE'
      });
      setSettings(current => ({ ...current, webmailEnv: data.webmailEnv }));
    } catch (err) {
      setError(err.message);
    } finally {
      setWebmailEnvSavingKey('');
    }
  };

  const handleWebmailEnvAdd = async event => {
    event.preventDefault();
    setError('');
    setWebmailEnvSavingKey('__new__');

    try {
      const data = await api('/api/settings/webmail-env', {
        method: 'POST',
        body: JSON.stringify(webmailEnvForm)
      });
      setSettings(current => ({ ...current, webmailEnv: data.webmailEnv }));
      setWebmailEnvForm({ key: '', value: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setWebmailEnvSavingKey('');
    }
  };

  const isSectionLoading = sectionLoading[activeSection];

  if (loading) {
    return <div className="screen-state">Loading Yoover Admin...</div>;
  }

  if (!admin) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <p className="eyebrow">Phase 1</p>
          <h1>Yoover Admin Panel</h1>
          <p className="intro">A separate admin workspace for customer operations, billing, support, settings, and reporting.</p>
          <form onSubmit={handleLogin} className="login-form">
            <label>
              <span>Email</span>
              <input type="email" value={login.email} onChange={event => setLogin(current => ({ ...current, email: event.target.value }))} placeholder="admin@yoover.com" required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" value={login.password} onChange={event => setLogin(current => ({ ...current, password: event.target.value }))} placeholder="Your admin password" required />
            </label>
            {error ? <div className="error-box">{error}</div> : null}
            <button type="submit">Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">Y</div>
            <div>
              <p className="eyebrow">Yoover Control</p>
              <h2>Admin Panel</h2>
            </div>
          </div>

          <div className="sidebar-intro">
            <div>
              <span className="sidebar-kicker">Operations Center</span>
              <strong>Manage customers, mailbox users, billing, settings, and platform health in one place.</strong>
            </div>
            <span className="sidebar-status">Live workspace</span>
          </div>

          <div>
            <p className="eyebrow">Workspace</p>
            <p className="sidebar-copy">Separate workspace for operations, support, finance, and platform visibility.</p>
          </div>

          <div className="sidebar-nav-shell">
            <div className="sidebar-nav-title">
              <span>Navigation</span>
              <small>{sections.length} sections</small>
            </div>
            <nav className="admin-nav">
              {sections.map((section, index) => (
                <button key={section.id} className={section.id === activeSection ? 'active' : ''} onClick={() => setActiveSection(section.id)}>
                  <span className="nav-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="nav-label">{section.label}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        <div className="admin-user-card">
          <div className="admin-user-meta">
            <div className="admin-user-avatar">{(admin.name || 'A').charAt(0).toUpperCase()}</div>
            <div>
              <strong>{admin.name}</strong>
              <span>{admin.roleLabel}</span>
              <small>{admin.email}</small>
            </div>
          </div>
          <button onClick={handleLogout}>Sign Out</button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div>
            <p className="eyebrow">Current Section</p>
            <h1>{sections.find(section => section.id === activeSection)?.label}</h1>
          </div>
          <div className="header-chip">{isSectionLoading ? 'Refreshing data' : 'Live admin workspace'}</div>
        </header>

        {error ? <div className="error-box">{error}</div> : null}

        {activeSection === 'dashboard' && dashboard ? (
          <>
            <section className="panel-grid">
              <StatCard label="Total accounts" value={dashboard.accountsTotal} hint="All tracked customer records" />
              <StatCard label="Active accounts" value={dashboard.activeAccounts} hint="Currently provisioned or syncing" />
              <StatCard label="Paid accounts" value={dashboard.paidAccounts} hint="With active or pending subscription" />
              <StatCard label="New this week" value={dashboard.recentAccounts} hint="Fresh signups in the last 7 days" />
              <StatCard label="Revenue total" value={formatMoney(dashboard.revenueTotal || 0)} hint="Captured payments in Mongo" />
              <StatCard label="Payments / 30 days" value={dashboard.paymentsLast30Days} hint="Recent successful payment records" />
            </section>

            <section className="panel-grid settings-grid">
              <SimpleBarChart
                title="Revenue Trend"
                rows={(dashboard.revenueTrend || []).map(item => ({
                  label: item.day,
                  value: item.total
                }))}
                valueFormatter={value => formatMoney(value)}
              />
              <SimpleBarChart
                title="Signup Trend"
                rows={(dashboard.signupTrend || []).map(item => ({
                  label: item.day,
                  value: item.count
                }))}
              />
            </section>

            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Signup Funnel</h3>
                  <span>Operational view</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Leads" value={dashboard.signupFunnel?.leads ?? 0} />
                  <MiniMetric label="Provisioned" value={dashboard.signupFunnel?.provisioned ?? 0} />
                  <MiniMetric label="Subscribed" value={dashboard.signupFunnel?.subscribed ?? 0} />
                  <MiniMetric label="Canceled" value={dashboard.signupFunnel?.canceled ?? 0} />
                </div>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Risk Board</h3>
                  <span>Abuse and finance signals</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Pending Billing" value={dashboard.riskBoard?.pendingBilling ?? 0} />
                  <MiniMetric label="Recent Signups 24h" value={dashboard.riskBoard?.recentSignups24h ?? 0} />
                  <MiniMetric label="Manual Adjustments 7d" value={dashboard.riskBoard?.manualAdjustments7d ?? 0} />
                  <MiniMetric label="Failed Payments 14d" value={dashboard.riskBoard?.failedPayments14d ?? 0} />
                </div>
              </section>
            </section>

            {health ? (
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>System Health</h3>
                  <span>
                    {health.summary?.up ?? 0} up / {health.summary?.down ?? 0} down
                  </span>
                </div>
                <div className="health-grid">
                  {(health.services || []).map(service => (
                    <div className={`health-card ${service.status === 'up' ? 'is-up' : 'is-down'}`} key={service.key}>
                      <strong>{service.label}</strong>
                      <span>{service.status === 'up' ? 'Operational' : 'Unavailable'}</span>
                      <small>
                        {service.host}:{service.port}
                      </small>
                      <small>{service.status === 'up' ? `${service.latencyMs}ms` : service.detail || 'Check failed'}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}

        {activeSection === 'operations' && operations ? (
          <>
            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Domain Configuration</h3>
                  <span>Operational identity</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Primary Domain" value={operations.domains?.primaryDomain || '-'} />
                  <MiniMetric label="IMAP Host" value={operations.domains?.imapHost || '-'} />
                  <MiniMetric label="POP3 Host" value={operations.domains?.pop3Host || '-'} />
                  <MiniMetric label="SMTP Host" value={operations.domains?.smtpHost || '-'} />
                </div>
                <div className="ops-block">
                  <strong>Web Hosts</strong>
                  <span>{operations.domains?.webHosts || '-'}</span>
                </div>
                <div className="ops-block">
                  <strong>Allowed Signup Domains</strong>
                  <span>{operations.domains?.allowedSignupDomains || '-'}</span>
                </div>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Security Policy</h3>
                  <span>Current controls</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Session Hours" value={operations.security?.sessionHours || '-'} />
                  <MiniMetric label="Min Password Length" value={operations.security?.passwordMinLength || '-'} />
                  <MiniMetric label="Require Strong Passwords" value={operations.security?.requireStrongPasswords || '-'} />
                  <MiniMetric label="Require 2FA For Admins" value={operations.security?.require2faForAdmins || '-'} />
                </div>
                <div className="ops-block">
                  <strong>Allow Test Signup Link</strong>
                  <span>{operations.security?.allowTestSignupLink || '-'}</span>
                </div>
              </section>
            </section>

            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Notification Management</h3>
                  <span>SMTP delivery controls</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Recipients" value={operations.notifications?.recipients || '-'} />
                  <MiniMetric label="From Address" value={operations.notifications?.from || '-'} />
                  <MiniMetric label="SMTP Host" value={operations.notifications?.smtpHost || '-'} />
                  <MiniMetric label="SMTP Port" value={operations.notifications?.smtpPort || '-'} />
                </div>
                <div className="ops-block">
                  <strong>SMTP User</strong>
                  <span>{operations.notifications?.smtpUser || 'Not configured'}</span>
                </div>
                <form className="stack-form" onSubmit={handleTestNotification}>
                  <label>
                    <span>Test Recipient</span>
                    <input
                      value={testNotificationRecipient}
                      onChange={event => setTestNotificationRecipient(event.target.value)}
                      placeholder="Optional override recipient"
                    />
                  </label>
                  <button type="submit">Send Test Notification</button>
                  {testNotificationStatus ? <div className="success-box">{testNotificationStatus}</div> : null}
                </form>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Queue Insight</h3>
                  <span>Operational workload</span>
                </div>
                <div className="detail-grid">
                  <MiniMetric label="Pending Billing" value={operations.queueInsight?.pendingBilling ?? 0} />
                  <MiniMetric label="Pending Subscriptions" value={operations.queueInsight?.pendingSubscriptionActivation ?? 0} />
                  <MiniMetric label="Failed Payments 7d" value={operations.queueInsight?.failedPayments7d ?? 0} />
                  <MiniMetric label="Manual Adjustments 7d" value={operations.queueInsight?.manualAdjustments7d ?? 0} />
                </div>
                <div className="ops-block">
                  <strong>Support Notes 7d</strong>
                  <span>{operations.queueInsight?.supportNotes7d ?? 0}</span>
                </div>
              </section>
            </section>

            <section className="panel-card">
              <div className="panel-card-header">
                <h3>Service Controls</h3>
                <span>{managedServices.length} managed services</span>
              </div>
              <div className="service-grid">
                {managedServices.map(service => (
                  <div className="service-card" key={service.key}>
                    <div className="service-card-top">
                      <div>
                        <strong>{service.label}</strong>
                        <span>{service.restartHint}</span>
                      </div>
                      <span className={`service-state service-state-${String(service.state || 'unknown').toLowerCase()}`}>{service.state || 'unknown'}</span>
                    </div>
                    <small>{service.status || 'Status unavailable'}</small>
                    <button type="button" onClick={() => handleServiceRestart(service.key)} disabled={serviceAction.activeKey === service.key}>
                      {serviceAction.activeKey === service.key ? 'Restarting...' : `Restart ${service.label}`}
                    </button>
                  </div>
                ))}
              </div>
              {serviceAction.output || serviceAction.status || serviceAction.logs ? (
                <div className="service-output">
                  {serviceAction.output ? (
                    <div>
                      <strong>Docker command output</strong>
                      <pre>{serviceAction.output}</pre>
                    </div>
                  ) : null}
                  {serviceAction.status ? (
                    <div>
                      <strong>Compose status</strong>
                      <pre>{serviceAction.status}</pre>
                    </div>
                  ) : null}
                  {serviceAction.logs ? (
                    <div>
                      <strong>Recent service logs</strong>
                      <pre>{serviceAction.logs}</pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {activeSection === 'marketing' ? (
          <>
            <section className="panel-grid">
              <StatCard label="Recipients" value={marketingRecipients.length} hint="Loaded from the marketing list" />
              <StatCard label="Sender Profiles" value={marketingSenders.length} hint="Yoover or external SMTP relays" />
              <StatCard label="Campaigns" value={marketingCampaigns.length} hint="Saved bulk mail drafts and sends" />
            </section>

            {marketingActionStatus ? <div className="success-box">{marketingActionStatus}</div> : null}

            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Recipients</h3>
                  <span>Import, export, and manage</span>
                </div>
                <div className="toolbar-grid">
                  <input value={marketingSearch} onChange={event => setMarketingSearch(event.target.value)} placeholder="Search email, name, or segment" />
                  <select value={marketingStatus} onChange={event => setMarketingStatus(event.target.value)}>
                    <option value="">All statuses</option>
                    <option value="subscribed">subscribed</option>
                    <option value="unsubscribed">unsubscribed</option>
                    <option value="suppressed">suppressed</option>
                  </select>
                  <a className="secondary-link" href="/api/marketing/recipients/export" target="_blank" rel="noreferrer">
                    Export CSV
                  </a>
                </div>
                <form className="stack-form" onSubmit={handleMarketingImport}>
                  <label>
                    <span>Upload CSV</span>
                    <input type="file" accept=".csv,text/csv" onChange={handleMarketingFile} />
                  </label>
                  <label>
                    <span>Paste CSV Rows</span>
                    <textarea value={marketingImportText} onChange={event => setMarketingImportText(event.target.value)} rows="7" placeholder={'email,name,status,segment\nperson@example.com,John Doe,subscribed,general'} />
                  </label>
                  <button type="submit">Import Recipient List</button>
                </form>
                <div className="table-wrap marketing-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Name</th>
                        <th>Segment</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {marketingRecipients.length ? (
                        marketingRecipients.map(recipient => (
                          <tr key={String(recipient._id)}>
                            <td>{recipient.email}</td>
                            <td>{recipient.name || '-'}</td>
                            <td>{recipient.segment || 'general'}</td>
                            <td>
                              <select value={recipient.status || 'subscribed'} onChange={event => handleRecipientStatusChange(String(recipient._id), event.target.value)}>
                                <option value="subscribed">subscribed</option>
                                <option value="unsubscribed">unsubscribed</option>
                                <option value="suppressed">suppressed</option>
                              </select>
                            </td>
                            <td>
                              <button type="button" className="danger-button compact-button" onClick={() => handleRecipientRemove(String(recipient._id))}>
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">
                            <EmptyState title="No marketing recipients yet" copy="Import a CSV list of opted-in contacts to begin sending campaigns." />
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Sender Profiles</h3>
                  <span>Yoover or external SMTP relay</span>
                </div>
                <form className="stack-form" onSubmit={handleSenderSave}>
                  <label>
                    <span>Profile Name</span>
                    <input value={senderForm.name} onChange={event => setSenderForm(current => ({ ...current, name: event.target.value }))} placeholder="Monthly Newsletter Sender" required />
                  </label>
                  <label>
                    <span>From Name</span>
                    <input value={senderForm.fromName} onChange={event => setSenderForm(current => ({ ...current, fromName: event.target.value }))} placeholder="Yoover Marketing" />
                  </label>
                  <label>
                    <span>From Email</span>
                    <input value={senderForm.fromEmail} onChange={event => setSenderForm(current => ({ ...current, fromEmail: event.target.value }))} placeholder="marketing@yoover.com" required />
                  </label>
                  <label>
                    <span>Reply-To</span>
                    <input value={senderForm.replyTo} onChange={event => setSenderForm(current => ({ ...current, replyTo: event.target.value }))} placeholder="support@yoover.com" />
                  </label>
                  <div className="toolbar-grid">
                    <input value={senderForm.smtpHost} onChange={event => setSenderForm(current => ({ ...current, smtpHost: event.target.value }))} placeholder="SMTP host" />
                    <input value={senderForm.smtpPort} onChange={event => setSenderForm(current => ({ ...current, smtpPort: event.target.value }))} placeholder="Port" />
                    <select value={senderForm.smtpSecure} onChange={event => setSenderForm(current => ({ ...current, smtpSecure: event.target.value }))}>
                      <option value="false">STARTTLS / plain</option>
                      <option value="true">Implicit TLS</option>
                    </select>
                  </div>
                  <label>
                    <span>SMTP Username</span>
                    <input value={senderForm.smtpUser} onChange={event => setSenderForm(current => ({ ...current, smtpUser: event.target.value }))} placeholder="Optional auth user" />
                  </label>
                  <label>
                    <span>SMTP Password</span>
                    <input type="password" value={senderForm.smtpPass} onChange={event => setSenderForm(current => ({ ...current, smtpPass: event.target.value }))} placeholder={senderForm.profileId ? 'Leave blank to keep existing password' : 'SMTP password'} />
                  </label>
                  <button type="submit">{senderForm.profileId ? 'Update Sender Profile' : 'Save Sender Profile'}</button>
                </form>
                <div className="list-stack marketing-list-stack">
                  {marketingSenders.length ? (
                    marketingSenders.map(profile => (
                      <div key={profile._id} className="list-card static-card">
                        <strong>{profile.name}</strong>
                        <span>{profile.fromEmail}</span>
                        <small>
                          {profile.smtpHost}:{profile.smtpPort} · {profile.smtpSecure ? 'TLS' : 'STARTTLS/plain'} · {profile.hasPassword ? 'Password saved' : 'No password'}
                        </small>
                        <div className="action-row">
                          <button type="button" className="secondary-button" onClick={() => handleSenderEdit(profile)}>
                            Edit
                          </button>
                          <button type="button" className="danger-button compact-button" onClick={() => handleSenderRemove(profile._id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState title="No sender profiles yet" copy="Create a sender using Yoover SMTP or any allowed external relay server." />
                  )}
                </div>
              </section>
            </section>

            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Campaign Draft</h3>
                  <span>Create or update</span>
                </div>
                <form className="stack-form" onSubmit={handleCampaignSave}>
                  <label>
                    <span>Campaign Name</span>
                    <input value={campaignForm.name} onChange={event => setCampaignForm(current => ({ ...current, name: event.target.value }))} placeholder="April Product Update" required />
                  </label>
                  <label>
                    <span>Subject</span>
                    <input value={campaignForm.subject} onChange={event => setCampaignForm(current => ({ ...current, subject: event.target.value }))} placeholder="What’s new at Yoover" required />
                  </label>
                  <label>
                    <span>Preview Text</span>
                    <input value={campaignForm.previewText} onChange={event => setCampaignForm(current => ({ ...current, previewText: event.target.value }))} placeholder="Short inbox preview line" />
                  </label>
                  <div className="toolbar-grid">
                    <select value={campaignForm.senderProfileId} onChange={event => setCampaignForm(current => ({ ...current, senderProfileId: event.target.value }))}>
                      <option value="">Select sender profile</option>
                      {marketingSenders.map(profile => (
                        <option key={String(profile._id)} value={String(profile._id)}>
                          {profile.name} ({profile.fromEmail})
                        </option>
                      ))}
                    </select>
                    <input value={campaignForm.segment} onChange={event => setCampaignForm(current => ({ ...current, segment: event.target.value.toLowerCase() }))} placeholder="Segment or all" />
                  </div>
                  <label>
                    <span>Plain Text Body</span>
                    <textarea value={campaignForm.textBody} onChange={event => setCampaignForm(current => ({ ...current, textBody: event.target.value }))} rows="7" placeholder="Plain text version of the campaign" />
                  </label>
                  <label>
                    <span>HTML Body</span>
                    <textarea value={campaignForm.htmlBody} onChange={event => setCampaignForm(current => ({ ...current, htmlBody: event.target.value }))} rows="10" placeholder="<h1>Yoover</h1><p>Write your marketing email HTML here.</p>" />
                  </label>
                  <button type="submit">{campaignForm.campaignId ? 'Update Campaign' : 'Save Campaign Draft'}</button>
                </form>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Campaign Library</h3>
                  <span>{marketingCampaigns.length} campaigns</span>
                </div>
                <div className="list-stack marketing-list-stack">
                  {marketingCampaigns.length ? (
                    marketingCampaigns.map(campaign => (
                      <div key={String(campaign._id)} className="list-card static-card">
                        <strong>{campaign.name}</strong>
                        <span>{campaign.subject}</span>
                        <small>
                          Sender: {campaign.senderName || 'Unknown'} · Segment: {campaign.segment || 'all'} · Delivered: {campaign.stats?.delivered ?? 0}/{campaign.stats?.recipients ?? 0}
                        </small>
                        <div className="action-row">
                          <button type="button" className="secondary-button" onClick={() => handleCampaignEdit(String(campaign._id))}>
                            Edit
                          </button>
                          <button type="button" onClick={() => handleCampaignSend(String(campaign._id))}>
                            Send Campaign
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState title="No campaigns yet" copy="Create your first draft, choose a sender profile, and send to subscribed recipients." />
                  )}
                </div>
              </section>
            </section>
          </>
        ) : null}

        {activeSection === 'mailbox-users' ? (
          <section className="detail-layout">
            <div className="detail-stack">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Create Mailbox User</h3>
                  <span>Mailbox only</span>
                </div>
                <form className="stack-form" onSubmit={handleMailboxCreate}>
                  <label>
                    <span>Full Name</span>
                    <input value={mailboxCreateForm.fullName} onChange={event => setMailboxCreateForm(current => ({ ...current, fullName: event.target.value }))} required />
                  </label>
                  <label>
                    <span>Username</span>
                    <input value={mailboxCreateForm.username} onChange={event => setMailboxCreateForm(current => ({ ...current, username: event.target.value.toLowerCase() }))} placeholder="username only" required />
                  </label>
                  <label>
                    <span>Password</span>
                    <input type="password" value={mailboxCreateForm.password} onChange={event => setMailboxCreateForm(current => ({ ...current, password: event.target.value }))} required />
                  </label>
                  <button type="submit">Create Mailbox User</button>
                </form>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Mailbox Directory</h3>
                  <span>{mailboxUsers.length} loaded</span>
                </div>
                <div className="toolbar-row">
                  <input value={mailboxSearch} onChange={event => setMailboxSearch(event.target.value)} placeholder="Search mailbox, username, or owner name" />
                </div>
                <div className="list-stack">
                  {mailboxUsers.length ? (
                    mailboxUsers.map(user => (
                      <button
                        key={user._id || user.address}
                        className={`list-card ${selectedMailboxUserId === String(user._id) ? 'active' : ''}`}
                        onClick={() => setSelectedMailboxUserId(String(user._id))}
                      >
                        <strong>{user.address || user.username}</strong>
                        <span>{user.name || 'No display name saved'}</span>
                        <small>
                          {user.disabled ? 'disabled' : 'active'} · {user.linkedCustomer ? 'Linked to customer' : 'Mailbox only'}
                        </small>
                      </button>
                    ))
                  ) : (
                    <EmptyState title="No mailbox users found" copy="Existing WildDuck mailboxes will appear here even if they were never created through the billing flow." />
                  )}
                </div>
              </section>
            </div>

            <div className="detail-stack">
              {mailboxUserDetail && mailboxUserDetail.user ? (
                <>
                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Mailbox Detail</h3>
                      <span>{mailboxUserDetail.user.address || mailboxUserDetail.user.username}</span>
                    </div>
                    <div className="detail-grid">
                      <div className="detail-item">
                        <strong>Mailbox</strong>
                        <span>{mailboxUserDetail.user.address || '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Username</strong>
                        <span>{mailboxUserDetail.user.username || '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Display Name</strong>
                        <span>{mailboxUserDetail.user.name || '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Status</strong>
                        <span>{mailboxUserDetail.user.disabled ? 'disabled' : 'active'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Quota</strong>
                        <span>{Math.round((Number(mailboxUserDetail.user.quota || 0) || 0) / (1024 * 1024)).toLocaleString()} MB</span>
                      </div>
                      <div className="detail-item">
                        <strong>Daily Emails</strong>
                        <span>{Number(mailboxUserDetail.user.recipients || 0).toLocaleString()}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Storage Used</strong>
                        <span>{Number(mailboxUserDetail.user.storageUsed || 0).toLocaleString()} bytes</span>
                      </div>
                      <div className="detail-item">
                        <strong>Created</strong>
                        <span>{mailboxUserDetail.user.created ? new Date(mailboxUserDetail.user.created).toLocaleString() : '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Forward Targets</strong>
                        <span>{Array.isArray(mailboxUserDetail.user.targets) && mailboxUserDetail.user.targets.length ? mailboxUserDetail.user.targets.join(', ') : 'None configured'}</span>
                      </div>
                    </div>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Edit Mailbox User</h3>
                      <span>Mailbox operations</span>
                    </div>
                    <form className="stack-form" onSubmit={handleMailboxUpdate}>
                      <label>
                        <span>Full Name</span>
                        <input value={mailboxEditForm.fullName} onChange={event => setMailboxEditForm(current => ({ ...current, fullName: event.target.value }))} required />
                      </label>
                      <label>
                        <span>Status</span>
                        <select value={mailboxEditForm.status} onChange={event => setMailboxEditForm(current => ({ ...current, status: event.target.value }))}>
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                      <label>
                        <span>New Password</span>
                        <input type="password" value={mailboxEditForm.password} onChange={event => setMailboxEditForm(current => ({ ...current, password: event.target.value }))} placeholder="Leave blank to keep current password" />
                      </label>
                      <label>
                        <span>Quota (MB)</span>
                        <input type="number" min="1" step="1" value={mailboxEditForm.quotaMb} onChange={event => setMailboxEditForm(current => ({ ...current, quotaMb: event.target.value }))} required />
                      </label>
                      <label>
                        <span>Daily Emails</span>
                        <input type="number" min="1" step="1" value={mailboxEditForm.dailyEmails} onChange={event => setMailboxEditForm(current => ({ ...current, dailyEmails: event.target.value }))} required />
                      </label>
                      <div className="action-row">
                        <button type="submit">Save Mailbox Changes</button>
                        <button type="button" className="secondary-button" onClick={handleMailboxDelete}>
                          Delete Mailbox
                        </button>
                      </div>
                    </form>
                    <p className="section-note">
                      This section manages the actual WildDuck mailbox. Customer records stay separate.
                    </p>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Customer Link</h3>
                      <span>{mailboxUserDetail.linkedCustomer ? 'Connected' : 'Not connected'}</span>
                    </div>
                    <div className="action-row">
                      <button type="button" onClick={() => handleMailboxImport(String(mailboxUserDetail.user._id))}>
                        {mailboxUserDetail.linkedCustomer ? 'Sync To Customer Record' : 'Make Customer Record'}
                      </button>
                      {mailboxUserDetail.linkedCustomer ? (
                        <button type="button" className="secondary-button" onClick={() => openLinkedCustomer(mailboxUserDetail.linkedCustomer._id)}>
                          Open Linked Customer
                        </button>
                      ) : null}
                    </div>
                    {mailboxUserDetail.linkedCustomer ? (
                      <div className="detail-grid">
                        <div className="detail-item">
                          <strong>Customer Mailbox</strong>
                          <span>{mailboxUserDetail.linkedCustomer.emailAddress || '-'}</span>
                        </div>
                        <div className="detail-item">
                          <strong>Full Name</strong>
                          <span>{mailboxUserDetail.linkedCustomer.fullName || '-'}</span>
                        </div>
                        <div className="detail-item">
                          <strong>Status</strong>
                          <span>{mailboxUserDetail.linkedCustomer.status || '-'}</span>
                        </div>
                        <div className="detail-item">
                          <strong>Customer ID</strong>
                          <span>{String(mailboxUserDetail.linkedCustomer._id || '-')}</span>
                        </div>
                      </div>
                    ) : (
                      <EmptyState title="No customer record linked" copy="This mailbox exists in WildDuck already. Use the action above to create or sync a proper customer record for billing, support, and account management." />
                    )}
                  </section>
                </>
              ) : mailboxUsers.length ? (
                <EmptyState title="Select a mailbox user" copy="Choose a mailbox from the left to inspect its mailbox-only data and link it into the customer workflow." />
              ) : (
                <EmptyState title="No mailbox detail available" copy="When WildDuck mailbox users are found, this detail panel will populate automatically." />
              )}
            </div>
          </section>
        ) : null}

        {activeSection === 'customers' ? (
          <section className="detail-layout">
            <div className="detail-stack">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Manual Mailbox Provision</h3>
                  <span>Support tool</span>
                </div>
                <form className="stack-form" onSubmit={handleManualProvision}>
                  <label>
                    <span>Full Name</span>
                    <input value={manualProvisionForm.fullName} onChange={event => setManualProvisionForm(current => ({ ...current, fullName: event.target.value }))} required />
                  </label>
                  <label>
                    <span>Username</span>
                    <input value={manualProvisionForm.username} onChange={event => setManualProvisionForm(current => ({ ...current, username: event.target.value.toLowerCase() }))} placeholder="username only" required />
                  </label>
                  <label>
                    <span>Password</span>
                    <input type="password" value={manualProvisionForm.password} onChange={event => setManualProvisionForm(current => ({ ...current, password: event.target.value }))} required />
                  </label>
                  <label>
                    <span>Billing Email</span>
                    <input type="email" value={manualProvisionForm.billingEmail} onChange={event => setManualProvisionForm(current => ({ ...current, billingEmail: event.target.value }))} />
                  </label>
                  <label>
                    <span>Recovery Email</span>
                    <input type="email" value={manualProvisionForm.recoveryEmail} onChange={event => setManualProvisionForm(current => ({ ...current, recoveryEmail: event.target.value }))} />
                  </label>
                  <button type="submit">Provision Mailbox</button>
                </form>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Customer Accounts</h3>
                  <span>{customers.length} loaded</span>
                </div>
                <div className="toolbar-grid">
                  <input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="Search mailbox, name, or billing email" />
                  <select value={customerStatus} onChange={event => setCustomerStatus(event.target.value)}>
                    <option value="">All statuses</option>
                    {statusOptions.map(option => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <input value={customerPlan} onChange={event => setCustomerPlan(event.target.value)} placeholder="Plan name filter" />
                </div>
                <div className="list-stack">
                  {customers.length ? (
                    customers.map(customer => (
                      <button key={customer._id || customer.emailAddress} className={`list-card ${selectedCustomerId === customer._id ? 'active' : ''}`} onClick={() => setSelectedCustomerId(customer._id)}>
                        <strong>{customer.emailAddress}</strong>
                        <span>{customer.fullName || 'No full name saved'}</span>
                        <small>{customer.status || 'unknown'} · {(customer.plan && customer.plan.name) || 'No plan'}</small>
                      </button>
                    ))
                  ) : (
                    <EmptyState title="No customers found" copy="Try a different search or filter, or provision a mailbox from the admin panel." />
                  )}
                </div>
              </section>
            </div>

            <div className="detail-stack">
              {customerDetail && customerDetail.account ? (
                <>
                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Customer Detail</h3>
                      <span>{customerDetail.account.emailAddress}</span>
                    </div>
                    <div className="detail-grid">
                      <div className="detail-item">
                        <strong>Mailbox</strong>
                        <span>{customerDetail.account.emailAddress}</span>
                      </div>
                      <div className="detail-item">
                        <strong>WildDuck User ID</strong>
                        <span>{customerDetail.account.wildduckUserId || '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Subscription</strong>
                        <span>{(customerDetail.account.subscription && customerDetail.account.subscription.status) || '-'}</span>
                      </div>
                      <div className="detail-item">
                        <strong>Created</strong>
                        <span>{customerDetail.account.createdAt ? new Date(customerDetail.account.createdAt).toLocaleString() : '-'}</span>
                      </div>
                    </div>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Edit Customer Record</h3>
                      <span>Support update</span>
                    </div>
                    <form className="stack-form" onSubmit={handleCustomerUpdate}>
                      <label>
                        <span>Full Name</span>
                        <input value={detailForm.fullName} onChange={event => setDetailForm(current => ({ ...current, fullName: event.target.value }))} />
                      </label>
                      <label>
                        <span>Billing Email</span>
                        <input value={detailForm.billingEmail} onChange={event => setDetailForm(current => ({ ...current, billingEmail: event.target.value }))} />
                      </label>
                      <label>
                        <span>Recovery Email</span>
                        <input value={detailForm.recoveryEmail} onChange={event => setDetailForm(current => ({ ...current, recoveryEmail: event.target.value }))} />
                      </label>
                      <label>
                        <span>Status</span>
                        <select value={detailForm.status} onChange={event => setDetailForm(current => ({ ...current, status: event.target.value }))}>
                          <option value="">Select status</option>
                          {statusOptions.map(option => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Plan Name</span>
                        <input value={detailForm.planName} onChange={event => setDetailForm(current => ({ ...current, planName: event.target.value }))} />
                      </label>
                      <label>
                        <span>Plan Price</span>
                        <input value={detailForm.planPrice} onChange={event => setDetailForm(current => ({ ...current, planPrice: event.target.value }))} />
                      </label>
                      <button type="submit">Save Customer Changes</button>
                    </form>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Payment Timeline</h3>
                      <span>{customerDetail.payments.length} payments</span>
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Invoice</th>
                            <th>Amount</th>
                            <th>Status</th>
                            <th>Created</th>
                            <th>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {customerDetail.payments.map(payment => (
                            <tr key={payment._id}>
                              <td>{payment.invoiceNumber || '-'}</td>
                              <td>{formatMoney(payment.amount)}</td>
                              <td>{payment.status || '-'}</td>
                              <td>{new Date(payment.createdAt).toLocaleString()}</td>
                              <td>
                                <a className="table-link" href={`/api/billing/payments/${payment._id}/invoice`} target="_blank" rel="noreferrer">
                                  Open Invoice
                                </a>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Manual Billing Adjustment</h3>
                      <span>Support tool</span>
                    </div>
                    <form className="stack-form" onSubmit={handleManualAdjustment}>
                      <label>
                        <span>Amount</span>
                        <input value={manualAdjustmentForm.amount} onChange={event => setManualAdjustmentForm(current => ({ ...current, amount: event.target.value }))} placeholder="e.g. 12.99" required />
                      </label>
                      <label>
                        <span>Invoice Number</span>
                        <input value={manualAdjustmentForm.invoiceNumber} onChange={event => setManualAdjustmentForm(current => ({ ...current, invoiceNumber: event.target.value }))} placeholder="Optional manual invoice number" />
                      </label>
                      <label>
                        <span>Status</span>
                        <select value={manualAdjustmentForm.status} onChange={event => setManualAdjustmentForm(current => ({ ...current, status: event.target.value }))}>
                          <option value="paid">paid</option>
                          <option value="pending">pending</option>
                          <option value="failed">failed</option>
                        </select>
                      </label>
                      <label>
                        <span>Notes</span>
                        <textarea value={manualAdjustmentForm.notes} onChange={event => setManualAdjustmentForm(current => ({ ...current, notes: event.target.value }))} rows="4" placeholder="Describe the manual charge, credit, or correction." />
                      </label>
                      <button type="submit">Create Adjustment</button>
                    </form>
                  </section>

                  <section className="panel-card">
                    <div className="panel-card-header">
                      <h3>Support Notes</h3>
                      <span>{customerDetail.notes.length} notes</span>
                    </div>
                    <form className="stack-form" onSubmit={handleNoteSave}>
                      <label>
                        <span>Add an internal note</span>
                        <textarea value={noteBody} onChange={event => setNoteBody(event.target.value)} rows="4" placeholder="Write an internal note for support, billing, or operations." />
                      </label>
                      <button type="submit">Save Note</button>
                    </form>
                    <ul className="timeline-list">
                      {customerDetail.notes.map(note => (
                        <li key={`${note.createdAt}-${note.adminEmail || 'system'}`}>
                          <strong>{note.adminName || note.adminEmail || 'System'}</strong>
                          <span>{note.body}</span>
                          <small>{new Date(note.createdAt).toLocaleString()}</small>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ) : customers.length ? (
                <EmptyState title="Select a customer" copy="Choose a mailbox from the left to inspect billing, support notes, and account details." />
              ) : (
                <EmptyState title="No customer detail available" copy="Once customer records exist, this detail workspace will populate automatically." />
              )}
            </div>
          </section>
        ) : null}

        {activeSection === 'billing' ? (
          <section className="panel-card">
            <div className="panel-card-header">
              <h3>Recent Payments</h3>
              <span>{payments.length} loaded</span>
            </div>
            <div className="toolbar-row">
              <input value={billingSearch} onChange={event => setBillingSearch(event.target.value)} placeholder="Search invoice, mailbox, username, or transaction" />
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Mailbox</th>
                    <th>Invoice</th>
                    <th>Transaction</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Created</th>
                    <th>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.length ? (
                    payments.map(payment => (
                      <tr key={payment._id}>
                        <td>{payment.emailAddress || '-'}</td>
                        <td>{payment.invoiceNumber || '-'}</td>
                        <td>{payment.transactionId || '-'}</td>
                        <td>{formatMoney(payment.amount)}</td>
                        <td>{payment.status || '-'}</td>
                        <td>{payment.type || '-'}</td>
                        <td>{new Date(payment.createdAt).toLocaleString()}</td>
                        <td>
                          <a className="table-link" href={`/api/billing/payments/${payment._id}/invoice`} target="_blank" rel="noreferrer">
                            View PDF
                          </a>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8">
                        <EmptyState title="No payments found" copy="Payment records will appear here once transactions or manual adjustments exist." />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {activeSection === 'plans' ? (
          <>
            <section className="panel-grid">
              <StatCard label="Total Plans" value={plans.length} hint="All saved billing plans" />
              <StatCard label="Checkout Enabled" value={plans.filter(plan => plan.checkoutEnabled && plan.active).length} hint="Available in live purchase flow" />
              <StatCard label="Featured" value={plans.filter(plan => plan.featured).length} hint="Highlighted plan cards" />
            </section>

            {plansActionStatus ? <div className="success-box">{plansActionStatus}</div> : null}

            <section className="panel-grid settings-grid">
              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>{planForm.planId ? 'Edit Subscription Plan' : 'Create Subscription Plan'}</h3>
                  <span>Directly powers webmail pricing and checkout</span>
                </div>
                <form className="stack-form" onSubmit={handlePlanSave}>
                  <div className="toolbar-grid">
                    <label>
                      <span>Plan Code</span>
                      <input value={planForm.code} onChange={event => setPlanForm(current => ({ ...current, code: event.target.value.toLowerCase() }))} placeholder="weekly" required />
                    </label>
                    <label>
                      <span>Plan Name</span>
                      <input value={planForm.name} onChange={event => setPlanForm(current => ({ ...current, name: event.target.value }))} placeholder="Weekly" required />
                    </label>
                  </div>
                  <div className="toolbar-grid">
                    <label>
                      <span>Price</span>
                      <input value={planForm.price} onChange={event => setPlanForm(current => ({ ...current, price: event.target.value }))} placeholder="9.99" required />
                    </label>
                    <label>
                      <span>Currency</span>
                      <input value={planForm.currency} onChange={event => setPlanForm(current => ({ ...current, currency: event.target.value.toUpperCase() }))} placeholder="USD" />
                    </label>
                  </div>
                  <div className="toolbar-grid plan-interval-grid">
                    <label>
                      <span>Billing Length</span>
                      <input
                        value={planForm.intervalLength}
                        onChange={event => setPlanForm(current => ({ ...current, intervalLength: event.target.value }))}
                        placeholder="1"
                        required
                      />
                    </label>
                    <label>
                      <span>Billing Unit</span>
                      <select value={planForm.intervalUnit} onChange={event => setPlanForm(current => ({ ...current, intervalUnit: event.target.value }))}>
                        <option value="days">Days</option>
                        <option value="weeks">Weeks</option>
                        <option value="months">Months</option>
                        <option value="years">Years</option>
                      </select>
                    </label>
                    <label>
                      <span>Sort Order</span>
                      <input value={planForm.sortOrder} onChange={event => setPlanForm(current => ({ ...current, sortOrder: event.target.value }))} placeholder="10" />
                    </label>
                  </div>
                  <label>
                    <span>Highlight Tag</span>
                    <input value={planForm.highlightTag} onChange={event => setPlanForm(current => ({ ...current, highlightTag: event.target.value }))} placeholder="Best value" />
                  </label>
                  <label>
                    <span>Summary</span>
                    <input value={planForm.summary} onChange={event => setPlanForm(current => ({ ...current, summary: event.target.value }))} placeholder="Short checkout-friendly summary" />
                  </label>
                  <label>
                    <span>Description</span>
                    <textarea value={planForm.description} onChange={event => setPlanForm(current => ({ ...current, description: event.target.value }))} rows="4" placeholder="Longer public-facing description for pricing pages." />
                  </label>
                  <label>
                    <span>Benefits</span>
                    <textarea value={planForm.benefits} onChange={event => setPlanForm(current => ({ ...current, benefits: event.target.value }))} rows="6" placeholder={'One benefit per line\nProfessional email address\nSecure webmail access'} />
                  </label>
                  <div className="toggle-grid">
                    <label className="toggle-card">
                      <input type="checkbox" checked={planForm.featured} onChange={event => setPlanForm(current => ({ ...current, featured: event.target.checked }))} />
                      <span>Featured plan</span>
                    </label>
                    <label className="toggle-card">
                      <input type="checkbox" checked={planForm.active} onChange={event => setPlanForm(current => ({ ...current, active: event.target.checked }))} />
                      <span>Active</span>
                    </label>
                    <label className="toggle-card">
                      <input type="checkbox" checked={planForm.checkoutEnabled} onChange={event => setPlanForm(current => ({ ...current, checkoutEnabled: event.target.checked }))} />
                      <span>Checkout enabled</span>
                    </label>
                  </div>
                  <div className="action-row">
                    <button type="submit" disabled={planSaving}>
                      {planSaving ? 'Saving...' : planForm.planId ? 'Update Plan' : 'Create Plan'}
                    </button>
                    <button type="button" className="secondary-button" onClick={handlePlanCreateNew}>
                      New Plan
                    </button>
                  </div>
                </form>
              </section>

              <section className="panel-card">
                <div className="panel-card-header">
                  <h3>Live Plan Catalog</h3>
                  <span>{plans.length} plans available</span>
                </div>
                <div className="list-stack">
                  {plans.length ? (
                    plans.map(plan => (
                      <div className="list-card static-card plan-card-admin" key={plan._id}>
                        <div className="plan-card-admin-top">
                          <div>
                            <strong>{plan.name}</strong>
                            <span>
                              {plan.formattedPrice} / {plan.billingLabel}
                            </span>
                          </div>
                          <div className="plan-status-row">
                            {plan.featured ? <span className="settings-badge source-database">featured</span> : null}
                            <span className={`settings-badge ${plan.active && plan.checkoutEnabled ? 'source-environment' : 'source-unset'}`}>
                              {plan.active && plan.checkoutEnabled ? 'live' : 'hidden'}
                            </span>
                          </div>
                        </div>
                        <small>
                          {plan.code} · {plan.billingLabel} cadence · sort {plan.sortOrder}
                        </small>
                        <p>{plan.summary || plan.description || 'No summary added yet.'}</p>
                        {plan.benefits?.length ? (
                          <ul className="plan-benefit-list">
                            {plan.benefits.map(item => (
                              <li key={`${plan._id}-${item}`}>{item}</li>
                            ))}
                          </ul>
                        ) : null}
                        <div className="action-row">
                          <button type="button" className="secondary-button" onClick={() => handlePlanEdit(plan)}>
                            Edit
                          </button>
                          <button type="button" className="danger-button compact-button" onClick={() => handlePlanDelete(plan._id)} disabled={planSaving}>
                            Delete
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <EmptyState title="No billing plans yet" copy="Create the first subscription plan and it will appear in webmail pricing and checkout automatically." />
                  )}
                </div>
              </section>
            </section>
          </>
        ) : null}

        {activeSection === 'admins' ? (
          <section className="panel-grid settings-grid">
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Create Admin User</h3>
                <span>Phase 2 live</span>
              </div>
              <form className="stack-form" onSubmit={handleAdminCreate}>
                <label>
                  <span>Name</span>
                  <input value={adminForm.name} onChange={event => setAdminForm(current => ({ ...current, name: event.target.value }))} required />
                </label>
                <label>
                  <span>Email</span>
                  <input type="email" value={adminForm.email} onChange={event => setAdminForm(current => ({ ...current, email: event.target.value }))} required />
                </label>
                <label>
                  <span>Password</span>
                  <input type="password" value={adminForm.password} onChange={event => setAdminForm(current => ({ ...current, password: event.target.value }))} required />
                </label>
                <label>
                  <span>Role</span>
                  <select value={adminForm.role} onChange={event => setAdminForm(current => ({ ...current, role: event.target.value }))}>
                    {roleOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={adminSaving}>
                  {adminSaving ? 'Creating...' : 'Create Admin'}
                </button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Admin Users</h3>
                <span>{admins.length} admins</span>
              </div>
              <div className="admin-grid">
                {admins.length ? (
                  admins.map(item => (
                    <div className="mini-card" key={item._id || item.email}>
                      <strong>{item.name}</strong>
                      <span>{item.email}</span>
                      <label>
                        <span>Role</span>
                        <select value={item.role} onChange={event => handleAdminUpdate(item._id, { role: event.target.value })}>
                          {roleOptions.map(option => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>Status</span>
                        <select value={item.status || 'active'} onChange={event => handleAdminUpdate(item._id, { status: event.target.value })}>
                          <option value="active">Active</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No admin users available" copy="Create the next admin from the form on the left." />
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === 'settings' ? (
          <section className="panel-grid settings-grid">
            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Admin Operational Settings</h3>
                <span>Database-backed admin controls</span>
              </div>
              <div className="settings-file-note">
                <strong>What belongs here</strong>
                <span>Only admin-side operational controls live in this section, such as domain policy and admin security guidance.</span>
                <small>Payment keys, Stripe, Authorize.Net, and notification SMTP runtime values are managed from the `WildDuck Webmail .env` section below.</small>
              </div>
              <div className="settings-editor">
                {settings.settings.length ? (
                  settings.settings.map(entry => (
                    <div key={entry.key} className="settings-item">
                      <div className="settings-copy">
                        <div className="settings-title-row">
                          <strong>{entry.label}</strong>
                          <span className={`settings-badge source-${entry.source}`}>{entry.source}</span>
                        </div>
                        <p>{entry.description}</p>
                        <small>{entry.key}</small>
                        <div className="settings-current">
                          <span className="settings-current-label">Current</span>
                          <span className="settings-current-value">{entry.maskedValue || 'Not configured'}</span>
                        </div>
                      </div>
                      <div className="settings-actions">
                        <input
                          type={entry.sensitive ? 'password' : 'text'}
                          value={settingsDrafts[entry.key] ?? ''}
                          placeholder={entry.sensitive ? 'Enter a new secret value' : 'Enter value'}
                          onChange={event => setSettingsDrafts(current => ({ ...current, [entry.key]: event.target.value }))}
                        />
                        <button type="button" onClick={() => handleSettingSave(entry)} disabled={settingsSavingKey === entry.key}>
                          {settingsSavingKey === entry.key ? 'Saving...' : 'Save'}
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No managed settings yet" copy="Editable operational settings will appear here once loaded." />
                )}
              </div>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>WildDuck Webmail .env</h3>
                <span>Runtime source of truth</span>
              </div>
              <div className="settings-file-note">
                <strong>Linked file</strong>
                <span>{settings.webmailEnv?.filePath || 'File path unavailable'}</span>
                <small>Payment gateways, Stripe, Authorize.Net, and notification SMTP values used by `wildduck-webmail` come from this real env file. Restart `wildduck-webmail` after changing runtime credentials or payment keys.</small>
              </div>
              <div className="settings-editor webmail-env-editor">
                {(settings.webmailEnv?.entries || []).length ? (
                  settings.webmailEnv.entries.map(entry => (
                    <div key={entry.key} className="settings-item">
                      <div className="settings-copy">
                        <div className="settings-title-row">
                          <strong>{entry.label}</strong>
                          <span className={`settings-badge ${entry.sensitive ? 'source-database' : 'source-environment'}`}>{entry.sensitive ? 'sensitive' : 'variable'}</span>
                        </div>
                        <p>{entry.description}</p>
                        <small>{entry.key}</small>
                      </div>
                      <div className="settings-actions env-row-actions">
                        {entry.key === 'AUTHORIZE_MODE' ? (
                          <select
                            value={webmailEnvDrafts[entry.key] ?? entry.value ?? 'sandbox'}
                            onChange={event => setWebmailEnvDrafts(current => ({ ...current, [entry.key]: event.target.value }))}
                          >
                            <option value="sandbox">Sandbox / Test</option>
                            <option value="production">Production / Live</option>
                          </select>
                        ) : (
                          <input
                            type={entry.sensitive ? 'password' : 'text'}
                            value={webmailEnvDrafts[entry.key] ?? ''}
                            placeholder="Enter value"
                            onChange={event => setWebmailEnvDrafts(current => ({ ...current, [entry.key]: event.target.value }))}
                          />
                        )}
                        <button type="button" onClick={() => handleWebmailEnvSave(entry)} disabled={webmailEnvSavingKey === entry.key}>
                          {webmailEnvSavingKey === entry.key ? 'Saving...' : 'Save'}
                        </button>
                        <button type="button" className="danger-button" onClick={() => handleWebmailEnvRemove(entry.key)} disabled={webmailEnvSavingKey === entry.key}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState title="No WildDuck Webmail env variables loaded" copy="Once the linked .env file is available, its editable variables will appear here." />
                )}
              </div>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Add New Webmail Variable</h3>
                <span>Custom env entry</span>
              </div>
              <form className="stack-form" onSubmit={handleWebmailEnvAdd}>
                <label>
                  <span>Variable Name</span>
                  <input value={webmailEnvForm.key} onChange={event => setWebmailEnvForm(current => ({ ...current, key: event.target.value.toUpperCase() }))} placeholder="EXAMPLE_ENV_KEY" required />
                </label>
                <label>
                  <span>Variable Value</span>
                  <input value={webmailEnvForm.value} onChange={event => setWebmailEnvForm(current => ({ ...current, value: event.target.value }))} placeholder="Value to write into wildduck-webmail/.env" />
                </label>
                <button type="submit" disabled={webmailEnvSavingKey === '__new__'}>
                  {webmailEnvSavingKey === '__new__' ? 'Adding...' : 'Add Variable'}
                </button>
              </form>
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Environment Preview</h3>
                <span>Bootstrap view</span>
              </div>
              {settings.envPreview.length ? (
                <div className="env-preview-grid">
                  {settings.envPreview.map(entry => (
                    <div key={entry.key} className="env-preview-card">
                      <strong>{entry.key}</strong>
                      <span>{entry.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No environment preview" copy="Bootstrap configuration preview will appear here." />
              )}
            </div>

            <div className="panel-card">
              <div className="panel-card-header">
                <h3>Mailbox Limits Rollout</h3>
                <span>Future and existing users</span>
              </div>
              <div className="settings-file-note">
                <strong>Defaults for new mailboxes</strong>
                <span>Save `MAILBOX_DEFAULT_QUOTA_MB` and `MAILBOX_DEFAULT_DAILY_EMAIL_LIMIT` in Admin Operational Settings to control all upcoming mailbox users and customer-created mailboxes.</span>
                <small>When you are ready, apply those same saved values to all existing mailbox users with one action below.</small>
              </div>
              {mailboxDefaultsStatus ? <div className="success-box">{mailboxDefaultsStatus}</div> : null}
              <div className="action-row">
                <button type="button" onClick={handleApplyMailboxDefaultsToExisting}>
                  Apply Saved Defaults To Existing Mailboxes
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {activeSection === 'audit' ? (
          <section className="panel-card">
            <div className="panel-card-header">
              <h3>Recent Audit Logs</h3>
              <span>{auditLogs.length} events</span>
            </div>
            <ul className="timeline-list">
              {auditLogs.length ? (
                auditLogs.map(log => (
                  <li key={log._id || `${log.action}-${log.createdAt}`}>
                    <strong>{log.action}</strong>
                    <span>{log.adminName || log.adminEmail || 'System'}</span>
                    <small>{new Date(log.createdAt).toLocaleString()}</small>
                  </li>
                ))
              ) : (
                <li>
                  <EmptyState title="No audit events yet" copy="Admin activity will start appearing here as actions are performed." />
                </li>
              )}
            </ul>
          </section>
        ) : null}

        {!dashboard && activeSection === 'dashboard' && isSectionLoading ? <div className="screen-state">Loading dashboard...</div> : null}
        {!operations && activeSection === 'operations' && isSectionLoading ? <div className="screen-state">Loading operations data...</div> : null}
        {activeSection === 'marketing' && isSectionLoading && !marketingRecipients.length && !marketingSenders.length && !marketingCampaigns.length ? <div className="section-loading">Loading marketing workspace...</div> : null}
        {activeSection === 'mailbox-users' && isSectionLoading && !mailboxUsers.length ? <div className="section-loading">Loading mailbox users...</div> : null}
        {activeSection === 'customers' && isSectionLoading && !customers.length ? <div className="section-loading">Loading customer data...</div> : null}
        {activeSection === 'billing' && isSectionLoading && !payments.length ? <div className="section-loading">Loading payment data...</div> : null}
        {activeSection === 'plans' && isSectionLoading && !plans.length ? <div className="section-loading">Loading subscription plans...</div> : null}
        {activeSection === 'admins' && isSectionLoading && !admins.length ? <div className="section-loading">Loading admin users...</div> : null}
        {activeSection === 'audit' && isSectionLoading && !auditLogs.length ? <div className="section-loading">Loading audit activity...</div> : null}
      </main>
    </div>
  );
}
