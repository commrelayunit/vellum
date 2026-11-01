function toViewModel(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    providerLabel: row.provider_label,
    providerColor: row.provider_color,
    selections: row.selections ? JSON.parse(row.selections) : null,
    createdAt: row.created_at
  };
}

function createChatMessagesRepo(db) {
  return {
    listForFile(fileId) {
      return db.prepare('SELECT * FROM chat_messages WHERE file_id = ? ORDER BY id').all(fileId).map(toViewModel);
    },
    create({ fileId, role, content, providerLabel, providerColor, selections }) {
      const info = db
        .prepare('INSERT INTO chat_messages (file_id, role, content, provider_label, provider_color, selections) VALUES (?, ?, ?, ?, ?, ?)')
        .run(fileId, role, content, providerLabel || null, providerColor || null, selections && selections.length ? JSON.stringify(selections) : null);
      return toViewModel(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid));
    },
    deleteForFile(fileId) {
      db.prepare('DELETE FROM chat_messages WHERE file_id = ?').run(fileId);
    }
  };
}

module.exports = { createChatMessagesRepo };
