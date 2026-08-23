// src/db/chat-messages.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');
const { createFilesRepo } = require('./files');
const { createChatMessagesRepo } = require('./chat-messages');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);
  const project = projects.create({ name: 'Test Project', description: '' });
  const fileA = files.create({ projectId: project.id, path: 'a.md', title: 'A', content: '# A' });
  const fileB = files.create({ projectId: project.id, path: 'b.md', title: 'B', content: '# B' });
  return { chatMessages: createChatMessagesRepo(db), fileA, fileB };
}

test('create() persists a message and returns it with a real id and timestamp', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'user', content: 'Hello' });
  assert.equal(message.role, 'user');
  assert.equal(message.content, 'Hello');
  assert.equal(message.providerLabel, null);
  assert.ok(message.id);
  assert.ok(message.createdAt);
});

test('listForFile() returns messages for that file in creation order', () => {
  const { chatMessages, fileA } = setup();
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'First' });
  chatMessages.create({ fileId: fileA.id, role: 'assistant', content: 'Second', providerLabel: 'OpenClaw' });
  const list = chatMessages.listForFile(fileA.id);
  assert.deepEqual(list.map((m) => m.content), ['First', 'Second']);
  assert.equal(list[1].providerLabel, 'OpenClaw');
});

test("listForFile() keeps each file's history isolated from other files", () => {
  const { chatMessages, fileA, fileB } = setup();
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'For A' });
  chatMessages.create({ fileId: fileB.id, role: 'user', content: 'For B' });
  assert.deepEqual(chatMessages.listForFile(fileA.id).map((m) => m.content), ['For A']);
  assert.deepEqual(chatMessages.listForFile(fileB.id).map((m) => m.content), ['For B']);
});

test('create() persists a role of "error" for failed requests', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'error', content: 'Request failed: 401 Unauthorized' });
  assert.equal(message.role, 'error');
});

test('create() persists selections and round-trips them as an array', () => {
  const { chatMessages, fileA } = setup();
  const selections = [
    { quotedText: 'Hello world', startLine: 1, endLine: 1, anchor: { a: 1 }, head: { a: 2 } }
  ];
  const message = chatMessages.create({ fileId: fileA.id, role: 'user', content: 'What does this mean?', selections });
  assert.deepEqual(message.selections, selections);
});

test('create() defaults selections to null when not provided', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'user', content: 'Hello' });
  assert.equal(message.selections, null);
});

test('create() defaults selections to null when given an empty array', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'user', content: 'Hello', selections: [] });
  assert.equal(message.selections, null);
});

test('listForFile() round-trips selections for each message independently', () => {
  const { chatMessages, fileA } = setup();
  const selections = [{ quotedText: 'A', startLine: 1, endLine: 2, anchor: {}, head: {} }];
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'Q1', selections });
  chatMessages.create({ fileId: fileA.id, role: 'assistant', content: 'A1' });
  const list = chatMessages.listForFile(fileA.id);
  assert.deepEqual(list[0].selections, selections);
  assert.equal(list[1].selections, null);
});

test("deleteForFile() removes only that file's messages, leaving other files' history intact", () => {
  const { chatMessages, fileA, fileB } = setup();
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'For A' });
  chatMessages.create({ fileId: fileB.id, role: 'user', content: 'For B' });
  chatMessages.deleteForFile(fileA.id);
  assert.deepEqual(chatMessages.listForFile(fileA.id), []);
  assert.deepEqual(chatMessages.listForFile(fileB.id).map((m) => m.content), ['For B']);
});
