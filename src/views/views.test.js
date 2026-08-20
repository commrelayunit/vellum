const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

test('projects.ejs renders a project card with file details', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'projects.ejs'), {
    projects: [
      {
        id: 1,
        name: 'Sample Project',
        description: 'demo',
        fileCount: 2,
        updatedAt: new Date().toISOString(),
        recentFiles: ['README.md', 'Draft.md']
      }
    ]
  });
  assert.match(html, /Sample Project/);
  assert.match(html, /README\.md/);
  assert.doesNotMatch(html, /block\(/);
});

test('writing.ejs renders file content with no stray whitespace', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /<textarea[^>]*>#\sHello<\/textarea>/);
});

test('writing.ejs renders real presence data, not a hardcoded mock', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Real User', avatarUrl: null },
    activeProviders: [{ id: 1, label: 'Active Agent', avatarUrl: null }]
  });
  assert.match(html, /Real User/);
  assert.match(html, /Active Agent/);
  assert.doesNotMatch(html, /cursor-demo/);
});

test('writing.ejs renders with an empty activeProviders list', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Solo User', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /Solo User/);
});

test('writing.ejs renders a provider selector when providers are active', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Real User', avatarUrl: null },
    activeProviders: [{ id: 7, label: 'Active Agent', avatarUrl: null }]
  });
  assert.match(html, /id="chat-provider-select"/);
  assert.match(html, /<option value="7">Active Agent<\/option>/);
  assert.doesNotMatch(html, /id="chat-input"[^>]*disabled/);
});

test('writing.ejs disables chat input when no providers are active', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Solo User', avatarUrl: null },
    activeProviders: []
  });
  assert.doesNotMatch(html, /id="chat-provider-select"/);
  assert.match(html, /id="chat-input"[^>]*disabled/);
  assert.match(html, /id="send-chat-btn"[^>]*disabled/);
});

test('settings.ejs renders a provider card with masked key and no plaintext', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [
      {
        id: 1,
        label: 'OpenClaw – home',
        baseUrl: 'http://localhost:18789/v1',
        maskedKey: '•••• 9999',
        defaultModel: 'claude-sonnet-4-5',
        avatarUrl: null
      }
    ],
    profile: { label: 'Test Person', avatarUrl: null }
  });
  assert.match(html, /OpenClaw – home/);
  assert.match(html, /•••• 9999/);
  assert.doesNotMatch(html, /block\(/);
});

test('settings.ejs renders the user profile card', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [],
    profile: { label: 'Test Person', avatarUrl: null }
  });
  assert.match(html, /Test Person/);
  assert.match(html, /data-skip-brand-lookup="true"/);
});

test('settings.ejs renders a provider card with its reasoning effort data attribute', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [{ id: 1, label: 'Test', baseUrl: 'http://x', maskedKey: '•••• aaaa', defaultModel: null, avatarUrl: null, activeInWorkspace: false, defaultReasoningEffort: 'low' }],
    profile: { label: 'Test Person', avatarUrl: null }
  });
  assert.match(html, /data-default-reasoning-effort="low"/);
});
