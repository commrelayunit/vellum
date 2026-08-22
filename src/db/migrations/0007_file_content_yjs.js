module.exports = {
  id: '0007_file_content_yjs',
  up(db) {
    db.exec('ALTER TABLE files ADD COLUMN content_yjs BLOB');
  }
};
