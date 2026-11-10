module.exports = {
  id: '0015_theme_preference',
  up(db) {
    db.exec("ALTER TABLE user_profile ADD COLUMN theme TEXT NOT NULL DEFAULT 'system'");
  }
};
