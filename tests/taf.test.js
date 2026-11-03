// TAF decoder tests. Run with: node --test
//
// Expected values were worked out by hand from these rules, not copied from the code:
//   FM:    "all forecast conditions given before the FMYYGGgg group are superseded" (NWSI 10-813 B2.9.2)
//   BECMG: "omitted conditions are carried over from the previous time group" (AIM 7-1-28 key)
//   TEMPO: an element with no stated change "is understood to remain the same" (NWSI 10-813 B2.9.3)
//   PROB:  associated conditions overlay the prevailing forecast (NWSI 10-813 B2.9.4)
// Group end times are exclusive: a group ending at 07Z is not active at 07Z.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();

const elementText = (state) => [
  state.wind && state.wind.raw,
  state.visibility && state.visibility.raw,
  ...state.weather.map((w) => w.raw),
  ...state.sky.map((s) => s.raw),
].filter(Boolean).join(' ');

const at = (day, hour, min = 0) => ({ day, hour, min });

const REAL_TAFS = {
  T1: 'TAF KDAB 022332Z 0300/0324 08012G20KT P6SM VCSH FEW015 BKN080 BKN120 TEMPO 0300/0304 4SM SHRA BKN030 FM030600 08010KT P6SM SCT020 BKN100 FM031400 08013G20KT P6SM VCSH SCT020 BKN080 FM031800 07012G19KT P6SM SCT030 BKN100',
  T2: 'TAF KBNA 022320Z 0300/0406 17010KT P6SM FEW050 BKN250 FM031500 17014G24KT P6SM BKN035 OVC050 FM040100 16004G23KT P6SM BKN025 OVC080 PROB30 0401/0406 -SHRA BKN009',
  T3: 'TAF CYUL 030240Z 0303/0406 26008G18KT P6SM BKN200 FM030900 23005KT P6SM SCT080 OVC100 BECMG 0310/0312 18005KT FM031400 17006KT P6SM BKN080 OVC100 TEMPO 0314/0316 P6SM -SHRA BKN040 OVC080 FM031600 19005KT P6SM -RA BKN040 OVC080 TEMPO 0316/0321 5SM -RA BR BKN020 OVC040 BECMG 0319/0321 10008KT FM032100 10008KT 4SM -RA BR BKN020 OVC030 FM040000 11005KT P6SM -RA SCT015 OVC025 RMK NXT FCST BY 030600Z',
  T4: 'TAF EGKK 022308Z 0300/0406 01008KT 9999 SCT016 TEMPO 0300/0307 BKN014 PROB40 TEMPO 0310/0318 03015G25KT 5000 SHRA BKN012 BECMG 0321/0324 08010KT',
  T5: 'TAF ESSA 030230Z 0303/0403 29005KT CAVOK PROB40 0321/0403 1200 BCFG',
  T6: 'TAF LFPG 022300Z 0300/0406 03010KT 9999 BKN030 TX10/0314Z TN03/0406Z TEMPO 0300/0308 4000 DZ BKN014 PROB40 TEMPO 0302/0308 2000 RADZ BKN008 PROB30 TEMPO 0304/0306 0700 FG BKN002 BECMG 0310/0312 CAVOK',
  T7: 'TAF KBAD 030400Z 0304/0410 14009KT 9999 OVC020 QNH2992INS BECMG 0305/0306 15010G15KT 9999 OVC018 QNH2989INS BECMG 0312/0313 16014G22KT 9999 VCSH OVC010 QNH2986INS TEMPO 0313/0316 8000 -SHRA OVC008 BECMG 0316/0317 30014G22KT 8000 -SHRA VCTS OVC015CB QNH2983INS TEMPO 0318/0319 30035G45KT 0400 +TSRA OVC009CB BECMG 0319/0320 32015G25KT 4800 SHRA OVC020 QNH2982INS BECMG 0323/0324 33012KT 9999 NSW OVC100 QNH2984INS TX24/0320Z TN21/0312Z',
  T8: 'TAF KDFW 030259Z 0303/0406 17016KT P6SM SCT040 BKN060 FM030400 18015G25KT P6SM VCTS SCT035CB BKN050 TEMPO 0305/0307 26025G40KT 2SM +TSRA BKN025CB FM030800 21012KT P6SM FEW025 SCT120 FM031100 30015G25KT P6SM SCT050',
  T9: 'TAF CYWG 022340Z 0300/0324 36010KT 3SM -RA BR SCT003 OVC006 TEMPO 0300/0302 1 1/2SM -RA BR OVC003 FM030200 35015G25KT 6SM -RA BR OVC008 TEMPO 0302/0308 2SM -RA BR OVC004 FM030800 34015KT 6SM BR OVC006 TEMPO 0308/0319 1SM -DZ BR OVC004 FM031900 35012KT P6SM FEW008 BKN012 FM032200 36008KT P6SM SCT015 RMK NXT FCST BY 030600Z',
};

