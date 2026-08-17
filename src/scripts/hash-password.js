#!/usr/bin/env node
// src/scripts/hash-password.js
const bcrypt = require('bcryptjs');

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

if (require.main === module) {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node src/scripts/hash-password.js <password>');
    process.exit(1);
  }
  console.log(hashPassword(password));
}

module.exports = { hashPassword };
