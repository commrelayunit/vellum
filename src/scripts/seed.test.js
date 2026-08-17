// src/scripts/seed.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../db/connection');
const { seedDatabase } = require('./seed');

test('seedDatabase() creates the two sample projects with their files', () => {
  const db = createConnection(':memory:');
  const projects = seedDatabase(db);
  assert.equal(projects.length, 2);
  assert.equal(projects[0].name, 'Sample Project');
});

test('seedDatabase() is idempotent', () => {
  const db = createConnection(':memory:');
  seedDatabase(db);
  const second = seedDatabase(db);
  assert.equal(second.length, 2);
});
