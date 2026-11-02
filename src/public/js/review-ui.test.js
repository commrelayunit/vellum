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

test('review UI groups Pending and Accepted independently, with Pending expanded initially', () => {
  assert.match(source, /const reviewSectionsExpanded = \{ pending: true, accepted: false \};/);
  assert.match(source, /reviewSection\('Pending', 'pending', proposals\.filter\(p => p\.state === 'pending'\)\)/);
  assert.match(source, /reviewSection\('Accepted', 'accepted', proposals\.filter\(p => p\.state === 'accepted'\)\)/);
  assert.match(source, /if \(p\.state === 'pending'\) pendingSection\.body\.appendChild\(card\)/);
  assert.match(source, /else if \(p\.state === 'accepted'\) acceptedSection\.body\.appendChild\(card\)/);
});

test('review disclosure styling remains compact and non-generic', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'style.css'), 'utf8');
  assert.match(css, /\.review-section-toggle \{[^}]*display: inline-flex[^}]*font: 12px\/1\.3 inherit[^}]*\}/);
  assert.match(css, /\.review-section-toggle::before \{[^}]*border-radius: 50%[^}]*\}/);
  assert.doesNotMatch(css, /\.review-section-toggle \{[^}]*width: 100%/);
  assert.doesNotMatch(css, /\.review-section-toggle \{[^}]*border-bottom/);
});

test('review proposal identity chips use the live provider avatar with initials fallback', () => {
  assert.match(source, /buildIdentityChip\(authorLabel, identity\.color, identity\.avatarUrl\)/);
  assert.match(source, /image\.onerror = function\(\) \{ image\.remove\(\); chip\.textContent = initialsFor\(label\); \}/);
});
