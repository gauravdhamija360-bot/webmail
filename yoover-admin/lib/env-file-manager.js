import { promises as fs } from 'fs';
import path from 'path';

const WEBMAIL_ENV_DEFINITIONS = [
  {
    key: 'AUTHORIZE_API_LOGIN_ID',
    label: 'Authorize.Net API Login ID',
    description: 'Primary Authorize.Net login identifier used by webmail checkout.',
    sensitive: true
  },
  {
    key: 'AUTHORIZE_TRANSACTION_KEY',
    label: 'Authorize.Net Transaction Key',
    description: 'Authorize.Net transaction secret.',
    sensitive: true
  },
  {
    key: 'AUTHORIZE_CLIENT_KEY',
    label: 'Authorize.Net Client Key',
    description: 'Client key used in the hosted payment form flow.',
    sensitive: true
  },
  {
    key: 'AUTHORIZE_SIGNATURE_KEY',
    label: 'Authorize.Net Signature Key',
    description: 'Signature validation key for callbacks and verification.',
    sensitive: true
  },
  {
    key: 'MONGO_INITDB_ROOT_USERNAME',
    label: 'Mongo Root Username',
    description: 'Mongo bootstrap username used for database authentication.',
    sensitive: false
  },
  {
    key: 'MONGO_INITDB_ROOT_PASSWORD',
    label: 'Mongo Root Password',
    description: 'Mongo bootstrap password used for database authentication.',
    sensitive: true
  },
  {
    key: 'ADMIN_NOTIFICATION_EMAILS',
    label: 'Admin Notification Emails',
    description: 'Comma-separated recipients for signup and invoice notifications.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_FROM',
    label: 'Admin Notification From',
    description: 'Friendly sender identity used for admin notifications.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_SMTP_HOST',
    label: 'Notification SMTP Host',
    description: 'SMTP host used to send admin notifications.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_SMTP_PORT',
    label: 'Notification SMTP Port',
    description: 'SMTP port used to send admin notifications.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_SMTP_SECURE',
    label: 'Notification SMTP Secure',
    description: 'Whether admin notifications use implicit TLS.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_SMTP_USER',
    label: 'Notification SMTP Username',
    description: 'Authenticated mailbox used for admin notification delivery.',
    sensitive: false
  },
  {
    key: 'ADMIN_NOTIFICATION_SMTP_PASS',
    label: 'Notification SMTP Password',
    description: 'Password for the notification mailbox.',
    sensitive: true
  }
];

const parseLine = line => {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) {
    return null;
  }

  return {
    key: match[1],
    value: match[2]
  };
};

const serializeLine = (key, value) => `${key}=${value ?? ''}`;

const getDefinition = key => WEBMAIL_ENV_DEFINITIONS.find(entry => entry.key === key);

const getFilePath = () =>
  path.resolve(process.env.ADMIN_PANEL_WEBMAIL_ENV_FILE || path.join(process.cwd(), '..', 'wildduck-webmail', '.env'));

export const readWebmailEnvFile = async () => {
  const filePath = getFilePath();
  const raw = await fs.readFile(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const entries = [];
  const lineMap = [];

  lines.forEach((line, index) => {
    const parsed = parseLine(line);
    if (!parsed) {
      lineMap.push({ type: 'raw', value: line });
      return;
    }

    const definition = getDefinition(parsed.key);
    const entry = {
      key: parsed.key,
      value: parsed.value,
      label: definition ? definition.label : parsed.key,
      description: definition ? definition.description : 'Custom WildDuck Webmail environment variable.',
      sensitive: Boolean(definition && definition.sensitive),
      lineIndex: index
    };

    entries.push(entry);
    lineMap.push({ type: 'entry', key: parsed.key });
  });

  return {
    filePath,
    lines,
    entries,
    lineMap
  };
};

const writeWebmailEnvFile = async (filePath, lines) => {
  await fs.writeFile(filePath, `${lines.join('\n').replace(/\n+$/g, '')}\n`, 'utf8');
};

export const listWebmailEnvEntries = async () => {
  const { filePath, entries } = await readWebmailEnvFile();

  return {
    filePath,
    entries: entries.map(entry => ({
      key: entry.key,
      value: entry.value,
      label: entry.label,
      description: entry.description,
      sensitive: entry.sensitive
    }))
  };
};

export const upsertWebmailEnvEntry = async ({ key, value }) => {
  const normalizedKey = String(key || '').trim();
  if (!normalizedKey.match(/^[A-Za-z_][A-Za-z0-9_]*$/)) {
    throw new Error('Env key must be a valid environment variable name');
  }

  const normalizedValue = String(value ?? '');
  const { filePath, entries, lines } = await readWebmailEnvFile();
  const nextLines = [...lines];

  const existing = entries.find(entry => entry.key === normalizedKey);
  if (existing) {
    nextLines[existing.lineIndex] = serializeLine(normalizedKey, normalizedValue);
  } else {
    if (nextLines.length && nextLines[nextLines.length - 1] !== '') {
      nextLines.push('');
    }
    nextLines.push(serializeLine(normalizedKey, normalizedValue));
  }

  await writeWebmailEnvFile(filePath, nextLines);
  return listWebmailEnvEntries();
};

export const removeWebmailEnvEntry = async key => {
  const normalizedKey = String(key || '').trim();
  const { filePath, lines, lineMap } = await readWebmailEnvFile();
  const filteredLines = lineMap
    .map((item, index) => ({ item, line: lines[index] }))
    .filter(entry => !(entry.item.type === 'entry' && entry.item.key === normalizedKey))
    .map(entry => entry.line)
    .filter((line, index, array) => !(line === '' && array[index - 1] === ''));

  await writeWebmailEnvFile(filePath, filteredLines);
  return listWebmailEnvEntries();
};
