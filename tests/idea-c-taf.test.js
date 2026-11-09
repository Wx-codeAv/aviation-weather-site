// Idea C for TAF: the personal minimums check on the hour-by-hour slider. Run with: node --test
//
// Hours count from the start of the valid period. In these TAFs (0812/0912), step 0 is 12Z on day 8,
// so step 3 is 15Z and step 7 is 19Z.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const snapshot = require('./support/metar-minimums-snapshot');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
for (const file of ['js/wind-math.js', 'js/minimums-check.js', 'js/taf-minimums.js']) {
  vm.runInContext(readRepoFile(file), site, { filename: file });
}
const airports = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/data/airports-us.json'), 'utf8'));

// ── The METAR check did not change
// The shared check functions were refactored so the forecast panel could use them. This pins what the
// METAR check says for every real METAR in the fixture (121 reports) under three saved-limit sets and
// four runways (east variation, west variation, no FAA alignment, none chosen). If it changes, the
// METAR check changed, and that has to be a decision, not a side effect.
// Re-pinned once on purpose: "(about 6 SM)" became "(about 6.2 SM)" on the 9999 and CAVOK lines (264 lines,
// no status changed), because 9999 and CAVOK mean at least 10 km, which is 6.2137 SM.
// Re-pinned a second time on purpose, when the limit comparison stopped rounding to a tenth first: four crosswinds
// in the fixture that read "at limit" are really 9.96 kt against 10 and 4.99 kt against 5, and now say "within".
const METAR_OUTPUT_SHA256 = '9e492f90d5e0a9c9573695a4cf85feb5a5365ac637c96e25d9b19d9f6b6f9c8f';

test('the METAR minimums check says exactly what it said before the forecast panel existed', () => {
  assert.equal(snapshot.build().split('\n').length, 1452);
  assert.equal(snapshot.hash(), METAR_OUTPUT_SHA256);
});

// ── Helpers
const LIMITS = { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18, gustSpreadOn: false, gustSpread: null };
const limits = (over) => ({ ...LIMITS, ...over });
const taf = (body, station = 'KSEA') => site.parseTaf(`TAF ${station} 081130Z 0812/0912 ${body}`);
const ksea16L = { id: '16L', t: 180, variation: 14.8 };   // east variation, from the airport file
const at = (parsed, step, over, runway = null, reason = 'No runway selected.') =>
  site.tafMinimumsAtHour(parsed, step, limits(over), runway, reason);
const labels = (r) => Array.from(r.blocks, (b) => b.label);
const block = (r, pattern) => {
  const b = r.blocks.find((x) => pattern.test(x.label));
  assert.ok(b, `no block matching ${pattern}: ${labels(r).join(' | ')}`);
  return b;
};
const texts = (b) => Array.from(b.lines, (l) => l.text);
const line = (b, pattern) => {
  const l = b.lines.find((x) => pattern.test(x.text));
  assert.ok(l, `no line matching ${pattern}: ${texts(b).join(' | ')}`);
  return l;
};
const noLine = (b, pattern) => assert.ok(!b.lines.some((x) => pattern.test(x.text)), texts(b).join(' | '));

// A forecast with a Becoming, a Temporarily, a PROB30, and an FM.
const FULL = '20012KT P6SM SCT040 BECMG 0814/0816 24015G25KT 5SM BR OVC008 TEMPO 0815/0819 2SM -RA PROB30 0816/0820 1SM TSRA BKN005CB FM081800 14008KT 3SM BR OVC015';

// ── Which sources are checked at each hour
test('the forecast in effect is the only source when nothing else covers the hour', () => {
  const r = at(taf(FULL), 1);
  assert.deepEqual(labels(r), ['Base forecast']);
});

test('inside a Becoming window both the before and the after states are checked', () => {
  const r = at(taf(FULL), 2);   // 14Z
  assert.deepEqual(labels(r), ['Base forecast, before the change', 'Becoming, after the change']);
  assert.equal(block(r, /before the change/).lines.find((l) => /^Visibility/.test(l.text)).status, 'within');
  assert.equal(line(block(r, /after the change/), /^Ceiling/).status, 'exceeds');
});

