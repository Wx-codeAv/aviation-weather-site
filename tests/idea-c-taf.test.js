// Idea C for TAF: the personal minimums check on the hour-by-hour slider. Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const snapshot = require('./support/metar-minimums-snapshot');

// The shared check functions were refactored so the forecast panel could use them. This pins what the
// METAR check says for every real METAR in the fixture (121 reports) under three saved-limit sets and
// four runways (east variation, west variation, no FAA alignment, none chosen). If it changes, the
// METAR check changed, and that has to be a decision, not a side effect.
const METAR_OUTPUT_SHA256 = '29ed848a95735982231ba827e9b538af7f417d71f691fd2fd8d3db581834159b';

test('the METAR minimums check says exactly what it said before the forecast panel existed', () => {
  assert.equal(snapshot.build().split('\n').length, 1452);
  assert.equal(snapshot.hash(), METAR_OUTPUT_SHA256);
});
