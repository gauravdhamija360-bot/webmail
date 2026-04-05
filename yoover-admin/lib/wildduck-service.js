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

export const createMailbox = async ({ fullName, username, password, sessionId, ip }) => {
  const config = getConfig();
  const address = `${String(username).trim().toLowerCase()}@${config.domain}`;
  const response = await fetch(`${config.apiUrl}/users`, {
    method: 'POST',
    headers: jsonHeaders(config.accessToken),
    body: JSON.stringify({
      name: fullName,
      username,
      password,
      allowUnsafe: true,
      address,
      quota: config.quotaMb * 1024 * 1024,
      recipients: config.recipients,
      forwards: config.forwards,
      sess: sessionId,
      ip
    })
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
