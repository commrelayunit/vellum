const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createUserProfileRepo } = require('./user-profile');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  return { profile: createUserProfileRepo(db) };
}

test('get() returns the seeded default profile after migration', () => {
  const { profile } = setup();
  const result = profile.get();
  assert.equal(result.label, 'You');
  assert.equal(result.avatarUrl, null);
});

test('update() persists label and avatarUrl and round-trips through get()', () => {
  const { profile } = setup();
  const updated = profile.update({ label: 'Velitchko', avatarUrl: 'https://example.com/me.png' });
  assert.equal(updated.label, 'Velitchko');
  assert.equal(updated.avatarUrl, 'https://example.com/me.png');
  assert.deepEqual(profile.get(), updated);
});

test('update() with a null avatarUrl clears a previously-set one', () => {
  const { profile } = setup();
  profile.update({ label: 'Velitchko', avatarUrl: 'https://example.com/me.png' });
  const cleared = profile.update({ label: 'Velitchko', avatarUrl: null });
  assert.equal(cleared.avatarUrl, null);
});

test('get() returns a null cursorColor before any is set', () => {
  const { profile } = setup();
  assert.equal(profile.get().cursorColor, null);
});

test('update() persists cursorColor and round-trips through get()', () => {
  const { profile } = setup();
  const updated = profile.update({ label: 'Velitchko', cursorColor: '#5b6eae' });
  assert.equal(updated.cursorColor, '#5b6eae');
  assert.deepEqual(profile.get(), updated);
});

test('update() with a null cursorColor clears a previously-set one', () => {
  const { profile } = setup();
  profile.update({ label: 'Velitchko', cursorColor: '#5b6eae' });
  const cleared = profile.update({ label: 'Velitchko', cursorColor: null });
  assert.equal(cleared.cursorColor, null);
});
