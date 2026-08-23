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

  // Evaluate the real object literal from the source, supplying the two
  // identifiers it closes over.
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source object literal
  const build = new Function('AVATAR_COLORS', 'profileLabel', `return (${match[1]});`);
  const userState = build(['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'], 'Tester');

  assert.equal(typeof userState.name, 'string');
  assert.equal(typeof userState.color, 'string');
  // y-codemirror.next's y-remote-selections.js reads state.user.colorLight
  // for the translucent selection-range background and falls back to
  // `color + '33'` when it is missing. Because `color` here is a CSS
  // custom-property reference rather than a literal hex, that fallback
  // produces the unparseable `var(--presence-you)33` and the remote
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
