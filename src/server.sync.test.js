// src/server.sync.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const net = require('net');

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.AUTH_PASSWORD_HASH = require('./scripts/hash-password').hashPassword('testpass');
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const app = require('./server');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      app.attachWebSocketServer(server);
      resolve(server);
    });
  });
}

async function login(base) {
  const loginRes = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=testpass',
    redirect: 'manual'
  });
  return loginRes.headers.get('set-cookie');
}

async function createProjectAndFile(base, cookie) {
  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Sync Test Project' })
  });
  const { file } = await res.json();
  return file;
}

test('a WebSocket upgrade without a valid session cookie is rejected', async () => {
  const server = await listen();
  const { port } = server.address();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/1`);
  const result = await new Promise((resolve) => {
    ws.on('open', () => resolve('open'));
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
  assert.notEqual(result, 'open');
  server.close();
});

test('an unauthenticated client that aborts the upgrade handshake mid-flight does not crash the server', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  // No session cookie is used anywhere in this test on purpose: this is the
  // exact capability an anonymous remote client has. Open a raw TCP socket,
  // write a WebSocket upgrade request for /ws/files/:id, then RST it. That
  // resets the connection while the upgrade handler is still inside
  // `await authenticateUpgrade(req)` (and again when the handler writes its
  // 401 back to the dead peer). Without an 'error' listener registered on
  // the raw socket as the handler's first statement, Node rethrows the
  // resulting ECONNRESET as an uncaught exception and the whole process
  // dies. A handful of attempts is used rather than one because the exact
  // moment the reset lands relative to the await is timing-dependent.
  const upgradeRequest =
    `GET /ws/files/1 HTTP/1.1\r\n` +
    `Host: 127.0.0.1:${port}\r\n` +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
    'Sec-WebSocket-Version: 13\r\n' +
    '\r\n';

  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => {
      const sock = net.connect(port, '127.0.0.1', () => {
        sock.write(upgradeRequest);
        sock.resetAndDestroy();
        resolve();
      });
      // The client side of a reset connection errors too; that's expected
      // and irrelevant here - only the server's survival is under test.
      sock.on('error', () => resolve());
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  // Prove the server process survived and is still serving: log in (which
  // exercises a full request/response cycle) and fetch an authenticated
  // page. If the process had crashed, node:test would have attributed the
  // uncaught exception to this test already.
  const cookie = await login(base);
  const followUp = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(followUp.status, 200);

  server.close();
});

test('an authenticated WebSocket upgrade to a nonexistent fileId is cleanly rejected, not a crash', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/999999`, {
    headers: { Cookie: cookie }
  });
  const result = await new Promise((resolve) => {
    ws.on('open', () => resolve('open'));
    ws.on('unexpected-response', (req, res) => resolve(res.statusCode));
    ws.on('error', () => resolve('error'));
  });
  assert.equal(result, 404);

  // Prove the server process is still alive and responsive afterward,
  // rather than having crashed on an unhandled rejection.
  const followUp = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(followUp.status, 200);

  server.close();
});

test('a malformed binary frame from an authenticated client does not crash the server', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/${file.id}`, {
    headers: { Cookie: cookie }
  });
  await new Promise((resolve) => ws.on('open', resolve));

  // Garbage bytes: not a valid lib0-encoded sync/awareness message. lib0's
  // decoder throws on this; the fix wraps the message handler in try/catch
  // so the throw is logged and swallowed rather than crashing the process.
  ws.send(Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]));

  await new Promise((resolve) => setTimeout(resolve, 200));

  // Prove the process is still alive and responsive by making a normal,
  // unrelated HTTP request with the same cookie right after.
  const followUp = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(followUp.status, 200);

  ws.close();
  server.close();
});

// Connects an awareness-speaking client: its own Y.Doc + Awareness wired to
// the server over the real WebSocket, mirroring src/client/editor-sync.js's
// message framing. Used by the two awareness tests below.
function connectAwarenessClient(port, fileId, cookie) {
  const Y = require('yjs');
  const awarenessProtocol = require('y-protocols/awareness');
  const encoding = require('lib0/encoding');
  const decoding = require('lib0/decoding');
  const MESSAGE_AWARENESS = 1;

  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/${fileId}`, {
      headers: { Cookie: cookie }
    });
    ws.binaryType = 'arraybuffer';
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);

    function setUser(name) {
      awareness.setLocalStateField('user', { name });
    }

    awareness.on('update', ({ added, updated, removed }, origin) => {
      // Only forward changes this client originated; echoing back what the
      // server just told us would loop.
      if (origin === ws) return;
      const changed = added.concat(updated).concat(removed);
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
      if (ws.readyState === WebSocket.OPEN) ws.send(encoding.toUint8Array(enc));
    });

    ws.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
      }
    });

    // Awareness installs a repeating stale-client sweep timer that keeps
    // Node's event loop alive; without destroying it the test process never
    // exits and the whole file times out.
    function destroy() {
      ws.close();
      awareness.destroy();
      doc.destroy();
    }

    ws.on('open', () => resolve({ ws, doc, awareness, setUser, destroy }));
  });
}

