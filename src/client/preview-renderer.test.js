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
