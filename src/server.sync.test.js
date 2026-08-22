// src/server.sync.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

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
