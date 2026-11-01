const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
test('review UI has peer tab, revise-to-chat context, and non-2xx handling', () => {
  assert.match(source, /setPanel\('review'\)/);
  assert.match(source, /Please revise this proposal:/);
  assert.match(source, /!response\.ok \|\| !result\.success/);
  assert.match(source, /stale.*conflict/);
  assert.match(source, /__vellumSetProposalMarkers/);
});
