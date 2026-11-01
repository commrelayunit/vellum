module.exports = {
  id: '0012_chat_message_provider_color',
  up(db) {
    // Durably snapshotted at message-creation time, the same way
    // agent_edit_proposals.provider_color already works (0011) - so a chat
    // message's author color stays correct even if the provider's color is
    // later changed or the provider itself is deleted.
    db.exec('ALTER TABLE chat_messages ADD COLUMN provider_color TEXT');
  }
};
