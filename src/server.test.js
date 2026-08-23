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

test('POST /api/projects/:id renames a project and updates its description', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Old Name' })
  });
  const { project } = await createRes.json();

  const res = await fetch(`${base}/api/projects/${project.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'New Name', description: 'updated' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.project.name, 'New Name');
  assert.equal(data.project.description, 'updated');
  assert.equal(data.project.slug, project.slug);
  server.close();
});

test('POST /api/projects/:id rejects an empty name', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Old Name' })
  });
  const { project } = await createRes.json();

  const res = await fetch(`${base}/api/projects/${project.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: '  ' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/projects/:id 404s for an unknown id', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/projects/999999`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'New Name' })
  });
  assert.equal(res.status, 404);
  server.close();
});

test('unauthenticated POST /api/projects/:id redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/projects/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/login/);
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

test('POST /api/providers persists color and POST /api/providers/:id updates it', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'OpenClaw', baseUrl: 'http://localhost:18789/v1', apiKey: 'secret-token-9999', color: '#c96f48' })
  });
  const { provider } = await createRes.json();
  assert.equal(provider.color, '#c96f48');

  const updateRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'OpenClaw', baseUrl: 'http://localhost:18789/v1', apiKey: '', color: '#5b6eae' })
  });
  const updateData = await updateRes.json();
  assert.equal(updateData.provider.color, '#5b6eae');
  server.close();
});

test('POST /api/providers rejects a malformed color', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'OpenClaw', baseUrl: 'http://localhost:18789/v1', apiKey: 'secret-token-9999', color: 'not-a-color' })
  });
  assert.equal(res.status, 400);
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

test('unauthenticated POST /api/providers redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'x', baseUrl: 'http://x', apiKey: 'x' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('unauthenticated POST /api/providers/:id redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/providers/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'x', baseUrl: 'http://x', apiKey: '' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('unauthenticated POST /api/providers/:id/delete redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/providers/1/delete`, {
    method: 'POST',
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('POST /api/profile updates label and avatarUrl', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Velitchko', avatarUrl: 'https://example.com/me.png' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.profile.label, 'Velitchko');
  assert.equal(data.profile.avatarUrl, 'https://example.com/me.png');
  server.close();
});

test('POST /api/profile updates cursorColor and round-trips it', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Velitchko', cursorColor: '#5b6eae' })
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.profile.cursorColor, '#5b6eae');
  server.close();
});

test('POST /api/profile rejects a malformed cursorColor', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Velitchko', cursorColor: 'not-a-color' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/profile rejects an empty label', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: '' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('unauthenticated POST /api/profile redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: 'x' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  server.close();
});

test('GET /settings renders the real user profile, not a placeholder', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Real Profile Name' })
  });
  const res = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  const body = await res.text();
  assert.match(body, /Real Profile Name/);
  server.close();
});

test('POST /api/providers/:id toggles activeInWorkspace', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Toggle Test', baseUrl: 'http://x', apiKey: 'key-zzzz' })
  });
  const { provider } = await createRes.json();
  assert.equal(provider.activeInWorkspace, false);

  const toggleRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Toggle Test', baseUrl: 'http://x', apiKey: '', activeInWorkspace: true })
  });
  const toggled = await toggleRes.json();
  assert.equal(toggled.provider.activeInWorkspace, true);
  server.close();
});

test('POST /api/providers/:id preserves activeInWorkspace when the field is omitted', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Preserve Test', baseUrl: 'http://x', apiKey: 'key-yyyy' })
  });
  const { provider } = await createRes.json();

  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Preserve Test', baseUrl: 'http://x', apiKey: '', activeInWorkspace: true })
  });

  const editRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Preserve Test Renamed', baseUrl: 'http://x', apiKey: '' })
  });
  const edited = await editRes.json();
  assert.equal(edited.provider.label, 'Preserve Test Renamed');
  assert.equal(edited.provider.activeInWorkspace, true);
  server.close();
});

