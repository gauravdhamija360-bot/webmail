import nodemailer from 'nodemailer';
import { getResolvedSetting } from './admin-store.js';

const parseSecure = value => ['true', '1', 'yes'].includes(String(value || '').toLowerCase());

export const sendTestAdminNotification = async ({ requestedBy, requestedTo }) => {
  const [recipients, from, host, port, secureFlag, user, pass] = await Promise.all([
    getResolvedSetting('ADMIN_NOTIFICATION_EMAILS'),
    getResolvedSetting('ADMIN_NOTIFICATION_FROM'),
    getResolvedSetting('ADMIN_NOTIFICATION_SMTP_HOST'),
    getResolvedSetting('ADMIN_NOTIFICATION_SMTP_PORT'),
    getResolvedSetting('ADMIN_NOTIFICATION_SMTP_SECURE'),
    getResolvedSetting('ADMIN_NOTIFICATION_SMTP_USER'),
    getResolvedSetting('ADMIN_NOTIFICATION_SMTP_PASS')
  ]);

  const target = String(requestedTo || '').trim() || recipients;
  if (!target) {
    throw new Error('No notification recipient configured');
  }

  const transporter = nodemailer.createTransport({
    host: host || 'zonemta',
    port: Number(port || 587),
    secure: parseSecure(secureFlag),
    auth: user ? { user, pass } : undefined
  });

  await transporter.sendMail({
    from: from || 'Yoover Admin <no-reply@yoover.com>',
    to: target,
    subject: 'Yoover Admin Test Notification',
    text: `This is a test notification from the Yoover Admin panel.\nRequested by: ${requestedBy || 'Unknown admin'}\nSent at: ${new Date().toISOString()}`,
    html: `<div style="font-family:Arial,sans-serif;padding:24px;color:#163046">
      <h2 style="margin:0 0 12px;color:#0f766e">Yoover Admin Test Notification</h2>
      <p style="margin:0 0 8px">This is a test notification from the Yoover Admin panel.</p>
      <p style="margin:0 0 8px"><strong>Requested by:</strong> ${requestedBy || 'Unknown admin'}</p>
      <p style="margin:0"><strong>Sent at:</strong> ${new Date().toISOString()}</p>
    </div>`
  });

  return { recipient: target };
};
