#!/usr/bin/env node
// src/scripts/migrate.js
const { config } = require('../config');
const { createConnection } = require('../db/connection');
const { migrate } = require('../db/schema');

const db = createConnection(config.dbPath);
migrate(db);
db.close();
console.log(`Migrations applied to ${config.dbPath}`);