test('GET /writing shows the real profile in presence, not a mock name', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  await fetch(`${base}/api/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Real Presence Name' })
  });
  const createRes = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Presence Test' })
  });
  const { project } = await createRes.json();
  const res = await fetch(`${base}/writing?project=${project.id}`, { headers: { Cookie: cookie } });
  const body = await res.text();
  assert.match(body, /Real Presence Name/);
  assert.doesNotMatch(body, /Ada Chen/);
  assert.doesNotMatch(body, /Milo Reyes/);
  server.close();
});

test('GET /writing only shows providers marked active in the workspace', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Active Provider Test' })
  });
  const { project } = await createProject.json();
  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Presence Provider', baseUrl: 'http://x', apiKey: 'key-xxxx' })
  });
  const { provider } = await createProvider.json();

  const beforeToggle = await fetch(`${base}/writing?project=${project.id}`, { headers: { Cookie: cookie } });
  assert.doesNotMatch(await beforeToggle.text(), /Presence Provider/);

  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Presence Provider', baseUrl: 'http://x', apiKey: '', activeInWorkspace: true })
  });

  const afterToggle = await fetch(`${base}/writing?project=${project.id}`, { headers: { Cookie: cookie } });
  assert.match(await afterToggle.text(), /Presence Provider/);
  server.close();
});

test('GET /api/chat/:fileId/messages returns an empty list for a file with no history', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Empty Project' })
  });
  const { file } = await createProject.json();
  const res = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.messages, []);
  server.close();
});

test('POST /api/chat/:fileId/messages persists the user message and the streamed assistant reply', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Reply Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Fake Provider', baseUrl: 'http://fake', apiKey: 'key-zzzz' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Fake Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  app.locals.chatCompletionService = {
    complete: async ({ onDelta }) => {
      onDelta('Hel');
      onDelta('lo');
      return 'Hello';
    }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Hi there' })
  });
  const body = await res.text();
  assert.match(body, /"type":"delta","text":"Hel"/);
  assert.match(body, /"type":"delta","text":"lo"/);
  assert.match(body, /"type":"done"/);

  const historyRes = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const { messages } = await historyRes.json();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Hi there');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Hello');
  assert.equal(messages[1].providerLabel, 'Fake Provider');
  server.close();
});

test('POST /api/chat/:fileId/messages persists a role:"error" message when the provider call fails', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Error Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Failing Provider', baseUrl: 'http://fake', apiKey: 'key-yyyy' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Failing Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  app.locals.chatCompletionService = {
    complete: async () => { throw new Error('simulated failure'); }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Break please' })
  });
  const body = await res.text();
  assert.match(body, /"type":"error"/);
  assert.match(body, /simulated failure/);

  const historyRes = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const { messages } = await historyRes.json();
  assert.equal(messages[1].role, 'error');
  server.close();
});

test('POST /api/chat/:fileId/messages survives a synchronous non-Error throw from the completion service without crashing the process', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Non-Error Throw Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Non-Error Provider', baseUrl: 'http://fake', apiKey: 'key-vvvv' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Non-Error Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  // Synchronous throw of a plain string (not an Error instance). Inside an
  // async handler this becomes a rejected promise either way, but it
  // exercises the `err.message` guard added to the fix (a non-Error value
  // has no .message) and, combined with the follow-up request below,
  // proves the process is still alive and serving requests afterward.
  app.locals.chatCompletionService = {
    complete: () => { throw 'boom, not an Error instance'; }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Trigger a weird throw' })
  });
  const body = await res.text();
  assert.match(body, /"type":"error"/);
  assert.match(body, /boom, not an Error instance/);

  const historyRes = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const { messages } = await historyRes.json();
  assert.equal(messages[1].role, 'error');

  // Prove the server process is still alive and responsive after the throw,
  // rather than having crashed on an unhandled rejection.
  const followUp = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(followUp.status, 200);

  server.close();
});

test('POST /api/chat/:fileId/messages rejects a provider that is not active in the workspace', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Inactive Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Inactive Provider', baseUrl: 'http://fake', apiKey: 'key-wwww' })
  });
  const { provider } = await createProvider.json();

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Should fail' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('POST /api/chat/:fileId/messages sets X-Accel-Buffering: no so a proxying nginx does not buffer the stream', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Buffering Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Buffering Provider', baseUrl: 'http://fake', apiKey: 'key-bbbb' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Buffering Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  app.locals.chatCompletionService = {
    complete: async ({ onDelta }) => {
      onDelta('Hi');
      return 'Hi';
    }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Ping' })
  });
  await res.text();
  assert.equal(res.headers.get('x-accel-buffering'), 'no');
  server.close();
});

test('POST /api/chat/:fileId/messages caps the history sent to the completion service to the last 40 prior messages', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat History Cap Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'History Cap Provider', baseUrl: 'http://fake', apiKey: 'key-cccc' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'History Cap Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  // Build up 41 rounds of (user message, assistant reply) — 82 persisted
  // messages — well past the 40-message cap, before sending the request
  // whose history we actually inspect below.
  const ROUNDS = 41;
  for (let i = 1; i <= ROUNDS; i++) {
    app.locals.chatCompletionService = {
      complete: async ({ onDelta }) => {
        onDelta(`Reply ${i}`);
        return `Reply ${i}`;
      }
    };
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ providerId: provider.id, message: `Msg ${i}` })
    });
    // eslint-disable-next-line no-await-in-loop
    await res.text();
  }

  let capturedHistory = null;
  app.locals.chatCompletionService = {
    complete: async ({ history, onDelta }) => {
      capturedHistory = history;
      onDelta('Final reply');
      return 'Final reply';
    }
  };

  const finalRes = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'One more message' })
  });
  await finalRes.text();

  assert.ok(capturedHistory);
  assert.equal(capturedHistory.length, 40);
  // The just-inserted user message ("One more message") must not be part of
  // history (it's passed separately as userMessage), and the oldest rounds
  // (1-21) must have been dropped by the cap, leaving round 22 onward.
  assert.equal(capturedHistory[0].content, 'Msg 22');
  assert.equal(capturedHistory[capturedHistory.length - 1].content, 'Reply 41');
  assert.ok(!capturedHistory.some((m) => m.content === 'One more message'));
  server.close();
});

test('unauthenticated GET /api/chat/:fileId/messages redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat/1/messages`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  server.close();
});

