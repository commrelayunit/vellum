function createAgentEditProposalsRepo(db) {
  const map = (row) => row && ({ ...row, anchor: Buffer.from(row.anchor).toString('base64'), head: Buffer.from(row.head).toString('base64') });
  return {
    create({ fileId, providerLabel, oldText, newText, anchor, head }) {
      const result = db.prepare(`INSERT INTO agent_edit_proposals (file_id, provider_label, old_text, new_text, anchor, head)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(fileId, providerLabel || null, oldText, newText, anchor, head);
      return this.getById(result.lastInsertRowid);
    },
    listForFile(fileId) {
      return db.prepare('SELECT * FROM agent_edit_proposals WHERE file_id = ? ORDER BY created_at DESC, id DESC').all(fileId).map(map);
    },
    getById(id) { return map(db.prepare('SELECT * FROM agent_edit_proposals WHERE id = ?').get(id)); },
    resolvePending(id, state, message) {
      const result = db.prepare(`UPDATE agent_edit_proposals SET state = ?, outcome_message = ?, resolved_at = datetime('now')
        WHERE id = ? AND state = 'pending'`).run(state, message || null, id);
      return result.changes === 1 ? this.getById(id) : null;
    },
    deleteForFile(fileId) { db.prepare('DELETE FROM agent_edit_proposals WHERE file_id = ?').run(fileId); }
  };
}
module.exports = { createAgentEditProposalsRepo };
