module.exports = {
  id: '0007_presence_colors',
  up(db) {
    db.exec('ALTER TABLE user_profile ADD COLUMN cursor_color TEXT');
    db.exec('ALTER TABLE ai_providers ADD COLUMN color TEXT');
  }
};
