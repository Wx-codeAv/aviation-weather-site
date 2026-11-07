// TAF decoder tests. Run with: node --test
//
// Expected values were worked out by hand from these rules, not copied from the code:
//   FM:    "all forecast conditions given before the FMYYGGgg group are superseded" (NWSI 10-813 B2.9.2)
//   BECMG: "omitted conditions are carried over from the previous time group" (AIM 7-1-29)
//   TEMPO: an element with no stated change "is understood to remain the same" (NWSI 10-813 B2.9.3)
//   PROB:  associated conditions overlay the prevailing forecast (NWSI 10-813 B2.9.4)
// Group end times are exclusive: a group ending at 07Z is not active at 07Z.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecoders, readRepoFile } = require('./load-site');
const { REAL_TAFS, SCOPED_CASES, at } = require('./fixtures/taf-cases');

const site = loadDecoders();

const elementText = (state) => [
  state.wind && state.wind.raw,
  state.visibility && state.visibility.raw,
  ...state.weather.map((w) => w.raw),
  ...state.sky.map((s) => s.raw),
].filter(Boolean).join(' ');

test('the scoped list has all 23 cases', () => assert.equal(SCOPED_CASES.length, 23));

for (const [key, name, time, prevailing, category, active] of SCOPED_CASES) {
  test(`${key} ${String(time.day).padStart(2, '0')}${String(time.hour).padStart(2, '0')}${time.min ? String(time.min).padStart(2, '0') : ''}Z: ${name}`, () => {
    const state = site.tafStateAt(site.parseTaf(REAL_TAFS[key]), time);
    assert.equal(elementText(state.prevailing), prevailing);
    assert.equal(state.prevailing.category, category);
    const seen = [...state.transitions, ...state.overlays]
      .map((o) => [o.type, elementText(o.state), o.state.category]);
    assert.deepEqual(seen, active);
  });
}

// ── Regression: the 14 change groups that showed VFR on the live site on 2026-11-03.
// Each was checked by hand against its TAF. All 14 sit under a ceiling of 3,000 ft or less.
const fixture = readRepoFile('tests/fixtures/tafs-2026-11-03.txt').trim().split(/\r?\n/);
const fromFixture = (station) => {
  const found = fixture.find((line) => line.startsWith(`TAF ${station} `) || line.startsWith(`TAF AMD ${station} `));
  assert.ok(found, `${station} is missing from the fixture`);
  return found;
};

const WRONG_BADGES = [
  ['CYHZ', 'BECMG', 3, 9, 'BKN030 from FM030800'],
  ['CYYZ', 'BECMG', 3, 14, 'BKN030 from FM031400'],
  ['EDDM', 'BECMG', 3, 7, 'OVC025 from base'],
  ['EDDM', 'BECMG', 3, 16, 'OVC025 from base'],
  ['EIDW', 'BECMG', 3, 6, 'BKN022 from base'],
  ['EIDW', 'BECMG', 3, 10, 'BKN022 from base'],
  ['EIDW', 'BECMG', 3, 18, 'BKN022 from base'],
  ['KSUU', 'TEMPO', 3, 13, 'BKN020 from BECMG 0310/0311'],
  ['LOWW', 'TEMPO', 3, 3, 'BKN025 from base'],
  ['LOWW', 'PROB30 TEMPO', 3, 12, 'BKN025 from base'],
  ['LOWW', 'BECMG', 3, 16, 'BKN025 from base'],
  ['LSZH', 'PROB30 TEMPO', 3, 3, 'OVC020 from base'],
  ['OMDB', 'BECMG', 3, 6, '6000 m from base'],
  ['OMDB', 'BECMG', 3, 16, '6000 m from base'],
];

test('the regression list has all 14 groups', () => assert.equal(WRONG_BADGES.length, 14));

for (const [station, type, day, hour, why] of WRONG_BADGES) {
  test(`regression ${station} ${type} ${day}/${hour}Z shows MVFR, not VFR (${why})`, () => {
    const group = site.parseTaf(fromFixture(station)).groups
      .find((g) => g.type === type && g.validFrom && g.validFrom.day === day && g.validFrom.hour === hour);
    assert.ok(group, 'group not found');
    assert.equal(group.flightCategory, 'MVFR');
  });
}

// ── Inheritance per group type
const BASE = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BR BKN020';
const CHANGE_TYPES = ['TEMPO', 'BECMG', 'PROB30', 'PROB40', 'PROB30 TEMPO', 'PROB40 TEMPO', 'INTER'];
const ONE_ELEMENT_CHANGES = [
  ['wind', '25015G25KT', '25015G25KT 5SM BR BKN020', 'MVFR'],
  ['visibility', '2SM', '18010KT 2SM BR BKN020', 'IFR'],
  ['weather', '-RA', '18010KT 5SM -RA BKN020', 'MVFR'],
  ['sky', 'OVC008', '18010KT 5SM BR OVC008', 'IFR'],
];

const activeChange = (state) => [...state.transitions, ...state.overlays][0];

