// Personal minimums check tests. Run with: node --test
//
// Expected crosswinds were worked by hand from the runway's true alignment:
//   KSEA 16L true alignment 180, KSEA variation 14.8E
//   Wind 200T: 20 degrees off, sin = 0.342. 240T: 60 off, sin = 0.866. 270T: 90 off, sin = 1.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
for (const file of ['js/wind-math.js', 'js/minimums-check.js']) {
  vm.runInContext(readRepoFile(file), site, { filename: file });
}
const airports = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/data/airports-us.json'), 'utf8'));

const LIMITS = { ceiling: 2500, visibility: 5, crosswind: 10, wind: 15, gusts: 20, gustSpreadOn: false, gustSpread: null };
const limits = (over) => ({ ...LIMITS, ...over });
const metar = (body) => site.parseMetar(`METAR KSEA 031753Z ${body} 12/06 A3001`);
const GOOD = '10SM CLR';

const sea16L = { id: '16L', t: 180, variation: 14.8 };

const check = (body, over, runway, reason) =>
  [...site.checkMetarAgainstMinimums(metar(body), limits(over), runway === undefined ? null : runway, reason)]
    .map((l) => ({ status: l.status, text: l.text }));
const textOf = (lines, pattern) => {
  const line = lines.find((l) => pattern.test(l.text));
  assert.ok(line, `no line matching ${pattern}: ${lines.map((l) => l.text).join(' | ')}`);
  return line;
};
const noLine = (lines, pattern) =>
  assert.ok(!lines.some((l) => pattern.test(l.text)), lines.map((l) => l.text).join(' | '));

