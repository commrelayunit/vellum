const MarkdownIt = require('markdown-it');
const markdownItKatex = require('markdown-it-katex');
const taskLists = require('markdown-it-task-lists');

// This is intentionally a small, explicit preview contract: CommonMark plus
// headings/lists/emphasis/links/fenced code and GFM tables, strikethrough and
// task lists. `html: false` is a security boundary, not a presentation choice:
// source HTML is emitted as text and can never introduce executable markup.
function createPreviewRenderer() {
  return new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false
  })
    .use(taskLists, { enabled: true, label: true, labelAfter: true })
    .use(markdownItKatex);
}

const renderer = createPreviewRenderer();
function renderMarkdown(markdown) {
  return renderer.render(typeof markdown === 'string' ? markdown : '');
}

module.exports = { createPreviewRenderer, renderMarkdown };
