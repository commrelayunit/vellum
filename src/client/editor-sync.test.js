// src/client/editor-sync.test.js
//
// editor-sync.js is a browser-only ESM entry point: it touches `document`,
// `window` and `WebSocket` at module load and builds a live CodeMirror
// EditorView. This project has no DOM-testing dependency (jsdom etc.)
// installed, so - exactly as src/public/js/provider-icons.test.js does for
// main.js - these tests assert against the real source text rather than
// executing it. They are deliberately structural: they pin the two
// properties whose violation causes silent, invisible data loss / breakage
// in a browser, where no test would otherwise catch them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SOURCE_PATH = path.join(__dirname, 'editor-sync.js');

function loadSource() {
  return fs.readFileSync(SOURCE_PATH, 'utf8');
}

// Returns the source text of the callback body passed to
// socket.addEventListener('open', ...), found by brace matching from the
// opening `{` of the arrow function.
function extractOpenHandlerBody(source) {
  const marker = "socket.addEventListener('open'";
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, "expected an socket.addEventListener('open', ...) registration");
  const bodyStart = source.indexOf('{', markerIndex);
  assert.notEqual(bodyStart, -1, "expected a block body for the 'open' handler");
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  assert.fail("could not find the end of the 'open' handler body");
}

// Returns the source text of a top-level `function <name>(...) { ... }`
// declaration, found by brace matching from its opening `{`.
function extractFunctionSource(source, functionName) {
  const marker = `function ${functionName}(`;
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `expected a function named ${functionName}`);
  const bodyStart = source.indexOf('{', markerIndex);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(markerIndex, i + 1);
    }
  }
  assert.fail(`could not find the end of ${functionName}`);
}

test("the ydoc 'update' listener is registered unconditionally, not inside the WebSocket 'open' handler", () => {
  const source = loadSource();
  const openBody = extractOpenHandlerBody(source);

  // The regression this guards: when this listener lived inside the 'open'
  // callback, a WebSocket that never connected (e.g. a reverse proxy not
  // forwarding the Upgrade header) meant the listener was never registered
  // at all, so local edits dispatched no 'vellum:editor-changed' event and
  // main.js's fallback POST /api/save-file/:fileId never ran - every edit
  // silently lost.
  assert.ok(
    !openBody.includes("ydoc.on('update'"),
    "ydoc.on('update', ...) must NOT be registered inside the 'open' handler - " +
      'if the socket never opens, the fallback-save path is never wired up'
  );

  const updateIndex = source.indexOf("ydoc.on('update'");
  assert.notEqual(updateIndex, -1, "expected a ydoc.on('update', ...) registration");
  assert.ok(
    updateIndex < source.indexOf("socket.addEventListener('open'"),
    "expected ydoc.on('update', ...) to be registered before (and outside) the 'open' handler"
  );
});

test("the 'vellum:editor-changed' fallback-save event is dispatched from outside the 'open' handler", () => {
  const source = loadSource();
  const openBody = extractOpenHandlerBody(source);

  assert.ok(
    source.includes("vellum:editor-changed"),
    "expected editor-sync.js to dispatch the 'vellum:editor-changed' event main.js listens for"
  );
  assert.ok(
    !openBody.includes("vellum:editor-changed"),
    "the 'vellum:editor-changed' dispatch must not be confined to the 'open' handler"
  );
});

test("the ydoc 'update' listener still skips updates that originated from the socket", () => {
  const source = loadSource();
  const updateIndex = source.indexOf("ydoc.on('update'");
  const body = source.slice(updateIndex, source.indexOf("socket.addEventListener('open'"));

  // Without this guard, applying a remote peer's update locally would echo
  // it straight back to the server AND fire a fallback save on every
  // keystroke anyone else types.
  assert.match(
    body,
    /if \(origin === socket\) return;/,
    "expected the remote-origin guard to survive moving the listener out of the 'open' handler"
  );
  // The send is the only part that legitimately depends on the socket being
  // connected, so it must be the only part that is gated on readyState.
  assert.match(
    body,
    /socket\.readyState === WebSocket\.OPEN/,
    'expected the socket.send() to be gated on the socket actually being OPEN'
  );
});

