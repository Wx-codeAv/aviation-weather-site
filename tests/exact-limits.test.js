// Limits are compared with the exact value, and "No ceiling forecast" appears only when a group itself
// states a sky with no ceiling layer. Run with: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
for (const file of ['js/wind-math.js', 'js/minimums-check.js', 'js/taf-minimums.js']) {
  vm.runInContext(readRepoFile(file), site, { filename: file });
}

const LIMITS = { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18, gustSpreadOn: false, gustSpread: null };
const limits = (over) => ({ ...LIMITS, ...over });
const taf = (body) => site.parseTaf(`TAF KSEA 081130Z 0812/0912 ${body}`);
const at = (parsed, step, over, runway = null) => site.tafMinimumsAtHour(parsed, step, limits(over), runway, 'No runway selected.');
const block = (r, pattern) => {
  const b = r.blocks.find((x) => pattern.test(x.label));
  assert.ok(b, `no block matching ${pattern}: ${Array.from(r.blocks, (x) => x.label).join(' | ')}`);
  return b;
};
const line = (b, pattern) => {
  const l = b.lines.find((x) => pattern.test(x.text));
  assert.ok(l, `no line matching ${pattern}: ${Array.from(b.lines, (x) => x.text).join(' | ')}`);
  return l;
};
const summarize = (l) => ({ status: l.status, text: l.text });

// ── Crosswind near a limit
// The runway has no variation and a true alignment of 090, so a wind from 175 is 85 degrees off it and a wind
// from 132 is 42 degrees off. 10 kt at 85 degrees is 9.9619 kt of crosswind, and 15 kt at 42 degrees is 10.0370 kt.
const rwy09 = { id: '09', t: 90, variation: 0 };
const metar = (wind) => site.parseMetar(`METAR KXXX 031753Z ${wind} 10SM CLR 12/06 A3001`);
const metarLines = (parsed) => Array.from(site.checkMetarAgainstMinimums(parsed, LIMITS, rwy09, 'x'));

test('9.96 kt of crosswind against a 10 kt limit is within, and the number says 9.96, not 10', () => {
  assert.deepEqual(summarize(site.compareToLimit('Crosswind', 9.96, 10)), { status: 'within', text: 'Crosswind 9.96 kt is within your 10 kt limit.' });
  assert.deepEqual(summarize(line({ lines: metarLines(metar('17510KT')) }, /^Crosswind/)),
    { status: 'within', text: 'Crosswind 9.96 kt is within your 10 kt limit.' });
  const t = line(at(taf('17510KT P6SM SCT040'), 1, {}, rwy09).blocks[0], /^Crosswind/);
  assert.deepEqual(summarize(t), { status: 'within', text: 'Crosswind 9.96 kt is within your 10 kt limit.' });
});

test('10.04 kt of crosswind against a 10 kt limit exceeds it, and the number says 10.04, not 10', () => {
  assert.deepEqual(summarize(site.compareToLimit('Crosswind', 10.04, 10)), { status: 'exceeds', text: 'Crosswind 10.04 kt exceeds your 10 kt limit.' });
  assert.deepEqual(summarize(line({ lines: metarLines(metar('13215KT')) }, /^Crosswind/)),
    { status: 'exceeds', text: 'Crosswind 10.04 kt exceeds your 10 kt limit.' });
  const t = line(at(taf('13215KT P6SM SCT040'), 1, {}, rwy09).blocks[0], /^Crosswind/);
  assert.deepEqual(summarize(t), { status: 'exceeds', text: 'Crosswind 10.04 kt exceeds your 10 kt limit.' });
});

test('the same holds for gust crosswind, and for a variable wind', () => {
  assert.equal(site.compareToLimit('Gust crosswind', 10.04, 10).text, 'Gust crosswind 10.04 kt exceeds your 10 kt limit.');
  assert.equal(site.compareToLimit('Gust crosswind', 9.96, 10).text, 'Gust crosswind 9.96 kt is within your 10 kt limit.');
  assert.equal(site.compareVariableCrosswind('Crosswind', 10.04, 10).text, 'Crosswind could be the full 10.04 kt (variable wind), above your 10 kt limit.');
  assert.equal(site.compareVariableCrosswind('Crosswind', 9.96, 10).text, 'Crosswind could be the full 9.96 kt (variable wind), within your 10 kt limit.');
  const gust = line({ lines: metarLines(metar('13215G15KT')) }, /^Gust crosswind/);
  assert.deepEqual(summarize(gust), { status: 'exceeds', text: 'Gust crosswind 10.04 kt exceeds your 10 kt limit.' });
});

test('only floating-point noise counts as equal: 20 kt at 30 degrees is exactly at a 10 kt limit, and a 0.004 kt excess is not', () => {
  const noise = 20 * Math.sin(30 * Math.PI / 180);
  assert.ok(noise < 10, 'the noise this guards against is 9.999999999999998');
  assert.equal(site.compareToLimit('Crosswind', noise, 10).status, 'at');
  assert.deepEqual(summarize(site.compareToLimit('Crosswind', 10.004, 10)), { status: 'exceeds', text: 'Crosswind 10.004 kt exceeds your 10 kt limit.' });
  assert.deepEqual(summarize(site.compareToLimit('Crosswind', 9.9996, 10)), { status: 'within', text: 'Crosswind 9.9996 kt is within your 10 kt limit.' });
});

