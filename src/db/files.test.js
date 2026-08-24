// src/db/files.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');
const { createFilesRepo, deriveFilePath } = require('./files');

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

test('deriveFilePath() appends .md when the name has no extension', () => {
  assert.equal(deriveFilePath('Chapter 2'), 'Chapter 2.md');
});

test('deriveFilePath() keeps an extension the name already has', () => {
  assert.equal(deriveFilePath('notes.txt'), 'notes.txt');
});

test('createNamed() derives path and title from a plain name', () => {
  const { files, project } = setup();
  const file = files.createNamed({ projectId: project.id, name: 'Chapter 2' });
  assert.equal(file.path, 'Chapter 2.md');
  assert.equal(file.title, 'Chapter 2');
  assert.equal(file.content, '');
});

test('createNamed() passes through initial content', () => {
  const { files, project } = setup();
  const file = files.createNamed({ projectId: project.id, name: 'Notes', content: 'hello' });
  assert.equal(file.content, 'hello');
});

test('createNamed() deduplicates a colliding path by appending a number before the extension', () => {
  const { files, project } = setup();
  files.createNamed({ projectId: project.id, name: 'Chapter 2' });
  const second = files.createNamed({ projectId: project.id, name: 'Chapter 2' });
  assert.equal(second.path, 'Chapter 2 2.md');
  assert.equal(second.title, 'Chapter 2 2');
  const third = files.createNamed({ projectId: project.id, name: 'Chapter 2' });
  assert.equal(third.path, 'Chapter 2 3.md');
});

test('createNamed() dedup does not collide across different projects', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);
  const projectA = projects.create({ name: 'Project A' });
  const projectB = projects.create({ name: 'Project B' });
  files.createNamed({ projectId: projectA.id, name: 'Notes' });
  // A second project should be free to use the same name without a suffix.
  const file = files.createNamed({ projectId: projectB.id, name: 'Notes' });
  assert.equal(file.path, 'Notes.md');
});

test('pathExistsInProject() reports a collision and respects excludeId', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'Draft.md' });
  assert.equal(files.pathExistsInProject(project.id, 'Draft.md'), true);
  assert.equal(files.pathExistsInProject(project.id, 'Draft.md', file.id), false);
  assert.equal(files.pathExistsInProject(project.id, 'Other.md'), false);
});

test('rename() updates path and title together', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'Untitled.md', title: 'Untitled' });
  const renamed = files.rename(file.id, { path: 'Renamed.md', title: 'Renamed' });
  assert.equal(renamed.path, 'Renamed.md');
  assert.equal(renamed.title, 'Renamed');
  assert.equal(files.getById(file.id).path, 'Renamed.md');
});

test('delete() removes the file and returns true', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'Gone.md' });
  const success = files.delete(file.id);
  assert.equal(success, true);
  assert.equal(files.getById(file.id), undefined);
});

test('delete() returns false for a missing file', () => {
  const { files } = setup();
  assert.equal(files.delete(999999), false);
});
