// A failed decode must clear the previous result and show only its error, so a pilot can't read the
// old TAF or METAR as the new one. These tests run the real decoder scripts against a small fake page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function makePage() {
  const els = {};
  const listeners = {};
  const make = (id) => ({
    id, hidden: false, textContent: '', innerHTML: '', value: '', className: '', title: '', style: {},
    dataset: {}, children: [], disabled: false,
    addEventListener(type, fn) { (listeners[id + ':' + type] = listeners[id + ':' + type] || []).push(fn); },
    removeEventListener() {}, scrollIntoView() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, focus() {}, closest() { return make('closest'); }, matches() { return false; }, contains() { return false; },
    remove() {}, insertAdjacentHTML() {}, replaceChildren() {}, parentElement: null,
  });
  const document = {
    getElementById: (id) => (els[id] = els[id] || make(id)),
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => make('created'),
    addEventListener(type, fn) { (listeners['document:' + type] = listeners['document:' + type] || []).push(fn); },
  };
  const context = { console, URLSearchParams, location: { search: '' }, window: {}, document, localStorage: { getItem: () => null, setItem() {} }, setTimeout, clearTimeout, requestAnimationFrame: (f) => f() };
  context.window = context;
  vm.createContext(context);
  for (const file of ['js/metar-decoder.js', 'js/taf-decoder.js', 'js/taf-slider.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  for (const fn of listeners['document:DOMContentLoaded'] || []) fn();
  const click = (id) => { for (const fn of listeners[id + ':click'] || []) fn(); };
  return { document, click, el: (id) => document.getElementById(id), context };
}

const GOOD_TAF = 'TAF KDFW 030259Z 0303/0406 17016KT P6SM SCT040 BKN060 FM030400 18015G25KT P6SM VCTS SCT035CB BKN050';
const GOOD_METAR = 'METAR KDFW 031753Z 23015G25KT 10SM -RA SCT018 BKN065 OVC090 24/19 A2987 RMK AO2 SLP117';

function decodeTaf(page, text) {
  page.el('taf-input').value = text;
  page.click('btn-decode-taf');
}
function decodeMetar(page, text) {
  page.el('metar-input').value = text;
  page.click('btn-decode');
}

test('a good TAF shows its output and no error', () => {
  const page = makePage();
  decodeTaf(page, GOOD_TAF);
  assert.equal(page.el('taf-output').hidden, false);
  assert.equal(page.el('taf-error').hidden, true);
  assert.equal(page.el('taf-station').textContent, 'KDFW');
});

for (const [label, bad] of [
  ['an empty paste', ''],
  ['a bare word', 'THIS'],
  ['two words', 'hello world'],
  ['the word TAF alone', 'TAF'],
  ['a station with garbage', 'TAF KDFW garbage'],
  ['a station and issue time only', 'TAF KDFW 030259Z'],
]) {
  test(`TAF: after a good decode, ${label} hides the old result and shows only an error`, () => {
    const page = makePage();
    decodeTaf(page, GOOD_TAF);
    assert.equal(page.el('taf-output').hidden, false, 'the good decode showed');
    decodeTaf(page, bad);
    assert.equal(page.el('taf-output').hidden, true, 'the old TAF is no longer visible');
    assert.equal(page.el('taf-error').hidden, false, 'an error is shown');
    assert.notEqual(page.el('taf-error').textContent, '');
  });
}

test('TAF: a failed decode right after another failure still shows no result', () => {
  const page = makePage();
  decodeTaf(page, GOOD_TAF);
  decodeTaf(page, 'hello world');
  decodeTaf(page, '');
  assert.equal(page.el('taf-output').hidden, true);
  assert.equal(page.el('taf-error').textContent, 'Paste a TAF to decode.');
});

test('TAF: a good decode after a failure shows the result again and clears the error', () => {
  const page = makePage();
  decodeTaf(page, 'THIS');
  assert.equal(page.el('taf-output').hidden, true);
  decodeTaf(page, GOOD_TAF);
  assert.equal(page.el('taf-output').hidden, false);
  assert.equal(page.el('taf-error').hidden, true);
  assert.equal(page.el('taf-error').textContent, '');
});

test('TAF: the bare-word error says why, and names what was missing', () => {
  const page = makePage();
  decodeTaf(page, 'THIS');
  assert.match(page.el('taf-error').textContent, /Could not read a forecast from this text\. It has no valid period \(like 0303\/0406\) and no readable wind, visibility, weather, or sky\./);
});

test('TAF: a TAF with readable weather but a valid period over 30 hours still decodes, with its warning', () => {
  const page = makePage();
  decodeTaf(page, 'TAF KDFW 030259Z 0303/0506 17016KT P6SM SCT040');
  assert.equal(page.el('taf-output').hidden, false);
  assert.equal(page.el('taf-error').hidden, true);
});

test('TAF: a new TAF without a valid period or issue time does not show the previous TAF\'s times', () => {
  const page = makePage();
  decodeTaf(page, GOOD_TAF);
  assert.match(page.el('taf-valid').textContent, /^Valid /);
  assert.match(page.el('taf-issued').textContent, /^Issued /);
  decodeTaf(page, 'TAF KJFK 17016KT P6SM SCT040');
  assert.equal(page.el('taf-station').textContent, 'KJFK');
  assert.equal(page.el('taf-valid').textContent, 'Valid period could not be read');
  assert.equal(page.el('taf-issued').textContent, 'Issue time could not be read');
});

test('tafNothingReadable: only text with no period and no weather elements', () => {
  const { context } = makePage();
  const nothing = (t) => context.tafNothingReadable(context.parseTaf(t));
  assert.equal(nothing('THIS'), true);
  assert.equal(nothing('TAF KDFW garbage'), true);
  assert.equal(nothing('TAF KDFW 030259Z'), true);
  assert.equal(nothing(GOOD_TAF), false);
  assert.equal(nothing('TAF KDFW 030259Z 0303/0506 17016KT P6SM SCT040'), false);
  assert.equal(nothing('TAF KDFW 030259Z 0303/0406 17016KT'), false);
});

test('METAR: after a good decode, a bad paste hides the old result and shows only an error', () => {
  for (const bad of ['', 'hello world']) {
    const page = makePage();
    decodeMetar(page, GOOD_METAR);
    assert.equal(page.el('decoder-output').hidden, false, 'the good decode showed');
    decodeMetar(page, bad);
    assert.equal(page.el('decoder-output').hidden, true, `the old METAR is hidden after ${JSON.stringify(bad)}`);
    assert.equal(page.el('decoder-error').hidden, false);
  }
});

test('METAR: a good decode after a failure shows the result and clears the error', () => {
  const page = makePage();
  decodeMetar(page, 'hello world');
  decodeMetar(page, GOOD_METAR);
  assert.equal(page.el('decoder-output').hidden, false);
  assert.equal(page.el('decoder-error').hidden, true);
});
