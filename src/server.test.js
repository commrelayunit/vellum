// src/server.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

const app = require('./server');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /projects renders the (empty) projects list', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/projects`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Projects/);
  server.close();
});

test('POST /api/projects creates a project with a default file', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  ' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('GET /writing renders the project\'s first file by default', async () => {
  const server = await listen();
  const { port } = server.address();

  const createRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Writing Test Project' })
  });
  const { project } = await createRes.json();

  const res = await fetch(`http://127.0.0.1:${port}/writing?project=${project.id}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Untitled\.md/);
  server.close();
});

test('GET /writing 404s for an unknown project', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/writing?project=999999`);
  assert.equal(res.status, 404);
  server.close();
});

test('POST /api/save-file/:fileId persists content', async () => {
  const server = await listen();
  const { port } = server.address();

  const createRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Save Test Project' })
  });
  const { project, file } = await createRes.json();

  const saveRes = await fetch(`http://127.0.0.1:${port}/api/save-file/${file.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'updated body' })
  });
  assert.equal(saveRes.status, 200);
  assert.equal((await saveRes.json()).success, true);

  const writingRes = await fetch(`http://127.0.0.1:${port}/writing?project=${project.id}&file=${file.id}`);
  const body = await writingRes.text();
  assert.match(body, /updated body/);
  server.close();
});
