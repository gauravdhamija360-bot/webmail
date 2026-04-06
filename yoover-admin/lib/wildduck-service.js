const jsonHeaders = token => {
  const headers = {
    'Content-Type': 'application/json'
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
};

const getConfig = () => ({
  apiUrl: String(process.env.ADMIN_PANEL_WILDDUCK_API_URL || 'http://wildduck:8080').replace(/\/+$/, ''),
  accessToken: String(process.env.ADMIN_PANEL_WILDDUCK_ACCESS_TOKEN || ''),
  domain: String(process.env.ADMIN_PANEL_SERVICE_DOMAIN || 'yoover.com').trim().toLowerCase(),
  quotaMb: Number(process.env.ADMIN_PANEL_DEFAULT_QUOTA_MB || 1024) || 1024,
  recipients: Number(process.env.ADMIN_PANEL_DEFAULT_RECIPIENTS || 2000) || 2000,
  forwards: Number(process.env.ADMIN_PANEL_DEFAULT_FORWARDS || 2000) || 2000
});

const parseResponse = async response => {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = { error: text || 'Unknown WildDuck response' };
  }

  if (!response.ok) {
    throw new Error((data && (data.error || data.message)) || `WildDuck request failed with ${response.status}`);
  }

  return data;
};

export const createMailbox = async ({ fullName, username, password, quotaMb, recipients, sessionId, ip }) => {
  const config = getConfig();
  const normalizedUsername = String(username).trim().toLowerCase();
  const address = `${normalizedUsername}@${config.domain}`;
  const resolvedQuotaMb = Number(quotaMb) || config.quotaMb;
  const resolvedRecipients = Number(recipients) || config.recipients;
  const basePayload = {
    name: fullName,
    password,
    allowUnsafe: true,
    address,
    quota: resolvedQuotaMb * 1024 * 1024,
    recipients: resolvedRecipients,
    forwards: config.forwards,
    sess: sessionId,
    ip
  };

  const createUser = async mailboxUsername => {
    const response = await fetch(`${config.apiUrl}/users`, {
      method: 'POST',
      headers: jsonHeaders(config.accessToken),
      body: JSON.stringify({
        ...basePayload,
        username: mailboxUsername
      })
    });

    return parseResponse(response);
  };

  try {
    return await createUser(normalizedUsername);
  } catch (error) {
    const originalMessage = String((error && error.message) || error || '');
    if (!/reserved username/i.test(originalMessage)) {
      throw error;
    }

    // Admin-created system addresses may need a non-reserved internal username
    // while still exposing the requested mailbox address to users.
    const safeLocalPart = normalizedUsername.replace(/[^a-z0-9.-]/g, '-').replace(/^-+|-+$/g, '') || 'mailbox';
    const internalUsername = `admin-${safeLocalPart}-${Date.now().toString(36)}`.slice(0, 128);

    try {
      return await createUser(internalUsername);
    } catch (fallbackError) {
      const fallbackMessage = String((fallbackError && fallbackError.message) || fallbackError || '');
      throw new Error(`Unable to create reserved mailbox "${address}": ${fallbackMessage || originalMessage}`);
    }
  }
};

export const updateMailbox = async ({ userId, fullName, password, disabled, quotaMb, recipients, sessionId, ip }) => {
  const config = getConfig();
  const payload = {
    allowUnsafe: true,
    sess: sessionId,
    ip
  };

  if (typeof fullName === 'string') {
    payload.name = fullName.trim();
  }

  if (typeof password === 'string' && password) {
    payload.password = password;
  }

  if (typeof disabled === 'boolean') {
    payload.disabled = disabled;
  }

  if (typeof quotaMb === 'number' && Number.isFinite(quotaMb) && quotaMb > 0) {
    payload.quota = Math.round(quotaMb * 1024 * 1024);
  }

  if (typeof recipients === 'number' && Number.isFinite(recipients) && recipients > 0) {
    payload.recipients = Math.round(recipients);
  }

  const response = await fetch(`${config.apiUrl}/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: jsonHeaders(config.accessToken),
    body: JSON.stringify(payload)
  });

  return parseResponse(response);
};

export const deleteMailbox = async ({ userId, sessionId, ip }) => {
  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/users/${encodeURIComponent(userId)}?sess=${encodeURIComponent(sessionId || '')}&ip=${encodeURIComponent(ip || '')}`, {
    method: 'DELETE',
    headers: jsonHeaders(config.accessToken)
  });

  return parseResponse(response);
};

export const resolveMailbox = async username => {
  const config = getConfig();
  const response = await fetch(`${config.apiUrl}/users/resolve/${encodeURIComponent(username)}`, {
    method: 'GET',
    headers: jsonHeaders(config.accessToken)
  });

  return parseResponse(response);
};

export const getServiceDomain = () => getConfig().domain;
