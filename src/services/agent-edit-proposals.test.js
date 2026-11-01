const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../db/connection');
const { migrate } = require('../db/schema');
const { createProjectsRepo } = require('../db/projects');
const { createFilesRepo } = require('../db/files');
const { createAgentEditProposalsRepo } = require('../db/agent-edit-proposals');
const { createSyncDocManager } = require('./sync-doc-manager');
const { createProposalService } = require('./agent-edit-proposals');

function setup(content = 'Hello world') {
  const db = createConnection(':memory:'); migrate(db);
  const projects = createProjectsRepo(db); const files = createFilesRepo(db);
  const project = projects.create({ name: 'Test' }); const file = files.create({ projectId: project.id, path: 'x.md', content });
  const manager = createSyncDocManager({ filesRepo: files });
  return { db, file, manager, service: createProposalService({ docManager: manager, proposalsRepo: createAgentEditProposalsRepo(db) }) };
}
test('a proposal persists and accepts only its still-matching anchored source', () => {
  const { db, file, manager, service } = setup();
  const made = service.propose({ fileId: file.id, providerLabel: 'Agent', oldText: 'world', newText: 'Vellum' });
  assert.equal(made.success, true); assert.equal(service.accept({ fileId: file.id, id: made.proposal.id }).proposal.state, 'accepted');
  const { doc } = manager.acquire(file.id); assert.equal(doc.getText('content').toString(), 'Hello Vellum'); manager.release(file.id); db.close();
});
test('a changed anchored source becomes an explicit conflict and remains reviewable', () => {
  const { db, file, manager, service } = setup();
  const made = service.propose({ fileId: file.id, oldText: 'world', newText: 'Vellum' });
  const { doc } = manager.acquire(file.id); doc.getText('content').delete(6, 5); doc.getText('content').insert(6, 'there'); manager.release(file.id);
  const result = service.accept({ fileId: file.id, id: made.proposal.id });
  assert.equal(result.success, false); assert.equal(result.proposal.state, 'conflict'); db.close();
});
test('the conditional state claim prevents a duplicate acceptance', () => {
  const { db, file, manager, service } = setup();
  const made = service.propose({ fileId: file.id, oldText: 'world', newText: 'Vellum' });
  assert.equal(service.accept({ fileId: file.id, id: made.proposal.id }).success, true);
  const duplicate = service.accept({ fileId: file.id, id: made.proposal.id });
  assert.equal(duplicate.success, false); assert.equal(duplicate.status, 409); assert.equal(duplicate.proposal.state, 'accepted');
  const { doc } = manager.acquire(file.id); assert.equal(doc.getText('content').toString(), 'Hello Vellum'); manager.release(file.id); db.close();
});
