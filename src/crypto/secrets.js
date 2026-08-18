// src/crypto/secrets.js
const crypto = require('crypto');

function createSecretsService(base64Key) {
  let key = null;
  if (base64Key) {
    const decoded = Buffer.from(base64Key, 'base64');
    if (decoded.length === 32) {
      key = decoded;
    }
  }

  function requireKey() {
    if (!key) {
      throw new Error(
        'ENCRYPTION_KEY is missing or invalid. Generate one with `openssl rand -base64 32` ' +
        'and set it in your .env / systemd EnvironmentFile.'
      );
    }
    return key;
  }

  return {
    encrypt(plaintext) {
      const k = requireKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    },
    decrypt(ciphertext) {
      const k = requireKey();
      const data = Buffer.from(ciphertext, 'base64');
      const iv = data.subarray(0, 12);
      const authTag = data.subarray(12, 28);
      const encrypted = data.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }
  };
}

module.exports = { createSecretsService };
