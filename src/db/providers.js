// src/db/providers.js
const UNREADABLE_KEY_LABEL = '•••• (unreadable)';

function maskKey(plaintext) {
  if (plaintext.length <= 4) {
    return '•'.repeat(Math.max(plaintext.length, 4));
  }
  const last4 = plaintext.slice(-4);
  return `•••• ${last4}`;
}

function toViewModel(row, secrets) {
  let maskedKey;
  try {
    maskedKey = maskKey(secrets.decrypt(row.api_key_encrypted));
  } catch {
    maskedKey = UNREADABLE_KEY_LABEL;
  }
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    maskedKey,
    defaultModel: row.default_model,
    avatarUrl: row.avatar_url,
    activeInWorkspace: !!row.active_in_workspace,
    defaultReasoningEffort: row.default_reasoning_effort,
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
    getDecryptedApiKey(id) {
      const row = db.prepare('SELECT api_key_encrypted FROM ai_providers WHERE id = ?').get(id);
      return row ? secrets.decrypt(row.api_key_encrypted) : undefined;
    },
    create({ label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace, defaultReasoningEffort }) {
      const info = db
        .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted, default_model, avatar_url, active_in_workspace, default_reasoning_effort) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null);
      return this.getById(info.lastInsertRowid);
    },
    update(id, { label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace, defaultReasoningEffort }) {
      if (apiKey) {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, api_key_encrypted = ?, default_model = ?, avatar_url = ?, active_in_workspace = ?, default_reasoning_effort = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null, id);
      } else {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, default_model = ?, avatar_url = ?, active_in_workspace = ?, default_reasoning_effort = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null, id);
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
