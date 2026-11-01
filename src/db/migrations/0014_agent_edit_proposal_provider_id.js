module.exports = {
  id: '0014_agent_edit_proposal_provider_id',
  up(db) {
    // Same rationale as 0013 for chat_messages: lets the client resolve a
    // proposal's author color live from the provider's current Settings
    // color instead of only the provider_color snapshot taken when the
    // proposal was created (0011), which is what the editor-level diff
    // widget/popover render from today.
    // A proposal remains reviewable if its provider is later removed; retain
    // the id as an optional live-color lookup key, without coupling history
    // to the providers table's lifecycle.
    db.exec('ALTER TABLE agent_edit_proposals ADD COLUMN provider_id INTEGER');
  }
};