test('the local awareness user state provides colorLight, not just color', () => {
  const source = loadSource();
  const match = source.match(/awareness\.setLocalStateField\('user',\s*(\{[\s\S]*?\n\s*\})\);/);
  assert.ok(match, "expected an awareness.setLocalStateField('user', {...}) call");

  // Evaluate the real object literal from the source, supplying the
  // identifier it closes over.
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source object literal
  const build = new Function('profileLabel', 'localColor', `return (${match[1]});`);
  const userState = build('Tester', 'var(--presence-you)');

  assert.equal(typeof userState.name, 'string');
  assert.equal(typeof userState.color, 'string');
  // y-codemirror.next's y-remote-selections.js reads state.user.colorLight
  // for the translucent selection-range background and falls back to
  // `color + '33'` when it is missing. Because `color` here can be a CSS
  // custom-property reference rather than a literal hex, that fallback
  // could produce the unparseable `var(--presence-you)33` and the remote
  // selection highlight vanishes entirely.
  assert.equal(
    typeof userState.colorLight,
    'string',
    'expected user.colorLight to be set explicitly - y-codemirror.next would otherwise derive an ' +
      'invalid CSS value by concatenating "33" onto a var() reference'
  );
  assert.doesNotMatch(
    userState.colorLight,
    /^var\(/,
    'colorLight must be a usable color value, not a bare var() reference that could be concatenated onto'
  );
  assert.match(userState.colorLight, /^color-mix\(in srgb, var\(--presence-you\) \d+%, transparent\)$/);
});

test('the local cursor color prefers the profile\'s stored cursorColor over the default palette', () => {
  const source = loadSource();
  const match = source.match(/const localColor = ([^\n;]+);/);
  assert.ok(match, 'expected a `const localColor = ...` assignment reading the profile cursor color with a fallback');
  assert.match(
    match[1],
    /container\.dataset\.profileCursorColor/,
    'localColor should be derived from container.dataset.profileCursorColor'
  );
  assert.match(
    match[1],
    /AVATAR_COLORS\[0\]/,
    'localColor should fall back to AVATAR_COLORS[0] when no custom color is stored'
  );
});

test('buildTheme is called with the same localColor used for the local awareness state', () => {
  const source = loadSource();
  assert.match(
    source,
    /buildTheme\(localColor,\s*showLineNumbers\)/,
    'expected buildTheme to receive localColor and showLineNumbers'
  );
});

test('the local text selection is themed with the same localColor via drawSelection/.cm-selectionBackground', () => {
  const source = loadSource();
  assert.match(source, /drawSelection\(\)/, 'expected the drawSelection() extension so the local selection can be themed');
  assert.match(
    source,
    /'\.cm-selectionBackground':\s*\{[^}]*localColor/,
    'expected .cm-selectionBackground to be themed using localColor, not left as the browser default'
  );
});

test('line numbers are included only when the profile preference is enabled', () => {
  const source = loadSource();
  const match = source.match(/const showLineNumbers = ([^\n;]+);/);
  assert.ok(match, 'expected a `const showLineNumbers = ...` assignment reading the profile preference');
  assert.match(
    match[1],
    /container\.dataset\.showLineNumbers === 'true'/,
    'showLineNumbers should be derived from container.dataset.showLineNumbers'
  );
  assert.match(
    source,
    /showLineNumbers\s*\?\s*\[lineNumbers\(\)\]\s*:\s*\[\]/,
    'expected the lineNumbers() extension to be conditionally included based on showLineNumbers'
  );
});

test('buildSelectionReference captures quoted text, line range, and Yjs relative positions', () => {
  const Y = require('yjs');
  const { EditorState } = require('@codemirror/state');
  const source = loadSource();
  const fnSource = extractFunctionSource(source, 'buildSelectionReference');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source function
  const buildSelectionReference = new Function('Y', `return (${fnSource});`)(Y);

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'Hello\nworld\nagain');
  const state = EditorState.create({ doc: ytext.toString() });

  const ref = buildSelectionReference(state, ytext, 0, 11);
  assert.equal(ref.quotedText, 'Hello\nworld');
  assert.equal(ref.startLine, 1);
  assert.equal(ref.endLine, 2);
  assert.ok(ref.anchor);
  assert.ok(ref.head);

  const resolved = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(ref.anchor), ydoc);
  assert.equal(resolved.index, 0);
});

test('resolveJumpTarget resolves a valid selection to its current absolute offsets, accounting for edits since', () => {
  const Y = require('yjs');
  const source = loadSource();
  const fnSource = extractFunctionSource(source, 'resolveJumpTarget');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source function
  const resolveJumpTarget = new Function('Y', `return (${fnSource});`)(Y);

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'Hello world');
  const anchorJSON = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, 6));
  const headJSON = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, 11));

  // A real concurrent edit before the referenced range - relative positions
  // exist precisely to survive this.
  ytext.insert(0, 'Prefix: ');

  assert.deepEqual(resolveJumpTarget(ydoc, ytext, anchorJSON, headJSON), { from: 14, to: 19 });
});

test('resolveJumpTarget returns null when resolved against an unrelated document lineage', () => {
  const Y = require('yjs');
  const source = loadSource();
  const fnSource = extractFunctionSource(source, 'resolveJumpTarget');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source function
  const resolveJumpTarget = new Function('Y', `return (${fnSource});`)(Y);

  const ydocA = new Y.Doc();
  const ytextA = ydocA.getText('content');
  ytextA.insert(0, 'Hello world');
  const anchorJSON = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytextA, 0));
  const headJSON = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytextA, 5));

  const ydocB = new Y.Doc();
  const ytextB = ydocB.getText('content');
  ytextB.insert(0, 'Unrelated content');

  assert.equal(resolveJumpTarget(ydocB, ytextB, anchorJSON, headJSON), null);
});

