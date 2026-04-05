import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const composeDir = process.env.ADMIN_PANEL_COMPOSE_DIR || '/workspace';
const composeFile = process.env.ADMIN_PANEL_COMPOSE_FILE || path.join(composeDir, 'docker-compose.yml');
const composeProject = process.env.ADMIN_PANEL_COMPOSE_PROJECT || path.basename(composeDir);

const MANAGED_SERVICES = [
  {
    key: 'wildduck-webmail',
    label: 'WildDuck Webmail',
    restartHint: 'Restart after .env, signup flow, payment, or template changes.'
  },
  {
    key: 'wildduck',
    label: 'WildDuck Core',
    restartHint: 'Restart after API, IMAP, POP3, or mailbox-core configuration changes.'
  },
  {
    key: 'zonemta',
    label: 'ZoneMTA',
    restartHint: 'Restart after SMTP submission, DKIM, or outbound routing changes.'
  },
  {
    key: 'haraka',
    label: 'Haraka',
    restartHint: 'Restart after inbound SMTP or TLS configuration changes.'
  },
  {
    key: 'rspamd',
    label: 'Rspamd',
    restartHint: 'Restart after spam filtering or scanner changes.'
  },
  {
    key: 'caddy',
    label: 'Caddy',
    restartHint: 'Restart after hostname, reverse proxy, or TLS routing changes.'
  }
];

const serviceByKey = new Map(MANAGED_SERVICES.map(service => [service.key, service]));

const runCompose = async args => {
  const { stdout, stderr } = await execFileAsync('docker', ['compose', '-p', composeProject, '-f', composeFile, ...args], {
    cwd: composeDir,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: (stdout || '').trim(),
    stderr: (stderr || '').trim()
  };
};

export const listManagedServices = async () => {
  const psResult = await runCompose(['ps', '--format', 'json']);
  const lines = psResult.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const records = lines.map(line => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  });

  return MANAGED_SERVICES.map(service => {
    const record = records.find(entry => entry && (entry.Service === service.key || entry.Name?.includes(service.key)));
    return {
      ...service,
      state: record?.State || 'unknown',
      status: record?.Status || 'Unknown',
      health: record?.Health || '',
      containerName: record?.Name || ''
    };
  });
};

export const restartManagedService = async key => {
  const service = serviceByKey.get(key);
  if (!service) {
    throw new Error('Service is not allowed for restart');
  }

  const restartResult = await runCompose(['restart', key]);
  const [psResult, logsResult] = await Promise.all([
    runCompose(['ps', key]),
    runCompose(['logs', '--tail=25', key])
  ]);

  return {
    service,
    commandOutput: [restartResult.stdout, restartResult.stderr].filter(Boolean).join('\n').trim(),
    statusOutput: psResult.stdout,
    logsOutput: [logsResult.stdout, logsResult.stderr].filter(Boolean).join('\n').trim()
  };
};