// ── Gusts: steady and gust crosswind, both shown, either can flag
test('both crosswind numbers show, and the gust alone can exceed', () => {
  const lines = check(`27005G15KT ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  // 270T is 90 degrees off a 180T runway: all of it is crosswind
  assert.deepEqual(textOf(lines, /^Crosswind /), { status: 'within', text: 'Crosswind 5 kt is within your 10 kt limit.' });
  assert.deepEqual(textOf(lines, /^Gust crosswind /), { status: 'exceeds', text: 'Gust crosswind 15 kt exceeds your 10 kt limit.' });
});

test('the steady crosswind can exceed too, and the gust is still shown', () => {
  const lines = check(`27014G18KT ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  assert.equal(textOf(lines, /^Crosswind /).status, 'exceeds');
  assert.equal(textOf(lines, /^Gust crosswind /).status, 'exceeds');
});

test('both within still shows both', () => {
  const lines = check(`20020G25KT ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  assert.deepEqual(textOf(lines, /^Crosswind /), { status: 'within', text: 'Crosswind 6.8 kt is within your 10 kt limit.' });
  assert.deepEqual(textOf(lines, /^Gust crosswind /), { status: 'within', text: 'Gust crosswind 8.6 kt is within your 10 kt limit.' });
});

test('no gust line when no gust is reported', () => {
  noLine(check(`20010KT ${GOOD}`, {}, sea16L), /Gust/);
});

// ── Boundaries exactly at each limit
test('crosswind exactly at the limit is at, not over', () => {
  const lines = check(`21020KT ${GOOD}`, { wind: 35 }, sea16L);   // 30 degrees off: 20 x 0.5 = 10
  assert.deepEqual(textOf(lines, /^Crosswind /), { status: 'at', text: 'Crosswind 10 kt is at your 10 kt limit.' });
});
test('crosswind just over the limit flags', () => {
  assert.equal(textOf(check(`21021KT ${GOOD}`, { wind: 35 }, sea16L), /^Crosswind /).status, 'exceeds');
});
test('crosswind just under the limit is within', () => {
  assert.equal(textOf(check(`21019KT ${GOOD}`, { wind: 35 }, sea16L), /^Crosswind /).status, 'within');
});
test('gust crosswind exactly at the limit is at', () => {
  const lines = check(`21015G20KT ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  assert.equal(textOf(lines, /^Gust crosswind /).status, 'at');
});

for (const [speed, status] of [[14, 'within'], [15, 'at'], [16, 'exceeds']]) {
  test(`sustained ${speed} kt against a 15 kt limit is ${status}`, () => {
    assert.equal(textOf(check(`${String(180).padStart(3, '0')}${speed}KT ${GOOD}`), /^Sustained wind /).status, status);
  });
}
for (const [gust, status] of [[19, 'within'], [20, 'at'], [21, 'exceeds']]) {
  test(`gusts ${gust} kt against a 20 kt limit are ${status}`, () => {
    assert.equal(textOf(check(`18010G${gust}KT ${GOOD}`), /^Gusts /).status, status);
  });
}
for (const [height, status] of [['024', 'exceeds'], ['025', 'at'], ['026', 'within']]) {
  test(`ceiling ${height}00 against a 2,500 ft minimum is ${status}`, () => {
    assert.equal(textOf(check(`18005KT 10SM BKN${height}`), /^Ceiling /).status, status);
  });
}
for (const [vis, status] of [['4SM', 'exceeds'], ['5SM', 'at'], ['6SM', 'within']]) {
  test(`visibility ${vis} against a 5 SM minimum is ${status}`, () => {
    assert.equal(textOf(check(`18005KT ${vis} CLR`), /^Visibility /).status, status);
  });
}

test('a saved limit of 0 is a real limit', () => {
  assert.equal(textOf(check(`18001KT ${GOOD}`, { wind: 0 }), /^Sustained wind /).status, 'exceeds');
});

// ── Variable direction: worst case across the range, and say so
test('variable sector crossing square to the runway uses the full wind', () => {
  // Sector 240 to 300 true includes 270, which is 90 degrees off a 180T runway
  const lines = check(`27015KT 240V300 ${GOOD}`, { wind: 35 }, sea16L);
  assert.deepEqual(textOf(lines, /^Worst-case crosswind /), { status: 'exceeds', text: 'Worst-case crosswind 15 kt exceeds your 10 kt limit.' });
  assert.match(textOf(lines, /worst case across that range/).text, /240° to 300° true/);
  noLine(lines, /^Crosswind /);
});

test('variable sector that never reaches square uses the far end', () => {
  // 150 to 210 true, runway 180T: the far ends are 30 degrees off, sin = 0.5
  const lines = check(`18015KT 150V210 ${GOOD}`, {}, sea16L);
  assert.deepEqual(textOf(lines, /^Worst-case crosswind /), { status: 'within', text: 'Worst-case crosswind 7.5 kt is within your 10 kt limit.' });
});

test('a sector exactly at the limit is at', () => {
  // 20 kt at 30 degrees off is exactly 10
  assert.equal(textOf(check(`18020KT 150V210 ${GOOD}`, { wind: 35 }, sea16L), /^Worst-case crosswind /).status, 'at');
});

test('variable sector also checks the gust', () => {
  const lines = check(`18015G25KT 150V210 ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  assert.deepEqual(textOf(lines, /^Worst-case gust crosswind /), { status: 'exceeds', text: 'Worst-case gust crosswind 12.5 kt exceeds your 10 kt limit.' });
});

test('a sector across north is handled', () => {
  // 340 to 020 true, runway 090T: 360 is square to it
  const lines = check(`36010KT 340V020 ${GOOD}`, {}, { id: '09', t: 90, variation: 14.8 });
  assert.equal(textOf(lines, /^Worst-case crosswind /).text, 'Worst-case crosswind 10 kt is at your 10 kt limit.');
});

test('square-on wind inside a sector counts even when neither end nor the reported direction is square', () => {
  // Runway 180T. Sector 240 to 300 passes through 270, reported 250.
  assert.equal(site.worstCrosswindFactor(240, 300, 250, 180), 1);
  const lines = check(`25015KT 240V300 ${GOOD}`, { wind: 35 }, sea16L);
  assert.equal(textOf(lines, /^Worst-case crosswind /).text, 'Worst-case crosswind 15 kt exceeds your 10 kt limit.');
});

test('the far end of a sector counts whichever side it falls on', () => {
  assert.equal(site.worstCrosswindFactor(150, 210, 180, 180).toFixed(3), '0.500');
  assert.equal(site.worstCrosswindFactor(240, 300, 270, 180), 1);
  assert.equal(site.worstCrosswindFactor(100, 120, 110, 0).toFixed(3), '0.985');
  assert.equal(site.worstCrosswindFactor(80, 100, 90, 0), 1);
});

test('a variable sector with no runway stays unchecked for crosswind', () => {
  const lines = check(`18015KT 150V210 ${GOOD}`);
  textOf(lines, /Crosswind wasn't checked/);
  noLine(lines, /Worst-case/);
});

// ── Notes that explain lines sit directly above them
const ordered = (body, over, runway) =>
  [...site.orderMinimumsLines(site.checkMetarAgainstMinimums(metar(body), limits(over), runway === undefined ? null : runway))]
    .map((l) => l.text);
const indexOf = (lines, pattern) => {
  const i = lines.findIndex((t) => pattern.test(t));
  assert.notEqual(i, -1, `no line matching ${pattern}: ${lines.join(' | ')}`);
  return i;
};

test('the sector note is directly above the worst-case lines when all are within', () => {
  const lines = ordered(`18015KT 150V210 ${GOOD}`, { wind: 35 }, sea16L);
  assert.equal(indexOf(lines, /worst case across/) + 1, indexOf(lines, /^Worst-case crosswind /));
});

test('the sector note stays above the first worst-case line when that line is split by status', () => {
  // Gust crosswind exceeds and sorts high. Steady crosswind is within and sorts low.
  const lines = ordered(`18014G26KT 150V210 ${GOOD}`, { wind: 35, gusts: 35 }, sea16L);
  const note = indexOf(lines, /worst case across/);
  assert.equal(note + 1, indexOf(lines, /^Worst-case gust crosswind /));
  assert.ok(note < indexOf(lines, /^Worst-case crosswind /));
});

test('the sector note rises with its lines when they exceed, above an unrelated within line', () => {
  const lines = ordered(`27015KT 240V300 ${GOOD}`, { wind: 35 }, sea16L);
  assert.ok(indexOf(lines, /worst case across/) < indexOf(lines, /^Sustained wind /));
  assert.equal(indexOf(lines, /worst case across/), 0);
});

test('the VRB explanation is directly above the total wind line', () => {
  const lines = ordered(`VRB06KT ${GOOD}`);
  assert.equal(indexOf(lines, /no fixed direction/) + 1, indexOf(lines, /^Total wind /));
});

test('the VRB explanation stays above both lines when the gust alone exceeds', () => {
  const lines = ordered(`VRB06G14KT ${GOOD}`, { gusts: 35 });
  const note = indexOf(lines, /no fixed direction/);
  assert.equal(note + 1, indexOf(lines, /^Total gust wind /));
  assert.ok(note < indexOf(lines, /^Total wind /));
});

test('other lines still sort most urgent first', () => {
  const lines = ordered('18015KT 150V210 3SM BKN030', { wind: 35 }, sea16L);
  assert.ok(indexOf(lines, /^Visibility 3 SM is below/) < indexOf(lines, /^Ceiling 3,000 ft is above/));
});

test('the rendered list uses this order', () => {
  const html = site.buildMinimumsLines(site.checkMetarAgainstMinimums(metar(`VRB06KT ${GOOD}`), limits(), null));
  assert.ok(html.indexOf('no fixed direction') < html.indexOf('Total wind 6 kt'));
});

// ── VRB: no runway-relative crosswind
test('VRB explains why and compares total wind with the crosswind limit', () => {
  const lines = check(`VRB06KT ${GOOD}`);
  assert.match(textOf(lines, /no fixed direction/).text, /can't be calculated/);
  assert.deepEqual(textOf(lines, /^Total wind /), { status: 'within', text: 'Total wind 6 kt is within your 10 kt limit.' });
});
test('VRB at the limit and over it', () => {
  assert.equal(textOf(check(`VRB10KT ${GOOD}`), /^Total wind /).status, 'at');
  assert.equal(textOf(check(`VRB11KT ${GOOD}`), /^Total wind /).status, 'exceeds');
});
test('VRB checks its gust against the crosswind limit too', () => {
  const lines = check(`VRB06G14KT ${GOOD}`);
  assert.equal(textOf(lines, /^Total gust wind /).status, 'exceeds');
});
test('VRB gives the same answer with or without a runway', () => {
  const without = check(`VRB06KT ${GOOD}`);
  const withRunway = check(`VRB06KT ${GOOD}`, {}, sea16L);
  assert.deepEqual(withRunway, without);
  noLine(without, /Crosswind wasn't checked/);
});

// ── Calm
test('calm has no wind warning', () => {
  for (const runway of [null, sea16L]) {
    const lines = check(`00000KT ${GOOD}`, { wind: 0, gusts: 0, crosswind: 0 }, runway);
    textOf(lines, /^Calm wind/);
    noLine(lines, /Sustained|Crosswind|crosswind|Gust/);
    assert.ok(!lines.some((l) => l.status === 'exceeds'));
  }
});
test('VRB00KT is calm too', () => {
  textOf(check(`VRB00KT ${GOOD}`), /^Calm wind/);
});

// ── No runway
test('no runway checks total wind and gusts and says crosswind was not checked', () => {
  const lines = check(`27014G22KT ${GOOD}`);
  assert.deepEqual(textOf(lines, /Crosswind wasn't checked/), {
    status: 'notChecked',
    text: 'No runway selected. Crosswind wasn\'t checked. Total wind and gusts were.',
  });
  textOf(lines, /^Sustained wind /);
  textOf(lines, /^Gusts /);
  noLine(lines, /^Crosswind /);
  noLine(lines, /^Gust crosswind /);
});
test('a foreign airport says why it has no runway', () => {
  const lines = check(`27014KT ${GOOD}`, {}, null, 'No runway data for EGLL, because only US airports with an ICAO ID are included.');
  textOf(lines, /^No runway data for EGLL.* Crosswind wasn't checked/);
});

// ── Runway with no alignment
test('a runway with no FAA alignment says it is approximate', () => {
  const lines = check(`27010KT ${GOOD}`, {}, { id: '09', t: null, variation: 14.8 });
  textOf(lines, /FAA lists no alignment for RWY 09/);
  textOf(lines, /^Crosswind /);
});

// ── Wind that can't be compared
test('missing wind is not checked', () => {
  textOf(check(`/////KT ${GOOD}`), /Wind isn't reported/);
});
test('wind in another unit is not checked rather than converted silently', () => {
  textOf(check(`18010MPS ${GOOD}`), /reported in MPS/);
});

// ── Ceiling and visibility edge cases
test('clear sky has no ceiling to compare', () => {
  assert.equal(textOf(check(`18005KT ${GOOD}`), /No ceiling reported/).status, 'within');
});
test('missing sky is not checked', () => {
  assert.equal(textOf(check('18005KT 10SM'), /Ceiling wasn't checked/).status, 'notChecked');
});
test('BKN/// is not checked', () => {
  assert.equal(textOf(check('18005KT 10SM BKN///'), /Ceiling wasn't checked/).status, 'notChecked');
});
test('a known low ceiling beside an unknown layer still flags', () => {
  assert.equal(textOf(check('18005KT 10SM OVC010 //////CB'), /^Ceiling 1,000/).status, 'exceeds');
});
test('a garbled group blocks a "within" ceiling claim', () => {
  assert.equal(textOf(check('18005KT 10SM SCT040 XXX'), /Ceiling wasn't checked/).status, 'notChecked');
});
test('missing visibility is not checked', () => {
  assert.equal(textOf(check('18005KT ////SM CLR'), /Visibility wasn't checked/).status, 'notChecked');
});
test('P6SM meets a limit it can confirm, and only those', () => {
  assert.equal(textOf(check('18005KT P6SM CLR', { visibility: 6 }), /^Visibility P6SM/).status, 'within');
  assert.equal(textOf(check('18005KT P6SM CLR', { visibility: 8 }), /^Visibility P6SM/).status, 'notChecked');
});
test('9999 and CAVOK meet about 6 SM and no more', () => {
  assert.equal(textOf(check('18005KT 9999 CLR', { visibility: 6 }), /^Visibility 9999/).status, 'within');
  assert.equal(textOf(check('18005KT 9999 CLR', { visibility: 7 }), /^Visibility 9999/).status, 'notChecked');
  assert.equal(textOf(check('18005KT CAVOK', { visibility: 7 }), /^Visibility CAVOK/).status, 'notChecked');
});
// Metric visibility uses the exact distance here (meters / 1609.344). 1 SM is 1609.344 m, so
// 3 SM is 4828.032 m, 4 SM is 6437.376 m, 5 SM is 8046.72 m, and 6 SM is 9656.064 m.
for (const [meters, limit, status, text] of [
  [6000, 4, 'exceeds', 'Visibility 6000 m (3.7 SM) is below your 4 SM minimum.'],
  [6000, 3, 'within', 'Visibility 6000 m (3.7 SM) is above your 3 SM minimum.'],
  [4800, 3, 'exceeds', 'Visibility 4800 m (2.98 SM) is below your 3 SM minimum.'],
  [4828, 3, 'exceeds', 'Visibility 4828 m (2.99998 SM) is below your 3 SM minimum.'],
  [4829, 3, 'within', 'Visibility 4829 m (3.001 SM) is above your 3 SM minimum.'],
  [6437, 4, 'exceeds', 'Visibility 6437 m (3.9998 SM) is below your 4 SM minimum.'],
  [6438, 4, 'within', 'Visibility 6438 m (4.0004 SM) is above your 4 SM minimum.'],
  [8000, 5, 'exceeds', 'Visibility 8000 m (4.97 SM) is below your 5 SM minimum.'],
  [8046, 5, 'exceeds', 'Visibility 8046 m (4.9996 SM) is below your 5 SM minimum.'],
  [8047, 5, 'within', 'Visibility 8047 m (5.0002 SM) is above your 5 SM minimum.'],
  [9000, 6, 'exceeds', 'Visibility 9000 m (5.6 SM) is below your 6 SM minimum.'],
  [9656, 6, 'exceeds', 'Visibility 9656 m (5.99996 SM) is below your 6 SM minimum.'],
  [9657, 6, 'within', 'Visibility 9657 m (6.001 SM) is above your 6 SM minimum.'],
]) {
  test(`${meters} m against ${limit} SM is ${status}, using the exact distance`, () => {
    assert.deepEqual(textOf(check(`18005KT ${meters} CLR`, { visibility: limit }), /^Visibility /), { status, text });
  });
}

test('flight category keeps the reportable table while the limit check uses the exact distance', () => {
  // 6000 m is 4 SM in the table, MVFR either way. 8000 m is 5 SM in the table, so MVFR, and
  // 9000 m is 6 SM, so VFR. The limit check on the same report still reads 3.7 SM.
  const six = metar('18005KT 6000 CLR');
  assert.equal(six.flightCategory, 'MVFR');
  assert.equal(site.metersToSM(6000), 4);
  assert.equal(site.metersToSM(9000), 6);
  assert.equal(site.metersToSM(4800), 3);
  assert.equal(metar('18005KT 4800 CLR').flightCategory, 'MVFR', 'the table keeps 4800 m out of IFR');
  assert.equal(metar('18005KT 1600 CLR').flightCategory, 'IFR', 'the table keeps 1600 m out of LIFR');
  assert.equal(metar('18005KT 9000 CLR').flightCategory, 'VFR');
  assert.equal(textOf(check('18005KT 6000 CLR', { visibility: 4 }), /^Visibility /).status, 'exceeds');
});

test('statute mile reports are unaffected by the metric conversion', () => {
  assert.equal(textOf(check('18005KT 4SM CLR', { visibility: 4 }), /^Visibility /).text, 'Visibility 4 SM is at your 4 SM minimum.');
});

// ── Gust spread: optional and off by default
test('gust spread is ignored when off, even with a saved value', () => {
  noLine(check(`18005G25KT ${GOOD}`, { gustSpreadOn: false, gustSpread: 5 }), /Gust spread/);
});
for (const [gust, status] of [[14, 'within'], [15, 'at'], [16, 'exceeds']]) {
  test(`gust spread with 5G${gust} against a 10 kt limit is ${status}`, () => {
    const lines = check(`18005G${gust}KT ${GOOD}`, { gustSpreadOn: true, gustSpread: 10 });
    assert.equal(textOf(lines, /^Gust spread /).status, status);
  });
}
test('no gust means no gust spread line', () => {
  noLine(check(`18005KT ${GOOD}`, { gustSpreadOn: true, gustSpread: 10 }), /Gust spread/);
});

// ── Saved profile
const store = (value) => ({ getItem: () => value });
const OLD_PROFILE = { ceiling: '2500', visibility: '5', 'ifr-ceiling': '200', 'ifr-vis': '0.25', crosswind: '10', wind: '15', gusts: '20', convective: '20', 'night-vfr': false, imc: false };

test('no saved profile is reported, and no defaults are invented', () => {
  assert.deepEqual({ ...site.readMinimums(store(null)) }, { status: 'none' });
});
test('corrupt or wrong-shaped data is invalid', () => {
  assert.equal(site.readMinimums(store('{oops')).status, 'invalid');
  assert.equal(site.readMinimums(store('[1,2]')).status, 'invalid');
  assert.equal(site.readMinimums(store('null')).status, 'invalid');
});
test('blocked storage is reported', () => {
  assert.equal(site.readMinimums({ getItem() { throw new Error('denied'); } }).status, 'unavailable');
});
test('an existing profile reads as numbers, with gust spread off', () => {
  const { status, limits: read } = site.readMinimums(store(JSON.stringify(OLD_PROFILE)));
  assert.equal(status, 'ok');
  assert.deepEqual({ ...read }, { ceiling: 2500, visibility: 5, crosswind: 10, wind: 15, gusts: 20, gustSpreadOn: false, gustSpread: null });
});
test('gust spread needs its toggle on', () => {
  const off = site.readMinimums(store(JSON.stringify({ ...OLD_PROFILE, 'gust-spread': '8', 'gust-spread-on': false })));
  assert.equal(off.limits.gustSpread, null);
  const on = site.readMinimums(store(JSON.stringify({ ...OLD_PROFILE, 'gust-spread': '8', 'gust-spread-on': true })));
  assert.equal(on.limits.gustSpread, 8);
});
test('a missing or bad limit is null, and the check says not checked', () => {
  const partial = { ...OLD_PROFILE };
  delete partial.crosswind;
  partial.wind = 'abc';
  const { limits: read } = site.readMinimums(store(JSON.stringify(partial)));
  assert.equal(read.crosswind, null);
  assert.equal(read.wind, null);
  const lines = [...site.checkMetarAgainstMinimums(metar(`20020KT ${GOOD}`), read, sea16L)];
  assert.equal(textOf(lines, /^Crosswind /).status, 'notChecked');
  assert.equal(textOf(lines, /^Sustained wind /).status, 'notChecked');
});

// ── Real airport data, end to end
test('KSEA 16L from the data file gives the same crosswind as the calculator', () => {
  const airport = site.findAirport(airports, 'KSEA');
  const end = airport.r.flat().find((e) => e[0] === '16L');
  const lines = check(`20020KT ${GOOD}`, { wind: 35 }, { id: end[0], t: end[1], variation: airport.v });
  assert.equal(textOf(lines, /^Crosswind /).text, 'Crosswind 6.8 kt is within your 10 kt limit.');
  textOf(lines, /200°T − 14\.8°E = 185\.2°M, runway 165\.2°M, 20\.0° apart/);
});

// ── Wording
test('nothing says go, safe, or approved, in any case', () => {
  const reports = [`20020G30KT ${GOOD}`, `VRB05KT ${GOOD}`, `00000KT ${GOOD}`, '18015KT 150V210 3SM BKN010', `20005KT ${GOOD}`];
  for (const body of reports) {
    for (const runway of [null, sea16L]) {
      for (const line of check(body, {}, runway)) {
        assert.doesNotMatch(line.text, /\b(go|no-go|safe|unsafe|ok|okay|approved|cleared|good|legal|should|recommend)\b/i, line.text);
      }
    }
  }
  assert.match(vm.runInContext('MINIMUMS_NOTE', site), /supports your decision and doesn't make it/);
});

test('every line has a text tag, so status never relies on color alone', () => {
  const html = site.buildMinimumsLines(check(`27014G22KT 3SM BKN010`, {}, sea16L));
  assert.match(html, /Outside limit/);
  assert.equal((html.match(/<li /g) || []).length, (html.match(/mins-tag/g) || []).length);
});

test('report text is escaped', () => {
  const html = site.buildMinimumsLines([{ status: 'notChecked', text: '<img src=x>' }]);
  assert.doesNotMatch(html, /<img/);
});

// ── Page wiring and builder
test('the decoder loads the check and has a place for it', () => {
  const page = readRepoFile('pages/decoder.html');
  assert.match(page, /js\/wind-math\.js/);
  assert.match(page, /js\/minimums-check\.js/);
  assert.match(page, /id="minimums-check"/);
});

test('the builder keeps its storage key and its gust spread starts off', () => {
  const page = readRepoFile('pages/minimums.html');
  assert.match(page, /crosswindwx_minimums_v2/);
  assert.match(page, /<input type="checkbox" id="gust-spread-on">/);
  assert.match(page, /<input type="range" id="gust-spread"/);
});
