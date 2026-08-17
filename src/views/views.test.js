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
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' }
  });
  assert.match(html, /<textarea[^>]*>#\sHello<\/textarea>/);
});
