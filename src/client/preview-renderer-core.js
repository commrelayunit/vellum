const MarkdownIt = require('markdown-it');
const markdownItKatex = require('markdown-it-katex');
const taskLists = require('markdown-it-task-lists');

// This is intentionally a small, explicit preview contract: CommonMark plus
// headings/lists/emphasis/links/fenced code and GFM tables, strikethrough and
// task lists. `html: false` is a security boundary, not a presentation choice:
// source HTML is emitted as text and can never introduce executable markup.
function createPreviewRenderer() {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false
  })
    .use(taskLists, { enabled: true, label: true, labelAfter: true })
    .use(markdownItKatex);
  // Stamps each task-list <li> with its 0-based source line (still
  // available on the untouched list_item_open token's own .map - the
  // task-lists rule above only ever sets attrs on it, never replaces it) so
  // the client can click a checkbox and find exactly which markdown line to
  // flip `[ ]`/`[x]` on, without a fragile text search. Run AFTER
  // "github-task-lists" by name (not just "after inline") so the
  // task-list-item class it sets is already there to detect, regardless of
  // how many other "after inline" rules exist.
  md.core.ruler.after('github-task-lists', 'vellum-task-list-lines', (state) => {
    state.tokens.forEach((token) => {
      if (token.type === 'list_item_open' && token.map && /task-list-item/.test(token.attrGet('class') || '')) {
        token.attrSet('data-line', String(token.map[0]));
      }
    });
  });
  return md;
}

const renderer = createPreviewRenderer();
function renderMarkdown(markdown) {
  return renderer.render(typeof markdown === 'string' ? markdown : '');
}

module.exports = { createPreviewRenderer, renderMarkdown };
