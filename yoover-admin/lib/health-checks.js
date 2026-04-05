import net from 'net';

const checkTcp = ({ host, port, timeout = 2000 }) =>
  new Promise(resolve => {
    const socket = new net.Socket();
    const startedAt = Date.now();
    let settled = false;

    const finish = (status, detail = '') => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve({
        status,
        detail,
        latencyMs: Date.now() - startedAt
      });
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => finish('up'));
    socket.once('timeout', () => finish('down', 'Timed out'));
    socket.once('error', err => finish('down', err.message));
    socket.connect(port, host);
  });

export const getSystemHealth = async () => {
  const services = [
    { key: 'mongo', label: 'MongoDB', host: 'mongo', port: 27017 },
    { key: 'redis', label: 'Redis', host: 'redis', port: 6379 },
    { key: 'wildduck', label: 'WildDuck API', host: 'wildduck', port: 8080 },
    { key: 'smtp_submission', label: 'ZoneMTA Submission', host: 'zonemta', port: 587 },
    { key: 'smtp_inbound', label: 'Haraka SMTP', host: 'haraka', port: 25 },
    { key: 'rspamd', label: 'Rspamd', host: 'rspamd', port: 11334 }
  ];

  const results = await Promise.all(
    services.map(async service => ({
      ...service,
      ...(await checkTcp(service))
    }))
  );

  return {
    services: results,
    summary: {
      up: results.filter(item => item.status === 'up').length,
      down: results.filter(item => item.status !== 'up').length
    }
  };
};
