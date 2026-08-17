function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function createProjectsRepo(db) {
  return {
    list() {
      return db.prepare('SELECT * FROM projects ORDER BY id').all();
    },
    getById(id) {
      return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    },
    getBySlug(slug) {
      return db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
    },
    create({ name, description }) {
      const baseSlug = slugify(name);
      let slug = baseSlug;
      let n = 2;
      while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
        slug = `${baseSlug}-${n}`;
        n += 1;
      }
      const info = db
        .prepare('INSERT INTO projects (name, slug, description) VALUES (?, ?, ?)')
        .run(name, slug, description || '');
      return this.getById(info.lastInsertRowid);
    }
  };
}

module.exports = { createProjectsRepo, slugify };
