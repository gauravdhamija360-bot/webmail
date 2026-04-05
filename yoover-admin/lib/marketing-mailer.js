import nodemailer from 'nodemailer';
import {
  getMarketingCampaignDetail,
  getMarketingSenderProfileForDelivery,
  listMarketingEligibleRecipients,
  markMarketingCampaignSent
} from './admin-store.js';

const BATCH_SIZE = 20;

export const sendMarketingCampaign = async ({ campaignId }) => {
  const campaign = await getMarketingCampaignDetail(campaignId);
  if (!campaign) {
    throw new Error('Marketing campaign not found');
  }

  const senderProfile = await getMarketingSenderProfileForDelivery(campaign.senderProfileId);
  const recipients = await listMarketingEligibleRecipients(campaign.segment);
  if (!recipients.length) {
    throw new Error('No subscribed recipients matched this campaign');
  }

  const transporter = nodemailer.createTransport({
    host: senderProfile.smtpHost,
    port: Number(senderProfile.smtpPort || 587),
    secure: Boolean(senderProfile.smtpSecure),
    auth: senderProfile.smtpUser ? { user: senderProfile.smtpUser, pass: senderProfile.smtpPass || '' } : undefined
  });

  let delivered = 0;
  let failed = 0;

  for (let index = 0; index < recipients.length; index += BATCH_SIZE) {
    const batch = recipients.slice(index, index + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(recipient =>
        transporter.sendMail({
          from: senderProfile.fromName ? `${senderProfile.fromName} <${senderProfile.fromEmail}>` : senderProfile.fromEmail,
          replyTo: senderProfile.replyTo || senderProfile.fromEmail,
          to: recipient.email,
          subject: campaign.subject,
          text: campaign.textBody || campaign.previewText || '',
          html: campaign.htmlBody || `<div style="font-family:Arial,sans-serif;color:#163046">${campaign.textBody || campaign.previewText || ''}</div>`
        })
      )
    );

    results.forEach(result => {
      if (result.status === 'fulfilled') {
        delivered += 1;
      } else {
        failed += 1;
      }
    });
  }

  const updatedCampaign = await markMarketingCampaignSent({
    campaignId,
    delivered,
    failed,
    recipients: recipients.length
  });

  return {
    campaign: updatedCampaign,
    delivered,
    failed,
    recipients: recipients.length,
    senderProfile
  };
};

