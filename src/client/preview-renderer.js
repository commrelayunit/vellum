import 'katex/dist/katex.min.css';
const { renderMarkdown } = require('./preview-renderer-core');

// main.js stays deliberately dependency-free; this bundled entry owns the
// rendering dependency graph and exposes just the safe rendering function.
window.__vellumRenderMarkdown = renderMarkdown;