test('a newly joining client immediately receives the awareness state of peers already present', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const clientA = await connectAwarenessClient(port, file.id, cookie);
  clientA.setUser('Alice');
  await new Promise((resolve) => setTimeout(resolve, 200));

  // B joins after A's state is already settled on the server, and A never
  // changes its state again. Without the server proactively sending the
  // room's current awareness states on connect, B would see nothing here.
  const clientB = await connectAwarenessClient(port, file.id, cookie);
  await new Promise((resolve) => setTimeout(resolve, 200));

  const seenByB = clientB.awareness.getStates().get(clientA.doc.clientID);
  assert.ok(seenByB, "client B did not receive client A's pre-existing awareness state");
  assert.equal(seenByB.user.name, 'Alice');

  clientA.destroy();
  clientB.destroy();
  server.close();
});

test("a disconnecting client's awareness state is removed from the other clients' view", async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const clientA = await connectAwarenessClient(port, file.id, cookie);
  const clientB = await connectAwarenessClient(port, file.id, cookie);
  clientA.setUser('Alice');
  clientB.setUser('Bob');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(
    clientB.awareness.getStates().get(clientA.doc.clientID),
    'precondition failed: B never saw A in the first place'
  );

  clientA.ws.close();
  // Well under Awareness's own ~30s stale-client timeout sweep, so this can
  // only pass if the server actively removes A's clientID on close.
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(
    clientB.awareness.getStates().get(clientA.doc.clientID),
    undefined,
    "client A's awareness state lingered as a ghost after it disconnected"
  );
  assert.ok(
    clientB.awareness.getStates().get(clientB.doc.clientID),
    "client B's own awareness state was wrongly removed too"
  );

  clientA.destroy();
  clientB.destroy();
  server.close();
});

test('two connected clients converge on the same merged content after concurrent edits', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const Y = require('yjs');
  const syncProtocol = require('y-protocols/sync');
  const encoding = require('lib0/encoding');
  const decoding = require('lib0/decoding');
  const MESSAGE_SYNC = 0;

  function connect() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/${file.id}`, {
        headers: { Cookie: cookie }
      });
      ws.binaryType = 'arraybuffer';
      const doc = new Y.Doc();
      ws.on('open', () => resolve({ ws, doc }));
      ws.on('message', (data) => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(decoder);
        if (messageType === MESSAGE_SYNC) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, null);
          if (encoding.length(enc) > 1) {
            ws.send(encoding.toUint8Array(enc));
          }
        }
      });
      doc.on('update', (update, origin) => {
        if (origin === 'remote') return;
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        ws.send(encoding.toUint8Array(enc));
      });
    });
  }

  const clientA = await connect();
  const clientB = await connect();

  await new Promise((resolve) => setTimeout(resolve, 200));

  clientA.doc.getText('content').insert(0, 'Hello from A. ');
  clientB.doc.getText('content').insert(0, 'Hello from B. ');

  await new Promise((resolve) => setTimeout(resolve, 300));

  const textA = clientA.doc.getText('content').toString();
  const textB = clientB.doc.getText('content').toString();
  assert.equal(textA, textB);
  assert.match(textA, /Hello from A\./);
  assert.match(textA, /Hello from B\./);

  clientA.ws.close();
  clientB.ws.close();
  server.close();
});

test('the file row is updated after the last client for it disconnects', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const Y = require('yjs');
  const syncProtocol = require('y-protocols/sync');
  const encoding = require('lib0/encoding');
  const decoding = require('lib0/decoding');
  const MESSAGE_SYNC = 0;

  const doc = new Y.Doc();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/${file.id}`, { headers: { Cookie: cookie } });
  ws.binaryType = 'arraybuffer';
  await new Promise((resolve) => {
    ws.on('open', resolve);
    ws.on('message', (data) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === MESSAGE_SYNC) {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.readSyncMessage(decoder, enc, doc, null);
        if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
      }
    });
  });
  doc.on('update', (update) => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeUpdate(enc, update);
    ws.send(encoding.toUint8Array(enc));
  });

  await new Promise((resolve) => setTimeout(resolve, 200));
  doc.getText('content').insert(0, 'persisted via sync');
  await new Promise((resolve) => setTimeout(resolve, 200));

  ws.close();
  await new Promise((resolve) => setTimeout(resolve, 200));

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);

  const historyCheck = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  assert.equal(historyCheck.status, 200);

  server.close();
});

