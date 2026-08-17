const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function createConnection(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'vellum.db');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  // Errors from fs.mkdirSync and new Database intentionally propagate (fail-fast on startup)
  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { createConnection };
