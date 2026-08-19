module.exports = {
  id: '0002_user_profile',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        label TEXT NOT NULL DEFAULT 'You',
        avatar_url TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.prepare("INSERT OR IGNORE INTO user_profile (id, label) VALUES (1, 'You')").run();
  }
};
