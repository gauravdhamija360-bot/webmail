import crypto from 'crypto';

const algorithm = 'aes-256-gcm';

const getKey = () => {
  const seed = String(process.env.ADMIN_PANEL_CONFIG_KEY || process.env.ADMIN_PANEL_SESSION_SECRET || 'yoover-admin-config-key');
  return crypto.createHash('sha256').update(seed).digest();
};

export const encryptValue = plainText => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc::${iv.toString('hex')}::${tag.toString('hex')}::${encrypted.toString('hex')}`;
};

export const decryptValue = value => {
  if (!value || typeof value !== 'string' || !value.startsWith('enc::')) {
    return value;
  }

  const [, ivHex, tagHex, encryptedHex] = value.split('::');
  const decipher = crypto.createDecipheriv(algorithm, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
};
