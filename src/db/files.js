// src/db/files.js
function deriveFilePath(name) {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}.md`;
}

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
    },
    updateYjsSnapshot(id, { content, contentYjs }) {
      const info = db
        .prepare("UPDATE files SET content = ?, content_yjs = ?, updated_at = datetime('now') WHERE id = ?")
        .run(content, contentYjs, id);
      return info.changes > 0;
    },
    createNamed({ projectId, name, content }) {
      const trimmedName = name.trim();
      const basePath = deriveFilePath(trimmedName);
      const dot = basePath.lastIndexOf('.');
      let path = basePath;
      let title = trimmedName;
      let n = 2;
      while (db.prepare('SELECT 1 FROM files WHERE project_id = ? AND path = ?').get(projectId, path)) {
        path = dot > -1 ? `${basePath.slice(0, dot)} ${n}${basePath.slice(dot)}` : `${basePath} ${n}`;
        title = `${trimmedName} ${n}`;
        n += 1;
      }
      return this.create({ projectId, path, title, content });
    },
    pathExistsInProject(projectId, path, excludeId) {
      const row = excludeId
        ? db.prepare('SELECT 1 FROM files WHERE project_id = ? AND path = ? AND id != ?').get(projectId, path, excludeId)
        : db.prepare('SELECT 1 FROM files WHERE project_id = ? AND path = ?').get(projectId, path);
      return !!row;
    },
    rename(id, { path, title }) {
      db.prepare("UPDATE files SET path = ?, title = ?, updated_at = datetime('now') WHERE id = ?").run(path, title, id);
      return this.getById(id);
    },
    delete(id) {
      const info = db.prepare('DELETE FROM files WHERE id = ?').run(id);
      return info.changes > 0;
    },
    deleteByProjectId(projectId) {
      db.prepare('DELETE FROM files WHERE project_id = ?').run(projectId);
    }
  };
}

module.exports = { createFilesRepo, deriveFilePath };
