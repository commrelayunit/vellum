function createUserProfileRepo(db) {
  return {
    get() {
      const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
      return {
        label: row.label,
        avatarUrl: row.avatar_url,
        updatedAt: row.updated_at
      };
    },
    update({ label, avatarUrl }) {
      db.prepare(
        "UPDATE user_profile SET label = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = 1"
      ).run(label, avatarUrl || null);
      return this.get();
    }
  };
}

module.exports = { createUserProfileRepo };
