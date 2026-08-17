// src/db/files.js
function createFilesRepo(db) {
  return {
    listByProjectId(projectId) {
      return db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY id').all(projectId);
    },
    getById(id) {
      return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    },
    getFirstForProject(projectId) {
      return db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY id LIMIT 1').get(projectId);
    },
    create({ projectId, path: filePath, title, content }) {
      const info = db
        .prepare('INSERT INTO files (project_id, path, title, content) VALUES (?, ?, ?, ?)')
        .run(projectId, filePath, title || filePath, content || '');
      return this.getById(info.lastInsertRowid);
    },
    updateContent(id, content) {
      const info = db
        .prepare("UPDATE files SET content = ?, updated_at = datetime('now') WHERE id = ?")
        .run(content, id);
      return info.changes > 0;
    }
  };
}

module.exports = { createFilesRepo };