test('unauthenticated POST /api/chat/:fileId/messages redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat/1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 1, message: 'x' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  server.close();
});

test('POST /api/providers persists defaultReasoningEffort', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Effort Test', baseUrl: 'http://x', apiKey: 'key-vvvv', defaultReasoningEffort: 'medium' })
  });
  const { provider } = await res.json();
  assert.equal(provider.defaultReasoningEffort, 'medium');
  server.close();
});

test('GET /settings renders the reasoning effort field for editing', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Effort Render Test', baseUrl: 'http://x', apiKey: 'key-uuuu', defaultReasoningEffort: 'high' })
  });
  const res = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  const body = await res.text();
  assert.match(body, /data-default-reasoning-effort="high"/);
  server.close();
});

test('POST /api/providers/:id preserves defaultReasoningEffort when the field is omitted (e.g. the active-in-workspace quick-toggle)', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Toggle Preserve Test', baseUrl: 'http://x', apiKey: 'key-tttt', defaultReasoningEffort: 'medium' })
  });
  const { provider } = await createRes.json();

  // Mirrors the quick-toggle button's payload, which never sends defaultReasoningEffort.
  const toggleRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Toggle Preserve Test', baseUrl: 'http://x', apiKey: '', defaultModel: '', avatarUrl: '', activeInWorkspace: true })
  });
  const toggled = await toggleRes.json();
  assert.equal(toggled.provider.defaultReasoningEffort, 'medium');
  server.close();
});
