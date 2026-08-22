module.exports = {
  id: '0006_provider_allow_insecure_tls',
  up(db) {
    db.exec('ALTER TABLE ai_providers ADD COLUMN allow_insecure_tls INTEGER NOT NULL DEFAULT 0');
  }
};
