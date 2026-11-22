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
  // GFM task-list syntax (what markdown-it-task-lists above renders) only
  // ever matches `[ ]`/`[x]` at the very start of a LIST item - that's the
  // spec, not a bug in that plugin, and no markdown-it/CommonMark/GFM
  // library renders a checkbox for the same marker sitting inside a TABLE
  // cell instead. This is the custom rule that covers that case, applying
  // the identical "must be the very first thing in the cell" convention and
  // the same checkbox markup, by hand - there is no off-the-shelf plugin for
  // it (checked; every markdown-it task-list plugin targets list items
  // only). Must run after "inline" (so table cells already have their
  // `.children` inline token trees) - order relative to "github-task-lists"
  // doesn't matter, since the two rules touch disjoint token types
  // (td_open/th_open here vs. list_item_open there).
  md.core.ruler.after('inline', 'vellum-table-checkboxes', (state) => {
    const tokens = state.tokens;
    let rowLine = null;
    let occurrence = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.type === 'tr_open') {
        // One markdown source line per GFM table row, so the row's own
        // start line (still on the untouched tr_open token - this rule
        // never replaces it) is exactly the line every checkbox in this
        // row needs for the client to later locate and flip.
        rowLine = token.map ? token.map[0] : null;
        occurrence = 0;
        continue;
      }
      if (token.type !== 'inline') continue;
      const cell = tokens[i - 1];
      if (!cell || (cell.type !== 'td_open' && cell.type !== 'th_open') || rowLine == null) continue;
      const match = /^\[([ xX])\]\s*/.exec(token.content);
      if (!match) continue;
      const checkbox = new state.Token('html_inline', '', 0);
      checkbox.content = `<input class="task-list-item-checkbox"${match[1] === ' ' ? '' : ' checked=""'} type="checkbox">`;
      token.children.unshift(checkbox);
      // Strip the leading "[ ] "/"[x] " marker from both the cell's raw
      // content and its first real text child (now children[1] - the
      // checkbox token above just became children[0]), mirroring
      // markdown-it-task-lists' own todoify().
      if (token.children[1] && typeof token.children[1].content === 'string') {
        token.children[1].content = token.children[1].content.slice(match[0].length);
      }
      token.content = token.content.slice(match[0].length);
      // On the containing <td>/<th>, not the checkbox itself: data-line is
      // the row's 0-based source line (shared by every checkbox in the
      // row), data-occurrence is this checkbox's left-to-right position
      // among checkboxes on that one line (0-based) - together, exactly
      // enough for the client to re-locate this specific `[ ]`/`[x]` in the
      // raw source line without needing to replicate markdown-it's own
      // pipe-escaping-aware cell-splitting.
      cell.attrSet('data-line', String(rowLine));
      cell.attrSet('data-occurrence', String(occurrence));
      occurrence++;
    }
  });
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
