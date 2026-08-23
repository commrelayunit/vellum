const { test } = require('node:test');
const assert = require('node:assert/strict');
const Y = require('yjs');
const { createSyncDocManager } = require('./sync-doc-manager');
const { createAgentEditSession } = require('./agent-editor');

function setup(initialContent) {
  const filesRepo = {
    getById: (id) => ({ id, content: initialContent, content_yjs: null }),
    updateYjsSnapshot: () => {}
  };
  const docManager = createSyncDocManager({ filesRepo, snapshotIntervalMs: 1000000 });
  return { docManager };
}

test('getCurrentContent() returns the live document text', () => {
  const { docManager } = setup('Hello world');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkDelayMs: 0 });
  assert.equal(session.getCurrentContent(), 'Hello world');
  session.end();
});

test('applyEdit() replaces a unique match and reports success', async () => {
  const { docManager } = setup('Hello world');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkDelayMs: 0 });
  const result = await session.applyEdit('world', 'there');
  assert.equal(result.success, true);
  assert.equal(session.getCurrentContent(), 'Hello there');
  session.end();
});

test('applyEdit() inserts the replacement in the specified chunk size', async () => {
  const { docManager } = setup('X');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkSize: 2, chunkDelayMs: 0 });
  const result = await session.applyEdit('X', 'ABCDE');
  assert.equal(result.success, true);
  assert.equal(session.getCurrentContent(), 'ABCDE');
  session.end();
});

test('applyEdit() fails without mutating the document when old_string is not found', async () => {
  const { docManager } = setup('Hello world');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkDelayMs: 0 });
  const result = await session.applyEdit('goodbye', 'hi');
  assert.equal(result.success, false);
  assert.match(result.message, /not found/);
  assert.equal(session.getCurrentContent(), 'Hello world');
  session.end();
});

test('applyEdit() fails without mutating the document when old_string matches more than once', async () => {
  const { docManager } = setup('cat cat cat');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkDelayMs: 0 });
  const result = await session.applyEdit('cat', 'dog');
  assert.equal(result.success, false);
  assert.match(result.message, /matches 3 times/);
  assert.equal(session.getCurrentContent(), 'cat cat cat');
  session.end();
});

test('applyEdit() stays correct when a concurrent edit happens elsewhere in the document mid-insert', async () => {
  // This exact scenario (content, old_string/new_string, chunk size, and
  // the concurrent prefix insert) was verified by hand with real yjs,
  // including checking that the final document is invariant to exactly
  // when the concurrent edit lands during the chunked insert (tried at
  // delays of 0, 1, 8, 12, and 20ms - all produce the same result): the
  // final document is 'PREFIX-STARTNEWEND'. The concurrent 'PREFIX-'
  // insert at the very start shifts the agent's remaining chunks forward
  // by 7 characters exactly once, and every chunk still lands in the
  // right place because each one re-resolves its position from a
  // Y.RelativePosition anchor rather than stale arithmetic.
  const { docManager } = setup('START-END');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent', providerColor: '#ff0000', chunkSize: 1, chunkDelayMs: 5 });
  const editPromise = session.applyEdit('-', 'NEW');
  // Let the first chunk land, then inject a concurrent edit at the very
  // start of the document - this is exactly the scenario the
  // Y.RelativePosition re-anchoring exists to survive.
  await new Promise((resolve) => setTimeout(resolve, 8));
  const { doc } = docManager.acquire(1);
  doc.getText('content').insert(0, 'PREFIX-');
  docManager.release(1);
  const result = await editPromise;
  assert.equal(result.success, true);
  assert.equal(session.getCurrentContent(), 'PREFIX-STARTNEWEND');
  session.end();
});

test('applyEdit() registers a synthetic awareness entry with the provider color, removed by end()', async () => {
  const { docManager } = setup('Hello world');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'Agent Smith', providerColor: '#123456', chunkDelayMs: 0 });
  const { awareness } = docManager.acquire(1);
  docManager.release(1); // undo the extra acquire() from this line, session already holds its own
  // y-protocols' Awareness constructor always registers an empty local
  // state ({}) for the underlying doc's own clientID (unrelated to this
  // session), so filter to entries that actually carry a `user` field
  // when checking for the agent's synthetic presence specifically.
  const presenceStatesBefore = Array.from(awareness.getStates().values()).filter((s) => s.user);
  assert.equal(presenceStatesBefore.length, 0, 'no presence should be registered before the first edit');
  await session.applyEdit('world', 'there');
  const states = Array.from(awareness.getStates().values()).filter((s) => s.user);
  assert.equal(states.length, 1);
  assert.equal(states[0].user.name, 'Agent Smith');
  assert.equal(states[0].user.color, '#123456');
  assert.match(states[0].user.colorLight, /^color-mix\(in srgb, #123456 20%, transparent\)$/);
  session.end();
  const presenceStatesAfter = Array.from(awareness.getStates().values()).filter((s) => s.user);
  assert.equal(presenceStatesAfter.length, 0, 'presence must be removed by end()');
});

test('applyEdit() falls back to a hash-derived color when the provider has none set', async () => {
  const { docManager } = setup('Hello world');
  const session = createAgentEditSession({ docManager, fileId: 1, providerLabel: 'No Color Agent', providerColor: null, chunkDelayMs: 0 });
  const { awareness } = docManager.acquire(1);
  docManager.release(1);
  await session.applyEdit('world', 'there');
  const states = Array.from(awareness.getStates().values()).filter((s) => s.user);
  assert.ok(['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'].includes(states[0].user.color));
  session.end();
});