test('after a Becoming window ends, its values are the forecast in effect, and the source says so', () => {
  const r = at(taf(FULL), 5);   // 17Z
  assert.equal(r.blocks[0].label, 'Base forecast, after Becoming D08 14:00Z → D08 16:00Z');
  assert.match(line(r.blocks[0], /^Ceiling/).text, /^Ceiling 800 ft is below/);
});

test('each Temporarily and probability group covering the hour is its own source, with its percentage', () => {
  const r = at(taf(FULL), 5);   // 17Z: TEMPO 15Z to 19Z and PROB30 16Z to 20Z
  assert.deepEqual(labels(r), ['Base forecast, after Becoming D08 14:00Z → D08 16:00Z', 'Temporarily', '30% probability']);
  assert.equal(block(r, /^30% probability$/).range, 'D08 16:00Z → D08 20:00Z');
  const t = at(taf('20012KT P6SM SCT040 PROB40 TEMPO 0814/0818 3SM BR BKN012'), 3);
  assert.deepEqual(labels(t), ['Base forecast', '40% probability, temporary']);
});

test('a group is not a source outside its own window, and an FM replaces what came before', () => {
  const r = at(taf(FULL), 7);   // 19Z, after the FM
  assert.deepEqual(labels(r), ['From D08 18:00Z']);
  assert.deepEqual(labels(at(taf(FULL), 0)), ['Base forecast']);
});

test('a Temporarily inside a Becoming window is checked against both sides, and listed twice only when they differ', () => {
  // The Temporarily changes visibility only, so the change does not matter to it: one block.
  const same = at(taf('20012KT P6SM SCT040 BECMG 0814/0818 24015KT 5SM OVC008 TEMPO 0814/0818 2SM -RA'), 3);
  assert.deepEqual(labels(same), ['Base forecast, before the change', 'Becoming, after the change', 'Temporarily']);
  // The Temporarily gives a wind only, so its crosswind depends on which side it sits on.
  const differs = at(taf('20012KT P6SM SCT040 BECMG 0814/0818 24015KT 5SM OVC008 TEMPO 0814/0818 20015KT'), 3, {}, ksea16L);
  assert.deepEqual(labels(differs), ['Base forecast, before the change', 'Becoming, after the change', 'Temporarily']);
  const both = at(taf('20012KT P6SM SCT040 BECMG 0814/0818 27015KT 5SM OVC008 TEMPO 0814/0818 VRB10KT 2SM'), 3, {}, ksea16L);
  assert.ok(labels(both).includes('Temporarily'));
});

test('a From group that starts part way through the hour adds the forecast that follows it', () => {
  const p = taf('20012KT P6SM SCT040 FM081530 14008KT 3SM BR OVC015');
  const r = at(p, 3);   // 15Z hour, the FM is at 15:30
  assert.deepEqual(labels(r), ['Base forecast', 'Later this hour: From D08 15:30Z']);
  assert.equal(line(block(r, /^Later this hour/), /^Ceiling/).status, 'within');
  assert.deepEqual(labels(at(p, 4)), ['From D08 15:30Z']);
});

// ── Nothing is hidden, and nothing is approved
test('a Temporarily visibility below the limit shows while the forecast in effect is within', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 2SM -RA'), 3);
  assert.equal(line(block(r, /^Base forecast/), /^Visibility/).status, 'within');
  assert.equal(line(block(r, /^Temporarily/), /^Visibility/).status, 'exceeds');
  assert.match(site.tafMinimumsSummary(r), /Temporarily \(visibility\)/);
});

test('a PROB30 crosswind above the limit shows with its probability', () => {
  const r = at(taf('20012KT P6SM SCT040 PROB30 0814/0818 27020KT'), 3, {}, ksea16L);
  const b = block(r, /^30% probability$/);
  assert.equal(line(b, /^Crosswind/).status, 'exceeds');
  assert.match(site.tafMinimumsSummary(r), /30% probability \(wind\)/);
});

test('there is no verdict: no summary when nothing is at or outside a limit, and no go or pass wording anywhere', () => {
  const r = at(taf('20012KT P6SM SCT040'), 1, {}, ksea16L);
  assert.equal(site.tafMinimumsSummary(r), null);
  assert.equal(r.incomplete, null);
  const everything = [...r.blocks.flatMap((b) => texts(b)), TEXT_OF_PANEL()].join(' ');
  assert.doesNotMatch(everything, /\b(go|pass|passes|passed|approved|safe|ok|clear to)\b/i);
  const bad = at(taf(FULL), 5, {}, ksea16L);
  assert.doesNotMatch(site.tafMinimumsSummary(bad), /\b(go|pass|approved|safe)\b/i);
});