for (const type of CHANGE_TYPES) {
  for (const [element, change, expected, category] of ONE_ELEMENT_CHANGES) {
    test(`${type} that restates only ${element} inherits everything else`, () => {
      const parsed = site.parseTaf(`${BASE} ${type} 0116/0118 ${change}`);
      const active = activeChange(site.tafStateAt(parsed, at(1, 17)));
      assert.equal(active.type, type);
      assert.equal(elementText(active.state), expected);
      assert.equal(active.state.category, category);
      assert.equal(parsed.groups[1].flightCategory, category, 'the group card badge must match');
    });
  }
}

test('NSW clears inherited weather and nothing else', () => {
  const parsed = site.parseTaf(`${BASE} TEMPO 0116/0118 NSW`);
  const active = activeChange(site.tafStateAt(parsed, at(1, 17)));
  assert.equal(elementText(active.state), '18010KT 5SM BKN020');
});

test('FM replaces the full forecast and inherits nothing', () => {
  const state = site.tafStateAt(site.parseTaf(`${BASE} FM011600 25015KT P6SM SKC`), at(1, 17));
  assert.equal(elementText(state.prevailing), '25015KT P6SM SKC');
  assert.equal(state.prevailing.category, 'VFR');
});

test('FM that omits elements does not inherit them, and shows no category instead of guessing', () => {
  const parsed = site.parseTaf(`${BASE} FM011600 25015KT`);
  const state = site.tafStateAt(parsed, at(1, 17));
  assert.equal(elementText(state.prevailing), '25015KT');
  assert.equal(state.prevailing.category, null);
  assert.equal(parsed.groups[1].flightCategory, null);
  assert.ok(parsed.warnings.some((w) => /visibility and sky/.test(w)), 'must warn the reader');
});

test('FM discards an earlier finished BECMG', () => {
  const parsed = site.parseTaf(`${BASE} BECMG 0114/0115 OVC004 FM011600 25015KT P6SM SKC`);
  assert.equal(site.tafStateAt(parsed, at(1, 15)).prevailing.category, 'LIFR');
  assert.equal(elementText(site.tafStateAt(parsed, at(1, 16)).prevailing), '25015KT P6SM SKC');
});

test('FM discards an earlier BECMG still in its window', () => {
  const parsed = site.parseTaf(`${BASE} BECMG 0115/0118 OVC004 FM011600 25015KT P6SM SKC`);
  assert.equal(site.tafStateAt(parsed, at(1, 15)).transitions.length, 1);
  assert.equal(site.tafStateAt(parsed, at(1, 16)).transitions.length, 0);
});

test('FM discards an earlier TEMPO that would otherwise still be active', () => {
  const parsed = site.parseTaf(`${BASE} TEMPO 0114/0120 2SM FM011600 25015KT P6SM SKC`);
  assert.equal(site.tafStateAt(parsed, at(1, 15)).overlays.length, 1);
  assert.equal(site.tafStateAt(parsed, at(1, 16)).overlays.length, 0);
});

test('a BECMG result persists, while TEMPO and PROB do not change prevailing', () => {
  for (const type of ['TEMPO', 'PROB30', 'PROB40 TEMPO', 'INTER']) {
    const parsed = site.parseTaf(`${BASE} ${type} 0114/0115 OVC004`);
    assert.equal(elementText(site.tafStateAt(parsed, at(1, 20)).prevailing), '18010KT 5SM BR BKN020', type);
  }
  const parsed = site.parseTaf(`${BASE} BECMG 0114/0115 OVC004`);
  assert.equal(elementText(site.tafStateAt(parsed, at(1, 20)).prevailing), '18010KT 5SM BR OVC004');
});

test('a minute-precise FM takes effect at its minute, not at the top of the hour', () => {
  const parsed = site.parseTaf(`${BASE} FM011830 25015KT P6SM SKC`);
  assert.equal(site.tafStateAt(parsed, at(1, 18)).prevailing.wind.raw, '18010KT');
  assert.equal(site.tafStateAt(parsed, at(1, 18, 29)).prevailing.wind.raw, '18010KT');
  assert.equal(site.tafStateAt(parsed, at(1, 18, 30)).prevailing.wind.raw, '25015KT');
});

test('a time outside the valid period has no state', () => {
  const parsed = site.parseTaf(BASE);
  assert.equal(site.tafStateAt(parsed, at(1, 11)), null);
  assert.equal(site.tafStateAt(parsed, at(2, 12)), null, 'the end of the valid period is exclusive');
});

// ── Parser fixes
test('every split fractional visibility survives, not only the first', () => {
  const parsed = site.parseTaf('TAF KXXX 011130Z 0112/0212 18010KT 1 1/2SM BR OVC006 TEMPO 0114/0116 2 1/2SM BR OVC008 TEMPO 0118/0120 1 3/4SM BR OVC007');
  assert.deepEqual([...parsed.groups].map((g) => g.visibility.raw), ['1 1/2SM', '2 1/2SM', '1 3/4SM']);
  assert.deepEqual([...parsed.groups].map((g) => g.sky[0].raw), ['OVC006', 'OVC008', 'OVC007']);
});

