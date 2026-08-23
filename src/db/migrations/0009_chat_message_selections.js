module.exports = {
  id: '0009_chat_message_selections',
  up(db) {
    db.exec('ALTER TABLE chat_messages ADD COLUMN selections TEXT');
  }
};
