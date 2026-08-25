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
        recentFiles: [{ id: 10, path: 'README.md' }, { id: 11, path: 'Draft.md' }],
        remainingFiles: []
      }
    ]
  });
  assert.match(html, /Sample Project/);
  assert.match(html, /README\.md/);
  assert.match(html, /href="\/writing\?project=1&file=10"/);
  assert.match(html, /class="file-delete-btn" data-file-id="10"/);
  assert.doesNotMatch(html, /block\(/);
});

test('projects.ejs shows an expand toggle and a hidden all-files list when a project has more than 3 files', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'projects.ejs'), {
    projects: [
      {
        id: 1,
        name: 'Big Project',
        description: '',
        fileCount: 5,
        updatedAt: new Date().toISOString(),
        recentFiles: [{ id: 10, path: 'README.md' }, { id: 11, path: 'Draft.md' }, { id: 12, path: 'Notes.md' }],
        remainingFiles: [{ id: 13, path: 'Fourth.md' }, { id: 14, path: 'Fifth.md' }]
      }
    ]
  });
  assert.match(html, /class="project-expand-files-btn"/);
  assert.match(html, /2 more files/);
  assert.match(html, /href="\/writing\?project=1&file=13"/);
  assert.match(html, /Fourth\.md/);
  // The expanded list must never carry a delete button - only the writing
  // view is allowed to delete a file, per the approved design.
  assert.doesNotMatch(html, /Fourth\.md[\s\S]*?file-delete-btn/);
});

test('projects.ejs hides the expand toggle when a project has 3 or fewer files', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'projects.ejs'), {
    projects: [
      {
        id: 1,
        name: 'Small Project',
        description: '',
        fileCount: 1,
        updatedAt: new Date().toISOString(),
        recentFiles: [{ id: 10, path: 'README.md' }],
        remainingFiles: []
      }
    ]
  });
  assert.doesNotMatch(html, /project-expand-files-btn/);
});

test('projects.ejs renders a project card with rename data attributes and an edit button', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'projects.ejs'), {
    projects: [
      {
        id: 1,
        name: 'Sample Project',
        description: 'demo',
        fileCount: 2,
        updatedAt: new Date().toISOString(),
        recentFiles: [],
        remainingFiles: []
      }
    ]
  });
  assert.match(html, /data-project-id="1"[^>]*data-name="Sample Project"[^>]*data-description="demo"/);
  assert.match(html, /class="btn project-edit-btn"/);
  assert.match(html, /class="btn project-delete-btn"/);
});

test('writing.ejs renders file content with no stray whitespace', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /<div id="markdown-editor" class="editor-textarea" data-file-id="1" data-profile-label="Test Person" data-profile-cursor-color="" data-show-line-numbers="false"><\/div>/);
  assert.match(html, /<script id="editor-initial-content" type="application\/json">"# Hello"<\/script>/);
});

test('writing.ejs passes the profile cursorColor through to the editor mount point', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null, cursorColor: '#5b6eae' },
    activeProviders: []
  });
  assert.match(html, /data-profile-cursor-color="#5b6eae"/);
});

test('writing.ejs passes the profile showLineNumbers preference through to the editor mount point', async () => {
  const withLineNumbers = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null, showLineNumbers: true },
    activeProviders: []
  });
  assert.match(withLineNumbers, /data-show-line-numbers="true"/);

  const withoutLineNumbers = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null, showLineNumbers: false },
    activeProviders: []
  });
  assert.match(withoutLineNumbers, /data-show-line-numbers="false"/);
});

test('writing.ejs renders presence avatars with data-color from profile and provider color', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Real User', avatarUrl: null, cursorColor: '#5b6eae' },
    activeProviders: [{ id: 1, label: 'Active Agent', avatarUrl: null, color: '#c96f48' }]
  });
  assert.match(html, /data-label="Real User"[^>]*data-color="#5b6eae"/);
  assert.match(html, /data-label="Active Agent"[^>]*data-color="#c96f48"/);
});

test('writing.ejs renders a clear-chat button', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /id="clear-chat-btn"/);
});

test('writing.ejs renders a pending-references container above the chat input', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /id="chat-pending-references"/);
});

test('writing.ejs renders a tool-status element in the chat panel', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /id="chat-tool-status"/);
});

test('writing.ejs renders real presence data, not a hardcoded mock', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
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
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Solo User', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /Solo User/);
});

test('writing.ejs renders a provider selector when providers are active', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
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
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Solo User', avatarUrl: null },
    activeProviders: []
  });
  assert.doesNotMatch(html, /id="chat-provider-select"/);
  assert.match(html, /id="chat-input"[^>]*disabled/);
  assert.match(html, /id="send-chat-btn"[^>]*disabled/);
});

test('writing.ejs renders a file-select option for each project file, with the current file marked selected', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 2, path: 'Draft.md', title: 'Draft', content: '# Hello' },
    files: [
      { id: 1, path: 'README.md', title: 'README' },
      { id: 2, path: 'Draft.md', title: 'Draft' }
    ],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /<option value="1"\s*>README<\/option>/);
  assert.match(html, /<option value="2" selected>Draft<\/option>/);
  assert.match(html, /data-file-title="Draft"/);
});

test('writing.ejs hides the delete-file button when the project has only one file', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [{ id: 1, path: 'README.md', title: 'README' }],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.doesNotMatch(html, /id="delete-file-btn"/);
  assert.match(html, /id="new-file-btn"/);
  assert.match(html, /id="rename-file-btn"/);
});

test('writing.ejs shows the delete-file button when the project has more than one file', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    files: [
      { id: 1, path: 'README.md', title: 'README' },
      { id: 2, path: 'Draft.md', title: 'Draft' }
    ],
    profile: { label: 'Test Person', avatarUrl: null },
    activeProviders: []
  });
  assert.match(html, /id="delete-file-btn"/);
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

test('settings.ejs renders the profile and provider color as data attributes', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [{ id: 1, label: 'Test', baseUrl: 'http://x', maskedKey: '•••• aaaa', defaultModel: null, avatarUrl: null, activeInWorkspace: false, defaultReasoningEffort: null, color: '#c96f48' }],
    profile: { label: 'Test Person', avatarUrl: null, cursorColor: '#5b6eae' }
  });
  assert.match(html, /id="profile-card"[^>]*data-cursor-color="#5b6eae"/);
  assert.match(html, /data-provider-id="1"[^>]*data-color="#c96f48"/);
});

test('settings.ejs renders the profile showLineNumbers preference as a data attribute', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [],
    profile: { label: 'Test Person', avatarUrl: null, showLineNumbers: true }
  });
  assert.match(html, /id="profile-card"[^>]*data-show-line-numbers="true"/);
});
