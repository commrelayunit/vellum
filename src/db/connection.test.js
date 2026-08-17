// src/db/connection.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConnection } = require('./connection');

test('createConnection opens a file db and creates the parent directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-test-'));
  const dbPath = path.join(tmpDir, 'nested', 'vellum.db');
  const db = createConnection(dbPath);
  assert.equal(fs.existsSync(dbPath), true);
  db.close();
});

test('createConnection(":memory:") opens an in-memory db without touching disk', () => {
  const db = createConnection(':memory:');
  db.prepare('CREATE TABLE t (id INTEGER)').run();
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM t').get().n, 0);
  db.close();
});
