function createUserProfileRepo(db) {
  return {
    get() {
      const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
      return {
        label: row.label,
        avatarUrl: row.avatar_url,
        cursorColor: row.cursor_color,
        showLineNumbers: !!row.show_line_numbers,
        updatedAt: row.updated_at
      };
    },
    update({ label, avatarUrl, cursorColor, showLineNumbers }) {
      db.prepare(
        "UPDATE user_profile SET label = ?, avatar_url = ?, cursor_color = ?, show_line_numbers = ?, updated_at = datetime('now') WHERE id = 1"
      ).run(label, avatarUrl || null, cursorColor || null, showLineNumbers ? 1 : 0);
      return this.get();
    }
  };
}

module.exports = { createUserProfileRepo };
