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
for (const [meters, limit, status] of [[4800, 3, 'at'], [8000, 5, 'at'], [6000, 4, 'at'], [9000, 6, 'at'], [4800, 5, 'exceeds']]) {
  test(`${meters} m against ${limit} SM is ${status}, using the reportable table`, () => {
    assert.equal(textOf(check(`18005KT ${meters} CLR`, { visibility: limit }), /^Visibility /).status, status);
  });
}

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
