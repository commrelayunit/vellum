// src/public/js/provider-icons.test.js
//
// main.js is plain browser script (no module system, references `document`
// at load time) and this project has no DOM-testing dependency (jsdom etc.)
// installed, so it can't be `require()`d directly in a Node test. Instead,
// this test extracts the actual KNOWN_PROVIDER_ICONS array literal straight
// out of the real main.js source and exercises the same `.find()` lookup
// the browser code uses, so a regression (e.g. someone re-ordering the
// array and reintroducing the "ollama" vs "meta|llama" bug) is caught here
// rather than only in a running browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function loadKnownProviderIcons() {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const match = source.match(/const KNOWN_PROVIDER_ICONS = (\[[\s\S]*?\n\s*\]);/);
  assert.ok(match, 'expected to find a KNOWN_PROVIDER_ICONS array literal in main.js');
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source array literal
  return new Function(`return ${match[1]};`)();
}

function resolveSlug(label) {
  const icons = loadKnownProviderIcons();
  const known = icons.find((entry) => entry.pattern.test(label));
  return known ? known.slug : undefined;
}

test('Ollama labels resolve to the ollama icon slug, not meta', () => {
  assert.equal(resolveSlug('Ollama'), 'ollama');
  assert.equal(resolveSlug('ollama local'), 'ollama');
  assert.equal(resolveSlug('Ollama – laptop'), 'ollama');
});

test('Meta/Llama labels that are not Ollama still resolve to the meta icon slug', () => {
  assert.equal(resolveSlug('Llama 3'), 'meta');
  assert.equal(resolveSlug('Meta AI'), 'meta');
});
