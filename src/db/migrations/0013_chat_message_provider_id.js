module.exports = {
  id: '0013_chat_message_provider_id',
  up(db) {
    // 0012's provider_color snapshot never updates once a provider's color
    // changes in Settings, which is exactly the "Chat colors don't match
    // configuration" mismatch reported in review - the UI has no way to ask
    // "what is this provider's color *right now*" without this FK. Nullable
    // and ON DELETE unenforced (SQLite ALTER TABLE can't add an FK with
    // ON DELETE on an existing table) by design: a deleted provider's
    // messages fall back to the provider_color/provider_label snapshot
    // already stored on the row, so history remains legible either way.
    // Historical messages must survive provider deletion, so this is a
    // best-effort live-resolution key rather than a foreign-key constraint.
    db.exec('ALTER TABLE chat_messages ADD COLUMN provider_id INTEGER');
  }
};
