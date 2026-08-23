module.exports = {
  id: '0008_show_line_numbers',
  up(db) {
    db.exec("ALTER TABLE user_profile ADD COLUMN show_line_numbers INTEGER NOT NULL DEFAULT 0");
  }
};