function TEXT_OF_PANEL() {
  return readRepoFile('js/taf-minimums.js').match(/TAF_MINIMUMS_NOTE = '([^']|\\')*'/)[0];
}

test('the summary counts only results at or outside a limit', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 3SM -RA'), 3);   // 3 SM is at the 3 SM limit
  assert.match(site.tafMinimumsSummary(r), /^1 result is at or outside your limits at this hour: Temporarily \(visibility\)\.$/);
  const within = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 5SM -RA'), 3);
  assert.equal(site.tafMinimumsSummary(within), null);
});

// ── A group shows what it states, and the rest comes from the forecast it modifies
test('a Temporarily that restates only visibility shows only visibility, and the base shows the rest', () => {
  const r = at(taf('20012KT P6SM BKN008 TEMPO 0814/0818 2SM -RA'), 3, {}, ksea16L);
  const t = block(r, /^Temporarily/);
  assert.deepEqual(Array.from(new Set(t.lines.map((l) => l.element))), ['visibility']);
  assert.equal(line(block(r, /^Base forecast/), /^Ceiling/).status, 'exceeds');   // the base's ceiling still shows
});

test('a group that states a wind shows the wind lines with their conversion, and nothing else', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 24020KT'), 3, {}, ksea16L);
  const t = block(r, /^Temporarily/);
  assert.deepEqual(Array.from(new Set(t.lines.map((l) => l.element))), ['wind']);
  assert.match(line(t, /^RWY 16L/).text, /240°T − 14\.8°E = 225\.2°M/);
});

test('a group that states nothing about ceiling, visibility, or wind says so instead of an empty list', () => {
  const r = at(taf('20012KT P6SM SCT040 TEMPO 0814/0818 -RA'), 3);
  assert.equal(block(r, /^Temporarily/).lines.length, 0);
  assert.match(site.buildTafMinimumsBlocks(r), /states no ceiling, visibility, or wind, so there is nothing new to check/);
});

// ── Unreadable elements: the doubt follows the value
test('an unreadable token in a From group makes that group incomplete for its whole window, and no longer after the next From', () => {
  const p = taf('20012KT P6SM SCT040 FM081400 14008KT 5SM BR OVC015 ZZZZZ FM081800 14008KT 5SM BR OVC015');
  const inside = at(p, 3, {}, ksea16L);   // 15Z, inside the first FM
  assert.equal(line(block(inside, /^From D08 14:00Z/), /^Ceiling/).status, 'notChecked');
  assert.match(inside.incomplete, /^From D08 14:00Z: /);
  const later = at(p, 7, {}, ksea16L);    // 19Z, after the second FM
  assert.equal(later.incomplete, null);
  assert.equal(line(later.blocks[0], /^Ceiling/).status, 'within');
});

test('an unreadable element never turns a certain exceedance into "not checked"', () => {
  const p = taf('20012KT P6SM SCT040 FM081400 14008KT 1SM BR OVC004 ZZZZZ');
  const b = at(p, 3).blocks[0];
  assert.equal(line(b, /^Ceiling/).status, 'exceeds');
  assert.equal(line(b, /^Visibility/).status, 'exceeds');
});

test('a Temporarily keeps the doubt about elements it does not restate, and clears it for those it does', () => {
  const p = taf('20012KT P6SM SCT040 ZZZZZ TEMPO 0814/0818 5SM -RA');
  const r = at(p, 3);
  assert.equal(line(block(r, /^Base forecast/), /^Ceiling/).status, 'notChecked');
  const t = block(r, /^Temporarily/);
  assert.equal(line(t, /^Visibility/).status, 'within');       // restated, so no longer in doubt
  assert.ok(!t.lines.some((l) => l.element === 'ceiling'));    // not restated, so shown under the base only
  assert.ok(r.incomplete.includes('Base forecast: '), r.incomplete);
  assert.ok(!r.incomplete.includes('Temporarily: '), r.incomplete);
});

