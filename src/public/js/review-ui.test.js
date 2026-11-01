const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
test('review UI has peer tab, a persistent revise context card, and non-2xx handling', () => {
  assert.match(source, /setPanel\('review'\)/);
  assert.match(source, /showReviseContext\(p\)/);
  assert.match(source, /reviseOf: reviseOfForSend/);
  assert.match(source, /!response\.ok \|\| !result\.success/);
  assert.match(source, /stale.*conflict/);
  assert.match(source, /__vellumSetProposalMarkers/);
});

test('review UI no longer offers a live-edit opt-in - agent edits always go through proposals', () => {
  assert.doesNotMatch(source, /live-edit-opt-in/);
  assert.doesNotMatch(source, /editMode/);
});
