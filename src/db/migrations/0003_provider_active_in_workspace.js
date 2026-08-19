module.exports = {
  id: '0003_provider_active_in_workspace',
  up(db) {
    db.exec('ALTER TABLE ai_providers ADD COLUMN active_in_workspace INTEGER NOT NULL DEFAULT 0');
  }
};
