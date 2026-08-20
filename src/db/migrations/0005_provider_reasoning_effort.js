module.exports = {
  id: '0005_provider_reasoning_effort',
  up(db) {
    db.exec('ALTER TABLE ai_providers ADD COLUMN default_reasoning_effort TEXT');
  }
};
