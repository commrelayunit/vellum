const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('./preview-renderer-core');

test('preview supports documented CommonMark/GFM structures', () => {
  const html = renderMarkdown('# Heading\n\n- *one*\n- **two**\n\n```js\nconst x = 1;\n```\n\n[link](https://example.test)\n\n- [x] done\n- [ ] next\n\n~~old~~\n\n| A | B |\n| - | - |\n| 1 | 2 |');
  for (const expected of ['<h1>Heading</h1>', '<ul>', '<em>one</em>', '<strong>two</strong>', '<code class="language-js">', 'href="https://example.test"', 'task-list-item', '<s>old</s>', '<table>']) assert.match(html, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('preview typesets inline and display LaTeX math', () => {
  const html = renderMarkdown('Inline $x^2$\n\n$$\\int_0^1 x dx$$');
  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
});

test('preview renders hostile raw HTML as inert text', () => {
  const html = renderMarkdown('<script>alert(1)<\/script><img src=x onerror=alert(1)>');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script|<img/);
});

test('preview stamps each task-list item with its 0-based source line, and only task items', () => {
  const html = renderMarkdown('intro\n\n- [ ] todo one\n- [x] done two\n- not a task\n- [ ] todo three\n');
  assert.match(html, /<li class="task-list-item enabled" data-line="2">/);
  assert.match(html, /<li class="task-list-item enabled" data-line="3">/);
  assert.match(html, /<li class="task-list-item enabled" data-line="5">/);
  assert.match(html, /<li>not a task<\/li>/);
});

test('preview renders a real checkbox for `[ ]`/`[x]` at the start of a table cell, not literal brackets', () => {
  const html = renderMarkdown('| SSL/TLS | Hardened | URL |\n| - | - | - |\n| [ ] | [x] | https://example.test |\n');
  assert.match(html, /<td data-line="2" data-occurrence="0"><input class="task-list-item-checkbox" type="checkbox"><\/td>/);
  assert.match(html, /<td data-line="2" data-occurrence="1"><input class="task-list-item-checkbox" checked="" type="checkbox"><\/td>/);
  assert.doesNotMatch(html, /\[ \]|\[x\]/);
});

test('preview leaves a table cell alone when the checkbox marker is not the very first thing in it', () => {
  const html = renderMarkdown('| Note |\n| - |\n| see [ ] below |\n');
  assert.match(html, /<td>see \[ \] below<\/td>/);
  assert.doesNotMatch(html, /task-list-item-checkbox/);
});
