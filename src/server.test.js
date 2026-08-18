// src/server.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.AUTH_PASSWORD_HASH = require('./scripts/hash-password').hashPassword('testpass');
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');

const app = require('./server');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
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

test('GET /projects renders the (empty) projects list', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Projects/);
  server.close();
});

test('POST /api/projects creates a project with a default file', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'New Idea' })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.project.name, 'New Idea');
  assert.equal(data.file.path, 'Untitled.md');
  server.close();
});

test('POST /api/projects rejects an empty name', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: '  ' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('GET /writing renders the project\'s first file by default', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createRes = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Writing Test Project' })
  });
  const { project } = await createRes.json();

  const res = await fetch(`${base}/writing?project=${project.id}`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Untitled\.md/);
  server.close();
});

test('GET /writing 404s for an unknown project', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/writing?project=999999`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 404);
  server.close();
});

test('POST /api/save-file/:fileId persists content', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createRes = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Save Test Project' })
  });
  const { project, file } = await createRes.json();

  const saveRes = await fetch(`${base}/api/save-file/${file.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ content: 'updated body' })
  });
  assert.equal(saveRes.status, 200);
  assert.equal((await saveRes.json()).success, true);

  const writingRes = await fetch(`${base}/writing?project=${project.id}&file=${file.id}`, { headers: { Cookie: cookie } });
  const body = await writingRes.text();
  assert.match(body, /updated body/);
  server.close();
});

test('unauthenticated GET /projects redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/projects`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('login with the correct password grants access to /projects', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=testpass',
    redirect: 'manual'
  });
  assert.equal(loginRes.status, 302);
  const cookie = loginRes.headers.get('set-cookie');

  const projectsRes = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(projectsRes.status, 200);
  server.close();
});

test('login with the wrong password is rejected', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=wrong'
  });
  assert.equal(res.status, 401);
  server.close();
});

test('unauthenticated GET /settings redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/settings`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('GET /settings renders the (empty) provider list', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Settings/);
  server.close();
});

test('POST /api/providers creates a provider and masks the key in the response', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'OpenClaw', baseUrl: 'http://localhost:18789/v1', apiKey: 'secret-token-9999' })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.provider.label, 'OpenClaw');
  assert.equal(data.provider.maskedKey, '•••• 9999');
  assert.equal(JSON.stringify(data).includes('secret-token-9999'), false);
  server.close();
});

test('POST /api/providers rejects a missing label, base URL, or API key', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: '', baseUrl: '', apiKey: '' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/providers/:id updates label/baseUrl without touching the key when apiKey is blank', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'z.ai', baseUrl: 'https://api.z.ai/v1', apiKey: 'key-1111' })
  });
  const { provider } = await createRes.json();

  const updateRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'z.ai renamed', baseUrl: 'https://api.z.ai/v1', apiKey: '' })
  });
  assert.equal(updateRes.status, 200);
  const data = await updateRes.json();
  assert.equal(data.success, true);
  assert.equal(data.provider.label, 'z.ai renamed');
  assert.equal(data.provider.maskedKey, '•••• 1111');
  server.close();
});

test('POST /api/providers/:id 404s for an unknown id', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers/999999`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'x', baseUrl: 'http://x', apiKey: '' })
  });
  assert.equal(res.status, 404);
  server.close();
});

test('POST /api/providers/:id/delete removes the provider', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'temp', baseUrl: 'http://temp', apiKey: 'key-temp' })
  });
  const { provider } = await createRes.json();

  const deleteRes = await fetch(`${base}/api/providers/${provider.id}/delete`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(deleteRes.status, 200);
  const data = await deleteRes.json();
  assert.equal(data.success, true);

  const listRes = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  const listBody = await listRes.text();
  assert.doesNotMatch(listBody, /temp/);
  server.close();
});

test('POST /api/providers/:id/delete 404s for an unknown id', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers/999999/delete`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 404);
  server.close();
});
