'use strict';

const nodemailer = require('nodemailer');
const buildInvoicePdf = require('./invoice-pdf');

const parseRecipients = value =>
    String(value || '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean);

const getRecipients = () => parseRecipients(process.env.ADMIN_NOTIFICATION_EMAILS || process.env.ADMIN_ALERT_EMAILS);

const hasAdminRecipients = () => getRecipients().length > 0;
const shouldRejectUnauthorized = () => !['false', '0', 'no'].includes(String(process.env.ADMIN_NOTIFICATION_SMTP_TLS_REJECT_UNAUTHORIZED || '').toLowerCase());

const createTransport = () => {
    if (process.env.ADMIN_NOTIFICATION_SMTP_JSON) {
        return nodemailer.createTransport(JSON.parse(process.env.ADMIN_NOTIFICATION_SMTP_JSON));
    }

    const host = process.env.ADMIN_NOTIFICATION_SMTP_HOST;
    const port = Number(process.env.ADMIN_NOTIFICATION_SMTP_PORT || 587);
    const user = process.env.ADMIN_NOTIFICATION_SMTP_USER || '';
    const pass = process.env.ADMIN_NOTIFICATION_SMTP_PASS || '';
    const secure = String(process.env.ADMIN_NOTIFICATION_SMTP_SECURE || '').toLowerCase() === 'true' || port === 465;
    const rejectUnauthorized = shouldRejectUnauthorized();
    const shouldUseStartTls = !secure && Boolean(user);

    if (!host) {
        return nodemailer.createTransport({
            host: '127.0.0.1',
            port: 25,
            secure: false,
            ignoreTLS: true
        });
    }

    return nodemailer.createTransport({
        host,
        port,
        secure,
        requireTLS: shouldUseStartTls,
        ignoreTLS: !secure && !shouldUseStartTls && !rejectUnauthorized,
        auth: user ? { user, pass } : undefined,
        tls: {
            rejectUnauthorized
        }
    });
};

const getFromAddress = () =>
    process.env.ADMIN_NOTIFICATION_FROM ||
    process.env.ADMIN_ALERT_FROM ||
    'Yoover Notifications <no-reply@yoover.com>';

const escapeHtml = value =>
    String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const formatMoney = amount =>
    new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(Number(amount) || 0);

const formatDate = value =>
    new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(value ? new Date(value) : new Date());

const buildHtml = ({ heading, accent, summary, rows, footer }) => `
    <div style="margin:0;padding:32px;background:#edf2f7;font-family:Inter,Segoe UI,Arial,sans-serif;color:#17324d;">
        <div style="max-width:720px;margin:0 auto;background:#ffffff;border-radius:28px;overflow:hidden;border:1px solid #dbe4ee;">
            <div style="padding:28px 32px;background:${accent};color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.85;">Yoover Admin Notice</div>
                <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;">${escapeHtml(heading)}</h1>
            </div>
            <div style="padding:28px 32px;">
                <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#5f7288;">${summary}</p>
                <table style="width:100%;border-collapse:collapse;border-spacing:0;">
                    <tbody>
                        ${rows
                            .map(
                                row => `
                                    <tr>
                                        <td style="padding:12px 0;border-bottom:1px solid #edf3f8;width:180px;font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#7f8ea3;">${escapeHtml(row.label)}</td>
                                        <td style="padding:12px 0;border-bottom:1px solid #edf3f8;font-size:15px;color:#17324d;">${row.value}</td>
                                    </tr>
                                `
                            )
                            .join('')}
                    </tbody>
                </table>
                <p style="margin:24px 0 0;font-size:13px;line-height:1.7;color:#7f8ea3;">${footer}</p>
            </div>
        </div>
    </div>
`;

const sendMessage = async message => {
    if (!hasAdminRecipients()) {
        return false;
    }

    const transporter = createTransport();

    await transporter.sendMail(
        Object.assign(
            {
                from: getFromAddress(),
                to: getRecipients().join(', ')
            },
            message
        )
    );

    return true;
};

const sendDirectMessage = async ({ to, ...message }) => {
    const recipients = parseRecipients(to);

    if (!recipients.length) {
        return false;
    }

    const transporter = createTransport();

    await transporter.sendMail(
        Object.assign(
            {
                from: getFromAddress(),
                to: recipients.join(', ')
            },
            message
        )
    );

    return true;
};

module.exports.notifyFreeSignup = async details => {
    const rows = [
        { label: 'Mailbox', value: escapeHtml(details.emailAddress) },
        { label: 'Name', value: escapeHtml(details.fullName) },
        { label: 'Recovery Email', value: escapeHtml(details.recoveryEmail || 'Not provided') },
        { label: 'Created At', value: escapeHtml(formatDate(details.createdAt)) },
        { label: 'Account Type', value: 'Free test signup' }
    ];

    return sendMessage({
        subject: `New free Yoover account: ${details.emailAddress}`,
        html: buildHtml({
            heading: 'A new free Yoover mailbox was created',
            accent: '#0f766e',
            summary: `A test mailbox was provisioned successfully for <strong>${escapeHtml(details.emailAddress)}</strong>.`,
            rows,
            footer: 'This notification was generated from the free signup path.'
        }),
        text: `A new free Yoover mailbox was created.\nMailbox: ${details.emailAddress}\nName: ${details.fullName}\nRecovery Email: ${details.recoveryEmail || 'Not provided'}\nCreated At: ${formatDate(details.createdAt)}`
    });
};

module.exports.notifyPaidSignup = async details => {
    const invoicePdf = await buildInvoicePdf(details);
    const phoneValue = escapeHtml(details.billingPhone || 'Not provided');

    const rows = [
        { label: 'Mailbox', value: escapeHtml(details.emailAddress) },
        { label: 'Customer', value: escapeHtml(details.fullName) },
        { label: 'Billing Email', value: escapeHtml(details.billingEmail) },
        { label: 'Billing Phone', value: phoneValue },
        { label: 'Plan', value: escapeHtml(details.planName) },
        { label: 'Amount Paid', value: `<strong>${escapeHtml(formatMoney(details.amount))}</strong>` },
        { label: 'Invoice', value: escapeHtml(details.invoiceNumber || 'Pending') },
        { label: 'Transaction ID', value: escapeHtml(details.transactionId || 'Pending') },
        { label: 'Paid At', value: escapeHtml(formatDate(details.createdAt)) }
    ];

    const attachments = [
        {
            filename: `${details.invoiceNumber || 'yoover-invoice'}.pdf`,
            content: invoicePdf,
            contentType: 'application/pdf'
        }
    ];

    const [adminNotificationSent, customerNotificationSent] = await Promise.all([
        sendMessage({
            subject: `New paid Yoover account: ${details.emailAddress}`,
            html: buildHtml({
                heading: 'A new paid Yoover mailbox is now active',
                accent: '#1d4ed8',
                summary: `A paid mailbox for <strong>${escapeHtml(details.emailAddress)}</strong> has been created and the initial payment has been captured. The invoice PDF is attached to this email.`,
                rows,
                footer: 'Authorize.Net payment capture completed and mailbox provisioning finished.'
            }),
            text: `A new paid Yoover mailbox is active.\nMailbox: ${details.emailAddress}\nCustomer: ${details.fullName}\nBilling Email: ${details.billingEmail}\nBilling Phone: ${details.billingPhone || 'Not provided'}\nPlan: ${details.planName}\nAmount Paid: ${formatMoney(details.amount)}\nInvoice: ${details.invoiceNumber || 'Pending'}\nTransaction ID: ${details.transactionId || 'Pending'}\nPaid At: ${formatDate(details.createdAt)}`,
            attachments
        }),
        sendDirectMessage({
            to: details.billingEmail,
            subject: `Your Yoover invoice ${details.invoiceNumber || ''}`.trim(),
            html: buildHtml({
                heading: 'Your Yoover billing receipt is ready',
                accent: '#0f766e',
                summary: `Your mailbox <strong>${escapeHtml(details.emailAddress)}</strong> is now active. We've attached your invoice PDF for this payment.`,
                rows,
                footer: 'Keep this invoice for your billing records. Future billing emails will use this billing contact.'
            }),
            text: `Your Yoover mailbox is active.\nMailbox: ${details.emailAddress}\nCustomer: ${details.fullName}\nBilling Email: ${details.billingEmail}\nBilling Phone: ${details.billingPhone || 'Not provided'}\nPlan: ${details.planName}\nAmount Paid: ${formatMoney(details.amount)}\nInvoice: ${details.invoiceNumber || 'Pending'}\nTransaction ID: ${details.transactionId || 'Pending'}\nPaid At: ${formatDate(details.createdAt)}`,
            attachments
        })
    ]);

    return {
        adminNotificationSent,
        customerNotificationSent
    };
};

module.exports.isEnabled = hasAdminRecipients;
