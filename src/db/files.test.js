// src/db/files.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');
const { createFilesRepo } = require('./files');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);
  const project = projects.create({ name: 'Sample Project' });
  return { files, project };
}

test('create() and getFirstForProject() round-trip', () => {
  const { files, project } = setup();
  files.create({ projectId: project.id, path: 'README.md', content: '# hi' });
  files.create({ projectId: project.id, path: 'Draft.md', content: 'draft' });
  const first = files.getFirstForProject(project.id);
  assert.equal(first.path, 'README.md');
});

test('updateContent() persists new content and returns true', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'Notes.md', content: 'old' });
  const changed = files.updateContent(file.id, 'new content');
  assert.equal(changed, true);
  assert.equal(files.getById(file.id).content, 'new content');
});

test('updateContent() returns false for a missing file', () => {
  const { files } = setup();
  assert.equal(files.updateContent(999, 'x'), false);
});

test('listByProjectId() returns files ordered by id', () => {
  const { files, project } = setup();
  files.create({ projectId: project.id, path: 'A.md' });
  files.create({ projectId: project.id, path: 'B.md' });
  const list = files.listByProjectId(project.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].path, 'A.md');
});

test('updateYjsSnapshot() persists both the plain-text mirror and the binary Yjs snapshot', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'a.md', title: 'A', content: 'original' });
  const fakeYjsState = Buffer.from([1, 2, 3, 4]);

  const success = files.updateYjsSnapshot(file.id, { content: 'updated via sync', contentYjs: fakeYjsState });
  assert.equal(success, true);

  const reloaded = files.getById(file.id);
  assert.equal(reloaded.content, 'updated via sync');
  assert.ok(Buffer.isBuffer(reloaded.content_yjs));
  assert.deepEqual(reloaded.content_yjs, fakeYjsState);
});

test('updateYjsSnapshot() returns false for a nonexistent file id', () => {
  const { files } = setup();
  const success = files.updateYjsSnapshot(999999, { content: 'x', contentYjs: Buffer.from([]) });
  assert.equal(success, false);
});