test('a Temporarily that restates both sky and visibility clears the doubt for both', () => {
  const r = at(taf('20012KT P6SM SCT040 ZZZZZ TEMPO 0814/0818 5SM BKN030'), 3);
  const t = block(r, /^Temporarily/);
  assert.equal(line(t, /^Ceiling/).status, 'within');
  assert.equal(line(t, /^Visibility/).status, 'within');
});

test('two groups with different problems give separate reasons, each named by its group', () => {
  const p = taf('20012KT P6SM SCT040 TEMPO 0814/0818 5SM BR ZZZZZ PROB30 0814/0818 3SM RA OVC00');
  const r = at(p, 3);
  assert.ok(block(r, /^Temporarily/) && block(r, /^30% probability$/));
  assert.match(r.incomplete, /Temporarily: /);
  assert.ok(r.incomplete.split('; ').length >= 2, r.incomplete);
});

test('a group whose time cannot be placed is listed once above the hours, and is in no hour', () => {
  const p = taf('20012KT P6SM SCT040 TEMPO 081400/081800 2SM -RA TEMPO XX/YY 1SM FG');
  const unplaced = site.tafUnplacedGroups(p);
  assert.ok(unplaced.length >= 1, JSON.stringify(unplaced));
  const noTime = taf('20012KT P6SM SCT040 TEMPO 2SM -RA');
  assert.deepEqual(Array.from(site.tafUnplacedGroups(noTime)), ['Temporarily (no readable valid time)']);
  for (let step = 0; step < 24; step++) {
    assert.ok(!labels(at(noTime, step)).includes('Temporarily'), `step ${step}`);
  }
  const late = taf('20012KT P6SM SCT040 TEMPO 0920/0922 2SM -RA');
  assert.match(site.tafUnplacedGroups(late)[0], /outside the valid period/);
});

test('groups that can be placed are not in the standing note', () => {
  assert.deepEqual(Array.from(site.tafUnplacedGroups(taf(FULL))), []);
});