test('buildSelectionReference pins a selection ending at the document end so later typing is not absorbed', () => {
  const Y = require('yjs');
  const { EditorState } = require('@codemirror/state');
  const source = loadSource();
  const buildFnSource = extractFunctionSource(source, 'buildSelectionReference');
  const resolveFnSource = extractFunctionSource(source, 'resolveJumpTarget');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source functions
  const buildSelectionReference = new Function('Y', `return (${buildFnSource});`)(Y);
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source functions
  const resolveJumpTarget = new Function('Y', `return (${resolveFnSource});`)(Y);

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'Hello world');
  const state = EditorState.create({ doc: ytext.toString() });

  // Selection ends exactly at the current end of the document - the case
  // the default (right-associated) relative position gets wrong.
  const ref = buildSelectionReference(state, ytext, 0, ytext.length);
  assert.equal(ref.quotedText, 'Hello world');

  // Something is typed at the end of the document after the reference was
  // captured.
  ytext.insert(ytext.length, ' and more');

  const resolved = resolveJumpTarget(ydoc, ytext, ref.anchor, ref.head);
  assert.deepEqual(
    resolved,
    { from: 0, to: 11 },
    'the resolved end must stay pinned to the original selection end, not grow to include text typed afterward'
  );
});

test('window.__vellumJumpToReference is exposed alongside window.__vellumEditorView', () => {
  const source = loadSource();
  assert.match(source, /window\.__vellumJumpToReference = function/);
});

function loadBuildRemoteActiveLineDecorations() {
  const Y = require('yjs');
  const { Decoration } = require('@codemirror/view');
  const source = loadSource();
  // buildDecorations is a nested function inside remoteActiveLinePlugin, but
  // extractFunctionSource does a plain text search - it finds this inner
  // function's own brace-matched body regardless of nesting. ytext/ydoc/
  // awareness are free variables inside it (closed over the real outer
  // function's parameters in the actual module); injecting them as
  // new Function() parameters reproduces that scoping for the test.
  const fnSource = extractFunctionSource(source, 'buildDecorations');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source function
  const makeBuildDecorations = new Function('Y', 'Decoration', 'ytext', 'ydoc', 'awareness',
    `return (${fnSource});`);
  return (ytext, ydoc, awareness, view) => makeBuildDecorations(Y, Decoration, ytext, ydoc, awareness)(view);
}

function fakeAwareness(localClientId, remoteStates) {
  const states = new Map(remoteStates);
  return {
    doc: { clientID: localClientId },
    getStates: () => states
  };
}

test('remote active-line decorations highlight the line under a remote peer\'s bare cursor', () => {
  const Y = require('yjs');
  const { EditorState } = require('@codemirror/state');
  const build = loadBuildRemoteActiveLineDecorations();

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'line one\nline two\nline three');
  const view = { state: EditorState.create({ doc: ytext.toString() }) };

  // Cursor at index 12 lands inside "line two" (offsets 9-17).
  const cursorPos = Y.createRelativePositionFromTypeIndex(ytext, 12);
  const awareness = fakeAwareness(1, [
    [2, { user: { color: '#c96f48', colorLight: 'color-mix(in srgb, #c96f48 20%, transparent)' }, cursor: { anchor: cursorPos, head: cursorPos } }]
  ]);

  const decorations = build(ytext, ydoc, awareness, view);
  const found = [];
  decorations.between(0, ytext.length, (from, to, value) => { found.push({ from, to, value }); });

  assert.equal(found.length, 1);
  assert.equal(found[0].from, 9, 'decoration should start at the beginning of "line two"');
  assert.match(found[0].value.spec.attributes.style, /#c96f48 20%/);
});

test('remote active-line decorations skip the local client\'s own awareness entry', () => {
  const Y = require('yjs');
  const { EditorState } = require('@codemirror/state');
  const build = loadBuildRemoteActiveLineDecorations();

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'only line');
  const view = { state: EditorState.create({ doc: ytext.toString() }) };

  const cursorPos = Y.createRelativePositionFromTypeIndex(ytext, 3);
  const awareness = fakeAwareness(1, [
    [1, { user: { color: '#2f6f64' }, cursor: { anchor: cursorPos, head: cursorPos } }]
  ]);

  const decorations = build(ytext, ydoc, awareness, view);
  const found = [];
  decorations.between(0, ytext.length, () => { found.push(1); });
  assert.equal(found.length, 0, 'the local client (id 1) must never highlight its own cursor as remote');
});

test('remote active-line decorations skip a peer with no cursor set', () => {
  const Y = require('yjs');
  const { EditorState } = require('@codemirror/state');
  const build = loadBuildRemoteActiveLineDecorations();

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('content');
  ytext.insert(0, 'only line');
  const view = { state: EditorState.create({ doc: ytext.toString() }) };

  const awareness = fakeAwareness(1, [
    [2, { user: { color: '#2f6f64' } }]
  ]);

  const decorations = build(ytext, ydoc, awareness, view);
  const found = [];
  decorations.between(0, ytext.length, () => { found.push(1); });
  assert.equal(found.length, 0);
});
