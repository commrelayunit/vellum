// src/config.js
const path = require('path');
require('dotenv').config({ quiet: true });

function loadConfig(env = process.env) {
  return {
    port: parseInt(env.PORT, 10) || 3001,
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'vellum.db'),
    sessionSecret: env.SESSION_SECRET || 'dev-secret-change-me',
    authPasswordHash: env.AUTH_PASSWORD_HASH || null,
    encryptionKey: env.ENCRYPTION_KEY || null
  };
}

module.exports = { loadConfig, config: loadConfig() };
