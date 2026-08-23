// src/public/js/avatar-color.test.js
//
// main.js is plain browser script (no module system, references `document`
// at load time) and this project has no DOM-testing dependency (jsdom etc.)
// installed, so - exactly as provider-icons.test.js does - this test
// extracts the real color-selection ternary straight out of main.js and
// exercises it directly, so a regression (e.g. a custom color silently
// losing priority to the hash-derived fallback) is caught here rather than
// only in a running browser.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function loadColorTernary() {
  const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  const match = source.match(/const color = (customColor[\s\S]*?);\n/);
  assert.ok(match, 'expected a `const color = customColor ? ... : ...` ternary in renderInitialsFallback');
  return match[1];
}

function resolveColor({ customColor, isOwnProfile, label }) {
  const AVATAR_COLORS = ['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'];
  function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }
  // eslint-disable-next-line no-new-func -- deliberately eval'ing the real source ternary
  const evaluate = new Function('customColor', 'isOwnProfile', 'label', 'AVATAR_COLORS', 'hashString', `return (${loadColorTernary()});`);
  return evaluate(customColor, isOwnProfile, label, AVATAR_COLORS, hashString);
}

test('a custom color always wins, for both the own profile and other providers', () => {
  assert.equal(resolveColor({ customColor: '#5b6eae', isOwnProfile: true, label: 'You' }), '#5b6eae');
  assert.equal(resolveColor({ customColor: '#c96f48', isOwnProfile: false, label: 'OpenClaw' }), '#c96f48');
});

test('the own profile falls back to AVATAR_COLORS[0] when no custom color is set', () => {
  assert.equal(resolveColor({ customColor: '', isOwnProfile: true, label: 'You' }), 'var(--presence-you)');
});

test('other providers fall back to a hash-derived color when no custom color is set', () => {
  const color = resolveColor({ customColor: '', isOwnProfile: false, label: 'OpenClaw' });
  assert.ok(['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'].includes(color));
});
