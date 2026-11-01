module.exports = {
  id: '0011_agent_edit_proposal_metadata',
  up(db) {
    db.exec(`ALTER TABLE agent_edit_proposals ADD COLUMN provider_color TEXT;
    ALTER TABLE agent_edit_proposals ADD COLUMN start_line INTEGER;
    ALTER TABLE agent_edit_proposals ADD COLUMN end_line INTEGER;`);
  }
};