// The 23 scoped cases: [case, name, time, prevailing text, prevailing category, also-active list]
const SCOPED_CASES = [
  ['T1', 'TEMPO inherits wind and overlays', at(3, 2), '08012G20KT P6SM VCSH FEW015 BKN080 BKN120', 'VFR',
    [['TEMPO', '08012G20KT 4SM SHRA BKN030', 'MVFR']]],
  ['T1', 'TEMPO end time is exclusive', at(3, 4), '08012G20KT P6SM VCSH FEW015 BKN080 BKN120', 'VFR', []],
  ['T1', 'FM drops VCSH', at(3, 6), '08010KT P6SM SCT020 BKN100', 'VFR', []],
  ['T2', 'before FM and PROB', at(3, 23), '17014G24KT P6SM BKN035 OVC050', 'VFR', []],
  ['T2', 'PROB overlays with inherited values', at(4, 2), '16004G23KT P6SM BKN025 OVC080', 'MVFR',
    [['PROB30', '16004G23KT P6SM -SHRA BKN009', 'IFR']]],
  ['T3', 'both states during a BECMG window', at(3, 11), '23005KT P6SM SCT080 OVC100', 'VFR',
    [['BECMG', '18005KT P6SM SCT080 OVC100', 'VFR']]],
  ['T3', 'BECMG persists after its window', at(3, 12), '18005KT P6SM SCT080 OVC100', 'VFR', []],
  ['T3', 'BECMG and TEMPO overlap', at(3, 20), '19005KT P6SM -RA BKN040 OVC080', 'VFR',
    [['BECMG', '10008KT P6SM -RA BKN040 OVC080', 'VFR'], ['TEMPO', '19005KT 5SM -RA BR BKN020 OVC040', 'MVFR']]],
  ['T3', 'FM supersedes at the shared time', at(3, 21), '10008KT 4SM -RA BR BKN020 OVC030', 'MVFR', []],
  ['T4', 'sky-only TEMPO', at(3, 2), '01008KT 9999 SCT016', 'VFR', [['TEMPO', '01008KT 9999 BKN014', 'MVFR']]],
  ['T4', 'combined PROB40 TEMPO', at(3, 12), '01008KT 9999 SCT016', 'VFR',
    [['PROB40 TEMPO', '03015G25KT 5000 SHRA BKN012', 'MVFR']]],
  ['T4', 'wind-only BECMG', at(3, 22), '01008KT 9999 SCT016', 'VFR', [['BECMG', '08010KT 9999 SCT016', 'VFR']]],
  ['T4', '0324 and 0400 are the same moment', at(4, 0), '08010KT 9999 SCT016', 'VFR', []],
  ['T5', 'before PROB', at(3, 20), '29005KT CAVOK', 'VFR', []],
  ['T5', 'PROB crosses midnight over a CAVOK base', at(4, 0), '29005KT CAVOK', 'VFR',
    [['PROB40', '29005KT 1200 BCFG', 'LIFR']]],
  ['T6', 'three overlays each built from prevailing', at(3, 5), '03010KT 9999 BKN030', 'MVFR', [
    ['TEMPO', '03010KT 4000 DZ BKN014', 'IFR'],
    ['PROB40 TEMPO', '03010KT 2000 RADZ BKN008', 'IFR'],
    ['PROB30 TEMPO', '03010KT 0700 FG BKN002', 'LIFR'],
  ]],
  ['T6', 'CAVOK target clears sky', at(3, 11), '03010KT 9999 BKN030', 'MVFR', [['BECMG', '03010KT CAVOK', 'VFR']]],
  ['T6', 'CAVOK persists', at(3, 12), '03010KT CAVOK', 'VFR', []],
  ['T7', 'military BECMG with severe overlay', at(3, 18, 30), '30014G22KT 8000 -SHRA VCTS OVC015CB', 'MVFR',
    [['TEMPO', '30035G45KT 0400 +TSRA OVC009CB', 'LIFR']]],
  ['T7', '4800 m is 3 SM, so MVFR', at(3, 19, 30), '30014G22KT 8000 -SHRA VCTS OVC015CB', 'MVFR',
    [['BECMG', '32015G25KT 4800 SHRA OVC020', 'MVFR']]],
  ['T8', 'VFR band must not hide TSRA', at(3, 6), '18015G25KT P6SM VCTS SCT035CB BKN050', 'VFR',
    [['TEMPO', '26025G40KT 2SM +TSRA BKN025CB', 'IFR']]],
  ['T8', 'TEMPO exclusive end', at(3, 7), '18015G25KT P6SM VCTS SCT035CB BKN050', 'VFR', []],
  ['T9', 'split fractional visibility', at(3, 1), '36010KT 3SM -RA BR SCT003 OVC006', 'IFR',
    [['TEMPO', '36010KT 1 1/2SM -RA BR OVC003', 'LIFR']]],
];

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

test('VV/// is kept as a sky layer and treated as the worst case, not as clear sky', () => {
  const parsed = site.parseTaf('TAF KXXX 011130Z 0112/0212 18010KT 6000 VV///');
  assert.equal(parsed.groups[0].sky[0].raw, 'VV///');
  assert.equal(parsed.groups[0].flightCategory, 'LIFR');
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
    assert.deepEqual([...parsed.warnings], [], raw);
    for (const group of parsed.groups) {
      assert.ok(group.flightCategory, `${group.type} has no category in ${raw}`);
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