test('no runway, no runway data, and no saved limit are each named as a reason', () => {
  const p = taf('27015KT P6SM SCT040');
  assert.match(at(p, 1).incomplete, /no runway selected, so crosswind wasn't checked/i);
  const noData = at(p, 1, {}, null, 'No runway data for CYEG, because only US airports with an ICAO ID are included.');
  assert.match(noData.incomplete, /no runway data for cyeg/i);
  const noLimit = at(p, 1, { ceiling: null, crosswind: null }, ksea16L);
  assert.match(noLimit.incomplete, /no ceiling minimum is saved/);
  assert.match(noLimit.incomplete, /no limit is saved for crosswind/);
});

// ── Visibility
test('P6SM means more than 6 SM: limits up to 6 are met, anything higher cannot be confirmed', () => {
  for (const [limit, status] of [[3, 'within'], [6, 'within'], [6.5, 'notChecked'], [8, 'notChecked']]) {
    const l = line(at(taf('20012KT P6SM SCT040'), 1, { visibility: limit }).blocks[0], /^Visibility/);
    assert.equal(l.status, status, `limit ${limit}`);
    if (status === 'notChecked') {
      assert.match(l.text, /^Visibility P6SM, better than 6 SM can't be confirmed against your /);
      assert.match(l.incomplete, /P6SM can't be confirmed/);
    }
  }
});

test('9999 and CAVOK mean at least 10 km, about 6.2 SM: a limit of 6 is met and 6.5 cannot be confirmed', () => {
  for (const vis of ['9999', 'CAVOK']) {
    const body = vis === 'CAVOK' ? '20012KT CAVOK' : `20012KT ${vis} SCT040`;
    const six = line(at(taf(body), 1, { visibility: 6 }).blocks[0], /^Visibility/);
    assert.equal(six.status, 'within', vis);
    assert.match(six.text, /\(about 6\.2 SM\) meets your 6 SM minimum\.$|^Visibility CAVOK/);
    const six5 = line(at(taf(body), 1, { visibility: 6.5 }).blocks[0], /^Visibility/);
    assert.equal(six5.status, 'notChecked', vis);
    assert.match(six5.incomplete, /can't be confirmed against your 6\.5 SM minimum/);
  }
  assert.equal(read('TEN_KM_IN_SM').toFixed(4), '6.2137');
});

test('the same 9999 and CAVOK rule holds for a METAR', () => {
  const check = (body, over) => Array.from(site.checkMetarAgainstMinimums(site.parseMetar(`METAR KSEA 031753Z ${body} 12/06 A3001`), limits(over), null, 'x'));
  for (const body of ['18005KT 9999 CLR', '18005KT CAVOK']) {
    assert.equal(check(body, { visibility: 6 }).find((l) => /^Visibility/.test(l.text)).status, 'within');
    assert.equal(check(body, { visibility: 6.5 }).find((l) => /^Visibility/.test(l.text)).status, 'notChecked');
  }
});

test('metric visibility in a TAF is compared with the exact distance', () => {
  const l = (vis, limit) => line(at(taf(`20012KT ${vis} SCT040`), 1, { visibility: limit }).blocks[0], /^Visibility/);
  assert.equal(l('4800', 3).status, 'exceeds');
  assert.equal(l('4800', 3).text, 'Visibility 4800 m (2.98 SM) is below your 3 SM minimum.');
  assert.equal(l('4829', 3).status, 'within');
});

// ── Wind: TAF wind is true, so it is converted with the airport's variation
const ends = (id) => airports.airports[id].r.flat();
const realRunway = (airport, runwayId) => {
  const end = ends(airport).find((e) => e[0] === runwayId);
  assert.ok(end, `${airport} ${runwayId} is in the airport file`);
  return { id: runwayId, t: end[1], variation: airports.airports[airport].v };
};

test('east variation, KSEA 16L: the wind and the runway are both turned magnetic, and the numbers match the hand calculation', () => {
  const rwy = realRunway('KSEA', '16L');
  assert.deepEqual(rwy, { id: '16L', t: 180, variation: 14.8 });
  // Runway: 180 true - 14.8 east = 165.2 magnetic.
  // 200 true is 185.2 magnetic, 20.0 degrees from the runway. 15 kt * sin(20) = 5.13 kt.
  const a = at(taf('20015KT P6SM SCT040'), 1, {}, rwy).blocks[0];
  assert.equal(line(a, /^RWY/).text, 'RWY 16L: wind 200°T − 14.8°E = 185.2°M, runway 165.2°M, 20.0° apart.');
  assert.equal(line(a, /^Crosswind/).text, 'Crosswind 5.1 kt is within your 10 kt limit.');
  // 140 true is 125.2 magnetic, 40.0 degrees. 15 * sin(40) = 9.64 kt.
  const b = at(taf('14015KT P6SM SCT040'), 1, {}, rwy).blocks[0];
  assert.equal(line(b, /^RWY/).text, 'RWY 16L: wind 140°T − 14.8°E = 125.2°M, runway 165.2°M, 40.0° apart.');
  assert.equal(line(b, /^Crosswind/).text, 'Crosswind 9.6 kt is within your 10 kt limit.');
  // 270 true is 255.2 magnetic, 90.0 degrees. All 15 kt is crosswind.
  const c = at(taf('27015KT P6SM SCT040'), 1, {}, rwy).blocks[0];
  assert.match(line(c, /^RWY/).text, /270°T − 14\.8°E = 255\.2°M, runway 165\.2°M, 90\.0° apart\.$/);
  assert.equal(line(c, /^Crosswind/).text, 'Crosswind 15 kt exceeds your 10 kt limit.');
  // 100 true is 85.2 magnetic, 80.0 degrees. 15 * sin(80) = 14.77 kt.
  assert.equal(line(at(taf('10015KT P6SM SCT040'), 1, {}, rwy).blocks[0], /^Crosswind/).text, 'Crosswind 14.8 kt exceeds your 10 kt limit.');
});

test('west variation, KBOS 04L: the wind and the runway are both turned magnetic, and the numbers match the hand calculation', () => {
  const rwy = realRunway('KBOS', '04L');
  assert.deepEqual(rwy, { id: '04L', t: 20, variation: -13.9 });
  // Runway: 20 true + 13.9 west = 33.9 magnetic.
  // 090 true is 103.9 magnetic, 70.0 degrees. 20 kt * sin(70) = 18.79 kt.
  const a = at(taf('09020KT P6SM SCT040', 'KBOS'), 1, {}, rwy).blocks[0];
  assert.equal(line(a, /^RWY/).text, 'RWY 04L: wind 090°T + 13.9°W = 103.9°M, runway 033.9°M, 70.0° apart.');
  assert.equal(line(a, /^Crosswind/).text, 'Crosswind 18.8 kt exceeds your 10 kt limit.');
  // 340 true is 353.9 magnetic, which is 320.0 degrees past the runway, so 40.0 degrees. 20 * sin(40) = 12.86 kt.
  const b = at(taf('34020KT P6SM SCT040', 'KBOS'), 1, {}, rwy).blocks[0];
  assert.equal(line(b, /^RWY/).text, 'RWY 04L: wind 340°T + 13.9°W = 353.9°M, runway 033.9°M, 40.0° apart.');
  assert.equal(line(b, /^Crosswind/).text, 'Crosswind 12.9 kt exceeds your 10 kt limit.');
  // 020 true is the runway's own true alignment, so the wind is straight down the runway: no crosswind.
  const c = at(taf('02020KT P6SM SCT040', 'KBOS'), 1, {}, rwy).blocks[0];
  assert.match(line(c, /^RWY/).text, /020°T \+ 13\.9°W = 033\.9°M, runway 033\.9°M, 0\.0° apart\.$/);
  assert.equal(line(c, /^Crosswind/).text, 'Crosswind 0 kt is within your 10 kt limit.');
});

test('a TAF wind is never treated as already magnetic: the same numbers give different angles with and without variation', () => {
  const east = at(taf('20015KT P6SM SCT040'), 1, {}, realRunway('KSEA', '16L')).blocks[0];
  const noVar = at(taf('20015KT P6SM SCT040'), 1, {}, { id: '16L', t: 180, variation: 0 }).blocks[0];
  assert.match(line(east, /^RWY/).text, /20\.0° apart/);
  assert.match(line(noVar, /^RWY/).text, /20\.0° apart/);   // both ends move together, so the angle holds
  assert.match(line(noVar, /^RWY/).text, /^RWY 16L: wind 200°T − 0\.0°E = 200\.0°M, runway 180\.0°M/);
});

test('a runway with no FAA alignment says its painted number was used', () => {
  const b = at(taf('20015KT P6SM SCT040'), 1, {}, { id: '09', t: null, variation: 3 }).blocks[0];
  assert.match(line(b, /^FAA lists no alignment for RWY 09/).text, /approximate\.$/);
});

test('a variable wind and a wind with no direction count the full speed and gust as possible crosswind', () => {
  for (const [wind, because] of [['VRB12G22KT', 'variable wind'], ['///12G22KT', 'direction not reported']]) {
    for (const runway of [null, ksea16L]) {
      const b = at(taf(`${wind} P6SM SCT040`), 1, {}, runway).blocks[0];
      assert.equal(line(b, /^Crosswind could be/).text, `Crosswind could be the full 12 kt (${because}), within your 10 kt limit.`.replace('within', 'above'));
      assert.equal(line(b, /^Gust crosswind could be/).text, `Gust crosswind could be the full 22 kt (${because}), above your 10 kt limit.`);
    }
  }
});

test('a calm wind involves no wind limit', () => {
  assert.equal(line(at(taf('00000KT P6SM SCT040'), 1, {}, ksea16L).blocks[0], /^Calm wind/).status, 'info');
});

test('a wind in MPS or KMH is not checked, and says why', () => {
  for (const unit of ['MPS', 'KMH']) {
    const r = at(taf(`27008${unit} 9999 SCT040`), 1, {}, ksea16L);
    const l = line(r.blocks[0], /^Wind is reported in/);
    assert.equal(l.status, 'notChecked');
    assert.match(r.incomplete, new RegExp(`wind is reported in ${unit} and your limits are in knots`));
  }
});

test('a grid wind and an unreadable wind are not checked, and a later group that restates a good wind clears them', () => {
  const grid = at(taf('GRID30007KT 9999 SCT040'), 1, {}, ksea16L);
  assert.match(line(grid.blocks[0], /grid wind/).text, /^Wind is a grid wind \(GRID30007KT\), not referenced to true north/);
  assert.ok(!grid.blocks[0].lines.some((l) => /^Crosswind/.test(l.text)));
  const bad = taf('18010KT 9999 SCT040 TEMPO 0814/0818 1801OKT 3SM BR');
  const r = at(bad, 3, {}, ksea16L);
  assert.match(line(block(r, /^Temporarily/), /^Wind couldn't be read/).text, /wind and crosswind limits weren't checked/);
  assert.equal(line(block(r, /^Base forecast/), /^Crosswind/).status, 'within');
  const cleared = taf('GRID30007KT 9999 SCT040 FM081400 18010KT 9999 SCT040');
  assert.equal(line(at(cleared, 3, {}, ksea16L).blocks[0], /^Crosswind/).status, 'within');
});

test('a wind that is only a gust above the limit still shows the gust crosswind separately', () => {
  const b = at(taf('27010G25KT P6SM SCT040'), 1, {}, ksea16L).blocks[0];
  assert.equal(line(b, /^Crosswind/).status, 'at');            // 10 kt at 90 degrees, exactly at the 10 kt limit
  assert.equal(line(b, /^Gust crosswind/).status, 'exceeds');
  assert.equal(line(b, /^Gusts/).status, 'exceeds');
});

// ── Time
test('an hour outside the valid period has no check at all', () => {
  const p = taf('20012KT P6SM SCT040');
  assert.equal(site.tafMinimumsAtHour(p, -1, LIMITS, null, 'x'), null);
  assert.equal(site.tafMinimumsAtHour(p, 24, LIMITS, null, 'x'), null);
  assert.ok(site.tafMinimumsAtHour(p, 23, LIMITS, null, 'x'));
});

test('a TAF with no readable valid period has no hourly check', () => {
  const p = site.parseTaf('TAF KSEA 081130Z 20012KT P6SM SCT040');
  assert.equal(site.tafMinimumsAtHour(p, 0, LIMITS, null, 'x'), null);
  assert.deepEqual(Array.from(site.tafUnplacedGroups(p)), []);
});

// ── The words say forecast, never report
test('the forecast check says "forecast" and "stated", not "report" or "reported"', () => {
  const p = taf('P6SM ZZZZZ TEMPO 0814/0818 -RA');   // no wind, and an unreadable token
  const r = at(p, 3, {}, ksea16L);
  const all = r.blocks.flatMap((b) => texts(b)).concat(r.incomplete || '').join(' ');
  assert.doesNotMatch(all, /\breport\b|\breported\b/);
  assert.match(all, /Wind isn't stated|in this forecast/);
});

// ── The panel on the page, with a stand-in for the document
function panelWorld(parsed, saved, stationData = airports) {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, innerHTML: '', textContent: '', hidden: false, value: '', listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, setAttribute() {} });
  const storage = { getItem: () => (saved === undefined ? null : JSON.stringify(saved)) };
  const world = Object.assign(loadDecoders(), {
    document: { getElementById: (id) => (['taf-mins', 'taf-mins-label', 'taf-mins-runway-row', 'taf-mins-runway', 'taf-mins-incomplete', 'taf-mins-summary', 'taf-mins-blocks'].includes(id) ? el(id) : null) },
    window: { localStorage: storage },
    fetch: async () => ({ ok: true, json: async () => stationData }),
  });
  for (const file of ['js/wind-math.js', 'js/minimums-check.js', 'js/taf-minimums.js']) vm.runInContext(readRepoFile(file), world, { filename: file });
  return { world, els, el };
}
const read = (name) => vm.runInContext(name, site);   // const values are not properties of the context
const tick = () => new Promise((r) => setTimeout(r, 20));

test('with no saved minimums the panel says so and links to the builder, and compares nothing', () => {
  const { world, els } = panelWorld(null, undefined);
  world.tafMinimumsInit(world.parseTaf('TAF KSEA 081130Z 0812/0912 20012KT P6SM SCT040'));
  assert.match(els['taf-mins'].innerHTML, /No saved minimums yet\. Set them in the <a href="minimums\.html">Personal Minimums builder<\/a> to compare this forecast with your limits\./);
  assert.equal(els['taf-mins'].hidden, false);
});

test('the panel draws the hour, offers the airport runways, and redraws when the slider or runway changes', async () => {
  const { world, els } = panelWorld(null, { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18 });
  const parsed = world.parseTaf('TAF KSEA 081130Z 0812/0912 20012KT P6SM SCT040 TEMPO 0814/0818 2SM -RA');
  world.tafMinimumsInit(parsed);
  world.tafMinimumsUpdate(3);
  await tick();
  assert.equal(els['taf-mins-label'].textContent, 'Your minimums at D08 15:00Z');
  assert.equal(els['taf-mins-runway-row'].hidden, false);
  assert.match(els['taf-mins-runway'].innerHTML, /<option value="1">16L<\/option>|>16L</);
  assert.match(els['taf-mins-blocks'].innerHTML, /Base forecast/);
  assert.match(els['taf-mins-blocks'].innerHTML, /Temporarily/);
  assert.match(els['taf-mins-incomplete'].innerHTML, /no runway selected/i);
  // choose 16L
  const sel = els['taf-mins-runway'];
  const index = airports.airports.KSEA.r.flat().findIndex((e) => e[0] === '16L');
  sel.value = String(index);
  sel.listeners.change();
  assert.match(els['taf-mins-blocks'].innerHTML, /RWY 16L: wind 200°T − 14\.8°E = 185\.2°M, runway 165\.2°M, 20\.0° apart\./);
  assert.match(els['taf-mins-summary'].innerHTML, /Temporarily \(visibility\)/);
  // slider to an hour with nothing special
  world.tafMinimumsUpdate(1);
  assert.equal(els['taf-mins-label'].textContent, 'Your minimums at D08 13:00Z');
  assert.doesNotMatch(els['taf-mins-blocks'].innerHTML, /Temporarily/);
  assert.equal(els['taf-mins-summary'].hidden, true);
});

test('a station with no runway data says so as the reason crosswind was not checked', async () => {
  const { world, els } = panelWorld(null, { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18 });
  world.tafMinimumsInit(world.parseTaf('TAF CYEG 081130Z 0812/0912 20015KT P6SM SCT040'));
  world.tafMinimumsUpdate(1);
  await tick();
  assert.ok(!els['taf-mins-runway-row'], 'the runway row stays hidden for a station with no data');
  assert.match(els['taf-mins-incomplete'].innerHTML, /no runway data for cyeg/i);
});

test('the standing note for groups that cannot be placed is in the panel', async () => {
  const { world, els } = panelWorld(null, { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18 });
  world.tafMinimumsInit(world.parseTaf('TAF KSEA 081130Z 0812/0912 20015KT P6SM SCT040 TEMPO 2SM -RA'));
  assert.match(els['taf-mins'].innerHTML, /<strong>Not placed in time:<\/strong> Temporarily \(no readable valid time\)\./);
});

test('the slider calls the panel, and the decoder page loads it after the shared checks', () => {
  const slider = readRepoFile('js/taf-slider.js');
  assert.match(slider, /<div id="taf-mins" class="minimums-check taf-mins" hidden><\/div>/);
  assert.match(slider, /tafMinimumsInit\(parsed\)/);
  assert.match(slider, /tafMinimumsUpdate\(Number\(input\.value\)\)/);
  const page = readRepoFile('pages/decoder.html');
  const order = ['js/wind-math.js', 'js/minimums-check.js', 'js/taf-minimums.js'].map((f) => page.indexOf(f));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], order.join());
});

// ── No approval styling, and no em dashes
test('nothing in the panel is styled as a go or approval state', () => {
  const css = readRepoFile('css/main.css');
  const added = css.slice(css.indexOf('/* The minimums check on the TAF slider'));
  assert.doesNotMatch(added, /sage|green|#5d6f3c|#3a7d44|success|ok\b/i);
  const html = site.buildTafMinimumsBlocks(at(taf(FULL), 5, {}, ksea16L)) + readRepoFile('js/taf-minimums.js');
  assert.doesNotMatch(html, /class="[^"]*(green|go|pass|ok|safe)[^"]*"/i);
});

test('the words added for the forecast check have no em dashes', () => {
  const r = at(taf(FULL), 5, {}, ksea16L);
  const text = [
    ...r.blocks.flatMap((b) => [b.label, ...texts(b)]),
    r.incomplete || '', site.tafMinimumsSummary(r) || '',
    read('TAF_MINIMUMS_NOTE'),
    ...site.tafUnplacedGroups(taf('TEMPO 2SM -RA')),
    site.minimumsEmptyMessage('none', 'forecast'),
  ].join(' ');
  assert.doesNotMatch(text, /—/);
});
