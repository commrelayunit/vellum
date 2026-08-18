// src/db/providers.js
function maskKey(plaintext) {
  const last4 = plaintext.slice(-4);
  return `•••• ${last4}`;
}

function toViewModel(row, secrets) {
  const plaintext = secrets.decrypt(row.api_key_encrypted);
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    maskedKey: maskKey(plaintext),
    defaultModel: row.default_model,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createProvidersRepo(db, secrets) {
  return {
    list() {
      return db.prepare('SELECT * FROM ai_providers ORDER BY id').all().map((row) => toViewModel(row, secrets));
    },
    getById(id) {
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id);
      return row ? toViewModel(row, secrets) : undefined;
    },
    create({ label, baseUrl, apiKey, defaultModel, avatarUrl }) {
      const info = db
        .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted, default_model, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null);
      return this.getById(info.lastInsertRowid);
    },
    update(id, { label, baseUrl, apiKey, defaultModel, avatarUrl }) {
      if (apiKey) {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, api_key_encrypted = ?, default_model = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, id);
      } else {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, default_model = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, defaultModel || null, avatarUrl || null, id);
      }
      return this.getById(id);
    },
    remove(id) {
      const info = db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
      return info.changes > 0;
    }
  };
}

module.exports = { createProvidersRepo };