test('a plain-text save via POST /api/save-file nulls out a stale Yjs snapshot, so the next sync connection re-seeds from it instead of loading stale content', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const file = await createProjectAndFile(base, cookie);

  const Y = require('yjs');
  const syncProtocol = require('y-protocols/sync');
  const encoding = require('lib0/encoding');
  const decoding = require('lib0/decoding');
  const MESSAGE_SYNC = 0;

  function connect() {
    return new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/files/${file.id}`, {
        headers: { Cookie: cookie }
      });
      ws.binaryType = 'arraybuffer';
      const doc = new Y.Doc();
      ws.on('open', () => {
        // Unlike the other connect() helpers in this file, this test
        // actually depends on the client receiving the server's current
        // content (not just the reverse direction), so it must send its
        // own SyncStep1 - mirroring src/client/editor-sync.js's
        // sendSyncStep1(). Merely replying to the server's unprompted
        // outbound SyncStep1 only tells the server what the (empty)
        // client has; it never pulls the server's content down.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(enc, doc);
        ws.send(encoding.toUint8Array(enc));
        resolve({ ws, doc });
      });
      ws.on('message', (data) => {
        const decoder = decoding.createDecoder(new Uint8Array(data));
        const messageType = decoding.readVarUint(decoder);
        if (messageType === MESSAGE_SYNC) {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MESSAGE_SYNC);
          syncProtocol.readSyncMessage(decoder, enc, doc, null);
          if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
        }
      });
      doc.on('update', (update) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        ws.send(encoding.toUint8Array(enc));
      });
    });
  }

  const openSockets = [];
  try {
    // Step 1: connect a client, mutate the doc, and disconnect - this
    // persists a real, non-empty content_yjs snapshot for the file (see
    // the "file row is updated after the last client disconnects" test
    // above for the same persist-on-release mechanism).
    const clientA = await connect();
    openSockets.push(clientA.ws);
    await new Promise((resolve) => setTimeout(resolve, 200));
    clientA.doc.getText('content').insert(0, 'STALE_YJS_MARKER ');
    await new Promise((resolve) => setTimeout(resolve, 200));
    clientA.ws.close();
    // Give the server time to see the close event and run
    // docManager.release, which synchronously persists the Yjs snapshot
    // and evicts the in-memory entry (so the next connect() below is
    // forced to reload from the DB).
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Step 2: save brand-new plain-text content via the fallback HTTP
    // route - this is the path exercised when the WebSocket sync isn't
    // connected.
    const freshContent = 'FRESH_PLAIN_TEXT_ONLY';
    const saveRes = await fetch(`${base}/api/save-file/${file.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ content: freshContent })
    });
    // Must consume the response body (POST /api/save-file/:fileId returns
    // {success, message} JSON per src/server.js) before moving on. Leaving
    // it unread can keep the underlying connection open, which has
    // previously caused a later server.close() in this same file to hang
    // forever (server.close() stops accepting new connections but does
    // not force-close existing ones).
    await saveRes.json();
    assert.equal(saveRes.status, 200);

    // Step 3: connect a fresh client. If the stale content_yjs snapshot
    // from step 1 were still in place, loadInitialContent
    // (sync-doc-manager.js) would apply it and this client would see the
    // STALE_YJS_MARKER content from before the save, not the
    // freshly-saved plain text. With the fix (POST /api/save-file/:fileId
    // nulling contentYjs), loadInitialContent falls back to seeding fresh
    // from the just-saved plain-text content.
    const clientB = await connect();
    openSockets.push(clientB.ws);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const syncedText = clientB.doc.getText('content').toString();
    assert.equal(syncedText, freshContent);
    assert.doesNotMatch(syncedText, /STALE_YJS_MARKER/);
  } finally {
    for (const ws of openSockets) ws.close();
    server.close();
  }
});