// ── Metric visibility: AFMAN 15-111 Table 8.1 (statute miles to reportable meters)
const CLEAR = [{ cover: 'SKC', height: null, cb: null }];
const metric = (value) => site.deriveFlightCategory({ sky: CLEAR, visibility: { unit: 'm', value } });
const statute = (value) => site.deriveFlightCategory({ sky: CLEAR, visibility: { unit: 'SM', value } });

for (const [meters, miles] of [[800, 0.5], [1400, 0.875], [1600, 1], [2400, 1.5], [3200, 2], [4400, 2.75], [4800, 3], [6000, 4], [8000, 5], [9000, 6]]) {
  test(`${meters} m gets the same category as its table value, ${miles} SM`, () => {
    assert.equal(metric(meters), statute(miles));
  });
}

test('9999 m is VFR on visibility', () => assert.equal(metric(9999), 'VFR'));

// ── Month rollover: a TAF has no month, so the length comes from the 30-hour limit
for (const [from, to, hours] of [['1518', '1624', 30], ['3018', '0124', 30], ['3118', '0124', 30], ['2818', '0100', 30], ['2812', '0106', 18], ['3000', '0100', 24]]) {
  test(`valid period ${from}/${to} is ${hours} hours long`, () => {
    const parsed = site.parseTaf(`TAF KXXX 011130Z ${from}/${to} 18010KT P6SM SKC`);
    assert.equal(site.tafTimeBase(parsed).dur, hours);
  });
}

test('a 30-day month places a 6-hour point at 20% of the band', () => {
  const html = site.buildTafOverview(site.parseTaf('TAF KABC 301730Z 3018/0124 32012KT P6SM SKC FM010000 32012KT P6SM BKN020'));
  assert.match(html, /tl-seg" style="left:20\.00%;width:80\.00%/);
});

test('an impossible valid period warns instead of drawing a timeline', () => {
  const parsed = site.parseTaf('TAF KABC 011130Z 0112/0512 18010KT P6SM SKC');
  assert.equal(site.tafTimeBase(parsed), null);
  assert.ok(parsed.warnings.some((w) => /valid period/i.test(w)));
  assert.equal(site.buildTafOverview(parsed), '');
});

// ── Timeline band
test('BECMG changes the prevailing band after its window ends', () => {
  const html = site.buildTafOverview(site.parseTaf('TAF EGXX 151730Z 1518/1624 32012KT 9999 SCT040 BECMG 1600/1602 4000 BR BKN005'));
  assert.match(html, /tl-seg" style="left:0\.00%;width:26\.67%[^>]*title="VFR /);
  assert.match(html, /tl-seg" style="left:26\.67%;width:73\.33%[^>]*title="IFR /);
});

test('a band with no known category is not painted VFR', () => {
  const html = site.buildTafOverview(site.parseTaf('TAF KXXX 011130Z 0112/0212 18010KT'));
  assert.doesNotMatch(html, /title="VFR /);
  assert.match(html, /tl-seg--unknown/);
});

// ── A wide net over all 92 real TAFs
test('all 92 real TAFs parse, and every group gets a placed time and a category', () => {
  assert.equal(fixture.length, 92);
  for (const raw of fixture) {
    const parsed = site.parseTaf(raw);
    assert.ok(parsed.station, raw);
    assert.ok(site.tafTimeBase(parsed), `no time base: ${raw}`);
    // The only groups without a category are the final FM groups of two Navy TAFs (KNGU, KNTU),
    // which end in an FN##### group we can't place. It is not known to be harmless, so no category.
    const without = [...parsed.groups].filter((g) => !g.flightCategory);
    assert.ok(without.every((g) => /^FN\d{5}$/.test(g.unreadable)), raw);
    assert.equal(without.length, ['KNGU', 'KNTU'].includes(parsed.station) ? 1 : 0, raw);
    if (without.length) {
      assert.equal(parsed.warnings.length, 1, raw);
      assert.match(parsed.warnings[0], /Couldn't read FN\d{5} in the From group/);
      continue;
    }
    // The only real warnings: EGPF's two PROB30 groups forecast VV///, which has no height.
    // Their 0300 m visibility still makes them LIFR.
    if (parsed.station === 'EGPF') {
      assert.equal(parsed.warnings.length, 2);
      assert.ok(parsed.warnings.every((w) => /LIFR is shown because the visibility/.test(w)));
    } else {
      assert.deepEqual([...parsed.warnings], [], raw);
    }
  }
});

// ── Copy that was wrong
test('the crosswind page no longer calls the variation error small', () => {
  const page = readRepoFile('pages/crosswind.html');
  assert.doesNotMatch(page, /small and acceptable/);
  assert.match(page, /KSEA/);
  assert.match(page, /PANC/);
});

test('the TAF legend no longer repeats the wrong PROB30 and base forecast claims', () => {
  const page = readRepoFile('pages/decoder.html');
  assert.doesNotMatch(page, /Not used for thunderstorms/);
  assert.doesNotMatch(page, /entire valid period/);
});
