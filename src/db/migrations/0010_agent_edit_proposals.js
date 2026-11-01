module.exports = {
  id: '0010_agent_edit_proposals',
  up(db) {
    db.exec(`CREATE TABLE agent_edit_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      provider_label TEXT,
      old_text TEXT NOT NULL,
      new_text TEXT NOT NULL,
      anchor BLOB NOT NULL,
      head BLOB NOT NULL,
      state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending', 'accepted', 'rejected', 'stale', 'conflict')),
      outcome_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX agent_edit_proposals_file_id_created_at ON agent_edit_proposals(file_id, created_at DESC);`);
  }
};
