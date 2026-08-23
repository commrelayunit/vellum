const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  return createProjectsRepo(db);
}

test('create() inserts a project with a generated slug', () => {
  const projects = setup();
  const project = projects.create({ name: 'Sample Project', description: 'demo' });
  assert.equal(project.name, 'Sample Project');
  assert.equal(project.slug, 'sample-project');
  assert.equal(project.description, 'demo');
});

test('create() deduplicates slugs', () => {
  const projects = setup();
  projects.create({ name: 'Notes' });
  const second = projects.create({ name: 'Notes' });
  assert.equal(second.slug, 'notes-2');
});

test('list() returns projects ordered by id', () => {
  const projects = setup();
  projects.create({ name: 'A' });
  projects.create({ name: 'B' });
  const all = projects.list();
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'A');
});

test('getById() returns undefined for a missing project', () => {
  const projects = setup();
  assert.equal(projects.getById(999), undefined);
});

test('update() renames a project without touching its slug', () => {
  const projects = setup();
  const created = projects.create({ name: 'Old Name', description: 'old desc' });
  const updated = projects.update(created.id, { name: 'New Name', description: 'new desc' });
  assert.equal(updated.name, 'New Name');
  assert.equal(updated.description, 'new desc');
  assert.equal(updated.slug, created.slug);
});

test('update() persists through getById()', () => {
  const projects = setup();
  const created = projects.create({ name: 'Old Name' });
  projects.update(created.id, { name: 'New Name', description: '' });
  assert.equal(projects.getById(created.id).name, 'New Name');
});
