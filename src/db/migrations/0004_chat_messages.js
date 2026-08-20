module.exports = {
  id: '0004_chat_messages',
  up(db) {
    db.exec(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant','error')),
        content TEXT NOT NULL,
        provider_label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
};
