// src/services/sync-doc-manager.js
const Y = require('yjs');
const { Awareness } = require('y-protocols/awareness');

function loadInitialContent(filesRepo, fileId) {
  const file = filesRepo.getById(fileId);
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  if (file.content_yjs) {
    Y.applyUpdate(doc, file.content_yjs);
  } else {
    ytext.insert(0, file.content || '');
  }
  return doc;
}

function persist(filesRepo, fileId, doc) {
  const content = doc.getText('content').toString();
  const contentYjs = Buffer.from(Y.encodeStateAsUpdate(doc));
  filesRepo.updateYjsSnapshot(fileId, { content, contentYjs });
}

function createSyncDocManager({ filesRepo, snapshotIntervalMs = 30000 }) {
  const entries = new Map();

  return {
    acquire(fileId) {
      let entry = entries.get(fileId);
      if (!entry) {
        const doc = loadInitialContent(filesRepo, fileId);
        const awareness = new Awareness(doc);
        const timer = setInterval(() => persist(filesRepo, fileId, doc), snapshotIntervalMs);
        entry = { doc, awareness, timer, refCount: 0 };
        entries.set(fileId, entry);
      }
      entry.refCount += 1;
      return { doc: entry.doc, awareness: entry.awareness };
    },
    release(fileId) {
      const entry = entries.get(fileId);
      if (!entry) return;
      entry.refCount -= 1;
      if (entry.refCount <= 0) {
        clearInterval(entry.timer);
        persist(filesRepo, fileId, entry.doc);
        entry.awareness.destroy();
        entries.delete(fileId);
      }
    }
  };
}

module.exports = { createSyncDocManager };
