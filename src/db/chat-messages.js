function toViewModel(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    providerLabel: row.provider_label,
    createdAt: row.created_at
  };
}

function createChatMessagesRepo(db) {
  return {
    listForFile(fileId) {
      return db.prepare('SELECT * FROM chat_messages WHERE file_id = ? ORDER BY id').all(fileId).map(toViewModel);
    },
    create({ fileId, role, content, providerLabel }) {
      const info = db
        .prepare('INSERT INTO chat_messages (file_id, role, content, provider_label) VALUES (?, ?, ?, ?)')
        .run(fileId, role, content, providerLabel || null);
      return toViewModel(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid));
    }
  };
}

module.exports = { createChatMessagesRepo };