test('a value away from the limit still shows one decimal, so ordinary lines read as before', () => {
  assert.equal(site.compareToLimit('Crosswind', 5.1303, 10).text, 'Crosswind 5.1 kt is within your 10 kt limit.');
  assert.equal(site.compareToLimit('Crosswind', 12.5, 10).text, 'Crosswind 12.5 kt exceeds your 10 kt limit.');
  assert.equal(site.compareToLimit('Crosswind', 10.06, 10).text, 'Crosswind 10.1 kt exceeds your 10 kt limit.');
  assert.equal(site.compareToLimit('Crosswind', 9.94, 10).text, 'Crosswind 9.9 kt is within your 10 kt limit.');
});

test('ceiling, wind, and visibility are compared exactly, in a TAF and in a METAR', () => {
  const ceil = (hundreds) => line(at(taf(`20012KT P6SM BKN${String(hundreds).padStart(3, '0')}`), 1).blocks[0], /^Ceiling/);
  assert.deepEqual([ceil(9).status, ceil(10).status, ceil(11).status], ['exceeds', 'at', 'within']);
  const wind = (kt) => line(at(taf(`200${String(kt).padStart(2, '0')}KT P6SM SCT040`), 1).blocks[0], /^Sustained wind/);
  assert.deepEqual([wind(14).status, wind(15).status, wind(16).status], ['within', 'at', 'exceeds']);
  // 3 SM is 4828.032 m
  const tafVis = (m) => line(at(taf(`20012KT ${m} SCT040`), 1).blocks[0], /^Visibility/);
  assert.deepEqual([tafVis(4828).status, tafVis(4829).status], ['exceeds', 'within']);
  const metarVis = (m) => Array.from(site.checkMetarAgainstMinimums(site.parseMetar(`METAR KXXX 031753Z 20012KT ${m} SCT040 12/06 A3001`), LIMITS, null, 'x'))
    .find((l) => /^Visibility/.test(l.text));
  assert.deepEqual([metarVis(4828).status, metarVis(4829).status], ['exceeds', 'within']);
});

// ── "No ceiling forecast" only when the group itself states a sky with no ceiling layer
test('"No ceiling forecast" appears for a group that states a sky with no ceiling layer', () => {
  for (const sky of ['SCT040', 'FEW020', 'NSC', 'SKC']) {
    assert.equal(line(at(taf(`20012KT P6SM ${sky}`), 1).blocks[0], /^No ceiling forecast\./).status, 'within', sky);
  }
  const r = at(taf('20012KT P6SM BKN030 TEMPO 0814/0818 3SM -RA SCT025'), 3);
  assert.match(line(block(r, /^Temporarily/), /^Ceiling|^No ceiling forecast\./).text, /^No ceiling forecast\./);
  assert.equal(line(at(taf('20012KT CAVOK'), 1).blocks[0], /^No ceiling forecast\./).status, 'within');
});

test('a group that inherits the base sky shows the base result under the base, and says nothing about a ceiling itself', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 2SM -RA PROB30 0814/0818 3SM TSRA'), 3);
  assert.equal(line(block(r, /^Base forecast/), /^No ceiling forecast\./).status, 'within');
  for (const b of r.blocks.filter((x) => x.kind === 'overlay')) {
    assert.ok(!b.lines.some((l) => l.element === 'ceiling'), b.label);
    assert.ok(!b.lines.some((l) => /ceiling/i.test(l.text)), b.label);
  }
  // A base with a real ceiling: the inherited ceiling result is the base's, and a visibility-only group does not repeat it.
  const low = at(taf('20012KT P6SM BKN008 TEMPO 0814/0818 2SM -RA'), 3);
  assert.equal(line(block(low, /^Base forecast/), /^Ceiling 800 ft/).status, 'exceeds');
  assert.ok(!block(low, /^Temporarily/).lines.some((l) => /ceiling/i.test(l.text)));
  assert.ok(!low.blocks.flatMap((b) => Array.from(b.lines)).some((l) => /No ceiling forecast/.test(l.text)));
});

test('a From group that states no sky is not "no ceiling": nothing carries over, so the ceiling is not checked', () => {
  const r = at(taf('20012KT P6SM SCT040 FM081400 14008KT 5SM BR'), 3);
  assert.equal(r.blocks[0].label, 'From D08 14:00Z');
  const l = line(r.blocks[0], /^Ceiling/);
  assert.equal(l.status, 'notChecked');
  assert.equal(l.text, 'Ceiling wasn\'t checked because sky condition is missing or unreadable in this forecast.');
  assert.ok(!r.blocks[0].lines.some((x) => /No ceiling forecast/.test(x.text)));
});

test('a group whose sky could not be read shows the Incomplete reason, never "No ceiling forecast"', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 5SM BR ZZZZZ'), 3);
  const t = block(r, /^Temporarily/);
  assert.equal(line(t, /^Ceiling/).status, 'notChecked');
  assert.ok(!t.lines.some((x) => /No ceiling forecast/.test(x.text)));
  assert.match(r.incomplete, /Temporarily: sky condition is missing or unreadable, so ceiling wasn't checked/);
  const fm = at(taf('20012KT P6SM SCT040 FM081400 14008KT 5SM BR OVC015 ZZZZZ'), 3);
  assert.equal(line(fm.blocks[0], /^Ceiling/).status, 'notChecked');
  assert.match(fm.incomplete, /^From D08 14:00Z: /);
});

test('a METAR still says "No ceiling reported."', () => {
  const l = Array.from(site.checkMetarAgainstMinimums(site.parseMetar('METAR KXXX 031753Z 20012KT 10SM SCT040 12/06 A3001'), LIMITS, null, 'x'))
    .find((x) => /ceiling/i.test(x.text));
  assert.equal(l.text, 'No ceiling reported. Your 1,000 ft minimum isn\'t affected.');
});
