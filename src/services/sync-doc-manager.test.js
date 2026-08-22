// src/services/sync-doc-manager.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { createSyncDocManager } = require('./sync-doc-manager');

function fakeFilesRepo(initial) {
  const rows = new Map(Object.entries(initial));
  return {
    getById(id) {
      return rows.get(String(id));
    },
    updateYjsSnapshot(id, { content, contentYjs }) {
      const row = rows.get(String(id));
      if (!row) return false;
      row.content = content;
      row.content_yjs = contentYjs;
      return true;
    },
    _rows: rows
  };
}

test('acquire() seeds a new doc from plain-text content when content_yjs is null', () => {
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'hello world', content_yjs: null } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  const { doc } = manager.acquire(1);
  assert.equal(doc.getText('content').toString(), 'hello world');
  manager.release(1);
});

test('acquire() seeds a new doc from content_yjs when present, ignoring the plain-text mirror', () => {
  const seedDoc = new Y.Doc();
  seedDoc.getText('content').insert(0, 'from yjs state');
  const encoded = Buffer.from(Y.encodeStateAsUpdate(seedDoc));
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'stale mirror text', content_yjs: encoded } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  const { doc } = manager.acquire(1);
  assert.equal(doc.getText('content').toString(), 'from yjs state');
  manager.release(1);
});

test('acquire() called twice for the same file returns the same doc instance', () => {
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'x', content_yjs: null } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  const first = manager.acquire(1);
  const second = manager.acquire(1);
  assert.equal(first.doc, second.doc);
  manager.release(1);
  manager.release(1);
});

test('release() persists the current doc state back to the files repo once the last reference drops', () => {
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'original', content_yjs: null } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  const { doc } = manager.acquire(1);
  doc.getText('content').insert(0, 'edited: ');
  manager.release(1);

  const row = filesRepo._rows.get('1');
  assert.equal(row.content, 'edited: original');
  assert.ok(Buffer.isBuffer(row.content_yjs));
});

test('release() before the last reference drops does not persist yet', () => {
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'original', content_yjs: null } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  manager.acquire(1);
  manager.acquire(1);
  const { doc } = manager.acquire(1);
  doc.getText('content').insert(0, 'edited: ');
  manager.release(1);

  const row = filesRepo._rows.get('1');
  assert.equal(row.content, 'original');
  manager.release(1);
  manager.release(1);
});

test('acquire() after full release creates a fresh doc seeded from the just-persisted state', () => {
  const filesRepo = fakeFilesRepo({ 1: { id: 1, content: 'original', content_yjs: null } });
  const manager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 999999 });
  const { doc: firstDoc } = manager.acquire(1);
  firstDoc.getText('content').insert(0, 'v1: ');
  manager.release(1);

  const { doc: secondDoc } = manager.acquire(1);
  assert.equal(secondDoc.getText('content').toString(), 'v1: original');
  assert.notEqual(secondDoc, firstDoc);
  manager.release(1);
});
