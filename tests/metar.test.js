// METAR decoder tests. Run with: node --test
//
// Rule under test: when visibility or sky is missing or unreadable, show a warning and
// no category. Never fall back to a value that looks valid. Every case marked "showed VFR"
// displayed a VFR badge on the live site on 2026-11-03.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
const H = 'METAR KXXX 031753Z AUTO';

// [name, report body, what must be named in a warning]
const NO_BADGE = [
  ['////SM with clear sky (showed VFR)', '23015KT ////SM CLR 24/19 A2987', /visibility/i],
  ['//SM with clear sky (showed VFR)', '23015KT //SM CLR 24/19 A2987', /visibility/i],
  ['metric //// with no cloud detected (showed VFR)', '23015KT //// NCD 24/19 Q1015', /visibility/i],
  ['no visibility and no sky groups (showed VFR)', '23015KT 24/19 A2987', /visibility/i],
  ['no visibility, sky reported', '23015KT BKN040 24/19 A2987', /visibility/i],
  ['no sky group (showed VFR)', '23015KT 10SM 24/19 A2987', /sky/i],
  ['BKN/// (showed VFR)', '23015KT 10SM BKN/// 24/19 A2987', /BKN\/\/\//],
  ['OVC/// (showed VFR)', '23015KT 10SM OVC/// 24/19 A2987', /OVC\/\/\//],
  ['///015, amount unknown (showed VFR)', '23015KT 10SM ///015 24/19 A2987', /\/\/\/015/],
  ['////// (showed VFR)', '23015KT 10SM ////// 24/19 A2987', /\/\/\/\/\/\//],
  ['//////CB (showed VFR)', '23015KT 10SM //////CB 24/19 A2987', /\/\/\/\/\/\/CB/],
  ['//////TCU (showed VFR)', '23015KT 10SM //////TCU 24/19 A2987', /\/\/\/\/\/\/TCU/],
  ['FEW020 with BKN/// above it (showed VFR)', '23015KT 10SM FEW020 BKN/// 24/19 A2987', /BKN\/\/\//],
  ['BKN040 with //////CB beside it (showed VFR)', '23015KT 10SM BKN040 //////CB 24/19 A2987', /\/\/\/\/\/\/CB/],
  ['VV/// with no height', '23015KT 10SM VV/// 24/19 A2987', /VV\/\/\//],
  ['garbled visibility (showed VFR)', '23015KT 1XSM CLR 24/19 A2987', /1XSM/],
  ['garbled weather (showed VFR)', '23015KT 10SM ZZZZ OVC004 24/19 A2987', /ZZZZ/],
  ['garbled sky layer as the only layer (showed VFR)', '23015KT 10SM BKN04 24/19 A2987', /BKN04/],
  ['garbled sky layer under a good one (showed VFR)', '23015KT 10SM SCT040 BKN04 24/19 A2987', /BKN04/],
  ['NIL report (showed VFR)', '', /visibility/i],
];

for (const [name, body, named] of NO_BADGE) {
  test(`no badge: ${name}`, () => {
    const raw = body ? `${H} ${body}` : 'METAR KXXX 031753Z NIL';
    const parsed = site.parseMetar(raw);
    assert.equal(parsed.flightCategory, null);
    assert.ok(parsed.warnings.length > 0, 'must warn');
    assert.ok(parsed.warnings.some((w) => named.test(w)), `warning must name the problem: ${[...parsed.warnings].join(' | ')}`);
  });
}

// A real category must survive, and recovered groups must count.
const CATEGORY = [
  ['full US report', '23015G25KT 10SM -RA SCT018 BKN065 24/19 A2987', 'VFR'],
  ['CAVOK has no sky group and needs none', '23015KT CAVOK 24/19 Q1015', 'VFR'],
  ['FEW/// is never a ceiling', '23015KT 10SM FEW/// 24/19 A2987', 'VFR'],
  ['SCT/// is never a ceiling', '23015KT 10SM SCT/// 24/19 A2987', 'VFR'],
  ['height known, cloud type slashed', '23015KT 10SM BKN004/// 24/19 A2987', 'LIFR'],
  ['height known, amount and type known', '23015KT 10SM OVC010CB 24/19 A2987', 'MVFR'],
  ['less-than visibility', '23015KT M1/4SM FG OVC001 24/19 A2987', 'LIFR'],
  ['9999NDV is 10 km or more (showed VFR by accident, with vis unread)', '23005KT 9999NDV NCD 10/08 Q1015', 'VFR'],
  ['1200NDV is read (showed VFR)', '23005KT 1200NDV BR NCD 10/08 Q1015', 'LIFR'],
  ['// weather slot does not hide the ceiling (showed VFR)', '23005KT 9999 // OVC004 10/08 Q1015', 'LIFR'],
  ['prevailing with a directional minimum (hid OVC004, showed IFR)', '23005KT 4000 1500NE BR OVC004 10/08 Q1015', 'LIFR'],
  ['directional visibility alone (showed VFR)', '23005KT 1500NE BR OVC004 10/08 Q1015', 'LIFR'],
  ['P6SM pasted into a METAR (showed VFR)', '23005KT P6SM OVC004 10/08 A2987', 'LIFR'],
  ['garbled wind does not affect the category (showed VFR)', '23015G//KT 10SM OVC004 24/19 A2987', 'LIFR'],
  ['wind sensor out does not affect the category', '/////KT 10SM CLR 24/19 A2987', 'VFR'],
];

for (const [name, body, category] of CATEGORY) {
  test(`category ${category}: ${name}`, () => {
    assert.equal(site.parseMetar(`${H} ${body}`).flightCategory, category);
  });
}

test('a ceiling after a garbled group still counts, and still warns (showed VFR)', () => {
  const parsed = site.parseMetar(`${H} 23015KT 10SM BKN040 XXX OVC004 24/19 A2987`);
  assert.deepEqual([...parsed.sky].map((l) => l.raw), ['BKN040', 'OVC004']);
  assert.equal(parsed.flightCategory, null, 'XXX could be a garbled layer');
  assert.ok(parsed.warnings.some((w) => /XXX/.test(w)));
  assert.ok(parsed.warnings.some((w) => /LIFR/.test(w)), 'must still say the reported values are LIFR');
});

test('a warning says when reported values alone are already below VFR', () => {
  const parsed = site.parseMetar(`${H} 23015KT ////SM OVC004 24/19 A2987`);
  assert.equal(parsed.flightCategory, null);
  assert.ok(parsed.warnings.some((w) => /already LIFR/.test(w)));
});

test('a warning does not imply VFR when reported values look fine', () => {
  const parsed = site.parseMetar(`${H} 23015KT ////SM CLR 24/19 A2987`);
  assert.ok(!parsed.warnings.some((w) => /VFR/.test(w)), [...parsed.warnings].join(' | '));
});

test('trend forecasts are labeled, are not unrecognized, and do not count as sky', () => {
  const parsed = site.parseMetar('METAR EHAM 031555Z 07013KT 9999 FEW012 SCT030 10/07 Q1031 BECMG BKN004');
  assert.deepEqual([...parsed.sky].map((l) => l.raw), ['FEW012', 'SCT030']);
  assert.equal(parsed.flightCategory, 'VFR');
  assert.equal(parsed.unrecognized.length, 0);
  assert.ok(parsed.fields.some((f) => f.token === 'BKN004' && f.label === 'Trend forecast'));
  assert.equal(site.parseMetar('METAR EBBR 031550Z 07009KT 9999 BKN038 08/02 Q1029 NOSIG').unrecognized.length, 0);
});

test('a group after the altimeter cannot change the category', () => {
  const parsed = site.parseMetar(`${H} 23015KT 10SM CLR 24/19 A2987 QQQQ`);
  assert.equal(parsed.flightCategory, 'VFR');
  assert.equal(parsed.warnings.length, 0);
});

// ── The "why this category" scale must not point at VFR for unknown data
const activeSegments = (html) => (html.match(/cat-seg seg-\w+ active/g) || []);

test('scale marks nothing for missing visibility and missing sky', () => {
  const html = site.buildCategoryScale(site.parseMetar(`${H} 23015KT 24/19 A2987`));
  assert.equal(activeSegments(html).length, 0);
  assert.match(html, /Not reported/);
  assert.doesNotMatch(html, /No ceiling/);
  assert.doesNotMatch(html, /more restrictive/);
});

test('scale still marks the element that is known', () => {
  const html = site.buildCategoryScale(site.parseMetar(`${H} 23015KT ////SM OVC004 24/19 A2987`));
  assert.deepEqual(activeSegments(html), ['cat-seg seg-lifr active']);
});

test('scale shows the unreadable layer instead of "No ceiling"', () => {
  const html = site.buildCategoryScale(site.parseMetar(`${H} 23015KT 10SM BKN/// 24/19 A2987`));
  assert.deepEqual(activeSegments(html), ['cat-seg seg-vfr active']);
  assert.match(html, /BKN\/\/\//);
  assert.doesNotMatch(html, /No ceiling/);
});

test('a real clear-sky report still says No ceiling', () => {
  const html = site.buildCategoryScale(site.parseMetar(`${H} 23015KT 10SM CLR 24/19 A2987`));
  assert.match(html, /No ceiling/);
  assert.match(html, /more restrictive/);
});

// ── A wide net over real reports
test('all real METARs in the sample keep a category and raise no warning', () => {
  const lines = readRepoFile('tests/fixtures/metars-2026-11-03.txt').trim().split(/\r?\n/);
  assert.ok(lines.length >= 100);
  for (const raw of lines) {
    const parsed = site.parseMetar(raw);
    assert.ok(parsed.flightCategory, `no category: ${raw}`);
    assert.deepEqual([...parsed.warnings], [], raw);
  }
});

// ── TAF: same rule for a change group with an unreadable sky or visibility
const TAF_BASE = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM BKN040';

for (const [name, group, token] of [
  ['garbled sky', 'TEMPO 0114/0116 BKN0', 'BKN0'],
  ['slashed sky', 'TEMPO 0114/0116 OVC///', 'OVC///'],
  ['garbled visibility', 'BECMG 0114/0116 1XSM', '1XSM'],
]) {
  test(`TAF ${name} does not silently inherit`, () => {
    const parsed = site.parseTaf(`${TAF_BASE} ${group}`);
    assert.equal(parsed.groups[1].flightCategory, null);
    assert.ok(parsed.warnings.some((w) => w.includes(token)), [...parsed.warnings].join(' | '));
  });
}

test('TAF VV/// follows the same no-badge rule', () => {
  const parsed = site.parseTaf('TAF KXXX 011130Z 0112/0212 18010KT 6000 VV///');
  assert.equal(parsed.groups[0].sky[0].raw, 'VV///');
  assert.equal(parsed.groups[0].flightCategory, null);
  assert.ok(parsed.warnings.length > 0);
});
