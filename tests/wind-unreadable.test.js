// Unreadable wind and variable-wind gust tests. Run with: node --test
//
// A wind we couldn't read is not a wind that isn't reported. It is flagged and shown as
// unreadable, the visibility, weather, and sky after it are still read, the flight category
// comes from those as usual, and nothing compares it with a limit.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
for (const file of ['js/wind-math.js', 'js/minimums-check.js']) {
  vm.runInContext(readRepoFile(file), site, { filename: file });
}

const LIMITS = { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18, gustSpreadOn: false, gustSpread: null };
const metar = (wind, rest = '10SM BKN050') => site.parseMetar(`METAR KDAB 061153Z ${wind} ${rest} 15/10 A3000`.replace('  ', ' '));
const lines = (parsed, runway = null, limits = LIMITS) => [...site.checkMetarAgainstMinimums(parsed, limits, runway, null)];
const RWY_16 = { id: '16', t: 157, variation: -7.2 };
const RWY_07L = { id: '07L', t: 65, variation: -7.2 };

// ── Variable wind keeps its gust
test('the field breakdown for a variable wind includes the gust', () => {
  const field = metar('VRB06G20KT').fields.find((f) => f.type === 'wind');
  assert.equal(field.explanation, 'Variable direction at 6 KT, gusting 20 KT');
});

test('a steady variable wind with no gust says no gust', () => {
  assert.equal(metar('VRB06KT').fields.find((f) => f.type === 'wind').explanation, 'Variable direction at 6 KT');
});

for (const [name, runway] of [['no runway chosen', null], ['runway 16', RWY_16], ['runway 07L', RWY_07L]]) {
  test(`a variable wind's full gust counts as possible crosswind with ${name}`, () => {
    const out = lines(metar('VRB06G20KT'), runway);
    const gust = out.find((l) => /^Total gust wind /.test(l.text));
    assert.ok(gust, out.map((l) => l.text).join(' | '));
    assert.equal(gust.status, 'exceeds');
    assert.match(gust.text, /20 kt exceeds your 10 kt limit/);
    assert.ok(out.some((l) => /^Gusts 20 kt exceed your 18 kt limit/.test(l.text)));
  });
}

// ── The METAR flags a wind it can't read
const GARBLED = ['1801OKT', '18010G2OKT', '18O10KT', '180/10KT', '18010K', 'VRB05KTS', '23015G//KT', '18010KTS'];

for (const token of GARBLED) {
  test(`METAR ${token}: flagged as an unreadable wind, never given a value`, () => {
    const p = metar(token);
    assert.equal(p.windUnreadable, token);
    assert.equal(p.wind, null);
    assert.match(p.windWarning, new RegExp(`Couldn't read ${token.replace(/[/]/g, '\\/')} where wind belongs`));
    const field = p.fields.find((f) => f.token === token);
    assert.equal(field.type, 'wind');
    assert.match(field.explanation, /Couldn't be read/);
    assert.doesNotMatch(field.explanation, /automated sensor/);
  });

  test(`METAR ${token}: visibility and sky still read, and the category matches the same report with a good wind`, () => {
    for (const rest of ['10SM BKN050', '2SM OVC008', '1/2SM OVC002', '5SM SCT030']) {
      const bad = metar(token, rest), good = metar('18010KT', rest);
      assert.equal(bad.visibility.raw, good.visibility.raw);
      assert.deepEqual([...bad.sky].map((s) => s.raw), [...good.sky].map((s) => s.raw));
      assert.equal(bad.flightCategory, good.flightCategory, rest);
      assert.notEqual(bad.flightCategory, null, 'the wind is not what blocks the category');
    }
  });

  test(`METAR ${token}: not reported as unreadable visibility or sky, so the category warnings stay quiet`, () => {
    const p = metar(token);
    assert.deepEqual([...p.unreadable], []);
    assert.deepEqual([...p.warnings], []);
  });

  test(`METAR ${token}: minimums never compares wind, ceiling and visibility still check, and the check is incomplete`, () => {
    const p = metar(token);
    const out = lines(p, RWY_16);
    const text = out.map((l) => l.text).join(' | ');
    const wind = out.find((l) => /^Wind couldn't be read/.test(l.text));
    assert.ok(wind, text);
    assert.equal(wind.status, 'notChecked');
    assert.equal(wind.text, 'Wind couldn\'t be read, so wind and crosswind limits weren\'t checked.');
    for (const l of out) assert.ok(!/(Sustained wind|Gusts|crosswind|Crosswind|Total wind)/.test(l.text.replace(wind.text, '')), `compared wind: ${l.text}`);
    assert.ok(out.some((l) => /^Ceiling 5,000 ft is above/.test(l.text)), 'ceiling still checked');
    assert.ok(out.some((l) => /^Visibility 10 SM is above/.test(l.text)), 'visibility still checked');
    assert.equal(site.incompleteSummary(out), 'wind couldn\'t be read, so wind and crosswind weren\'t checked.');
  });
}

test('18010K and VRB05KTS do not block the flight category or the ceiling check', () => {
  for (const token of ['18010K', 'VRB05KTS']) {
    const p = metar(token, '10SM BKN050');
    assert.equal(p.flightCategory, 'VFR');
    assert.equal(p.wind, null);
    const ceiling = lines(p).find((l) => /^Ceiling/.test(l.text));
    assert.equal(ceiling.status, 'within', ceiling.text);
    assert.doesNotMatch(ceiling.text, /wasn't checked/);
  }
});

test('a garbled wind in the middle of the report is still found and the rest is read', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 10SM 1801OKT BKN050 15/10 A3000');
  assert.equal(p.windUnreadable, '1801OKT');
  assert.equal(p.visibility.raw, '10SM');
  assert.equal(p.sky[0].raw, 'BKN050');
  assert.equal(p.flightCategory, 'VFR');
});

test('two garbled winds are both named', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 1801OKT 10SM BKN050 18010K 15/10 A3000');
  assert.equal(p.windUnreadable, '1801OKT 18010K');
});

test('a garbled wind next to a valid one still marks the wind unreadable, and nothing is compared', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 18010KT 10SM BKN050 15/10 A3000 1801OKT');
  assert.equal(p.windUnreadable, '1801OKT');
  const out = lines(p, RWY_16);
  assert.ok(!out.some((l) => /^(Sustained wind|Gust|Crosswind)/.test(l.text)), out.map((l) => l.text).join(' | '));
});

test('a trend forecast after the report does not make the current wind unreadable', () => {
  const p = site.parseMetar('METAR EGLL 061150Z 18010KT 9999 BKN030 15/10 Q1013 BECMG 1801OKT');
  assert.equal(p.windUnreadable, null);
  assert.equal(p.wind.raw, '18010KT');
});

test('remarks do not make the wind unreadable', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 18010KT 10SM BKN050 15/10 A3000 RMK AO2 PK WND 18025/1140 SLP123 18010K');
  assert.equal(p.windUnreadable, null);
});

test('wind shear is not a garbled wind', () => {
  assert.equal(site.parseMetar('METAR KDAB 061153Z 18010KT 10SM BKN050 WS020/25040KT 15/10 A3000').windUnreadable, null);
});

// ── "Not reported" stays for a wind that is really missing or a real sensor outage
for (const token of ['/////KT', '///10KT', '180//KT']) {
  test(`METAR ${token}: a real sensor outage is labelled as one, not as unreadable`, () => {
    const p = metar(token);
    assert.equal(p.windUnreadable, null);
    assert.equal(p.wind, null);
    assert.match(p.fields.find((f) => f.token === token).explanation, /not reported by the automated sensor/);
    const wind = lines(p, RWY_16).find((l) => /^Wind/.test(l.text));
    assert.equal(wind.text, 'Wind isn\'t reported, so wind limits weren\'t checked.');
  });
}

test('180/10KT is a garbled wind, not a sensor outage', () => {
  const p = metar('180/10KT');
  assert.equal(p.windUnreadable, '180/10KT');
  assert.doesNotMatch(p.fields.find((f) => f.token === '180/10KT').explanation, /automated sensor/);
});

test('a report with no wind at all is not reported, and nothing is flagged', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 10SM BKN050 15/10 A3000');
  assert.equal(p.windUnreadable, null);
  assert.equal(p.wind, null);
  assert.equal(p.visibility.raw, '10SM');
  const wind = lines(p, RWY_16).find((l) => /^Wind/.test(l.text));
  assert.equal(wind.text, 'Wind isn\'t reported, so wind limits weren\'t checked.');
  assert.equal(site.incompleteSummary(lines(p, RWY_16)), 'wind isn\'t reported, so wind and crosswind weren\'t checked.');
});

test('a good wind is unchanged: no flag, no incomplete line once a runway is chosen', () => {
  const p = metar('18010KT');
  assert.equal(p.windUnreadable, null);
  assert.equal(p.windWarning, null);
  assert.equal(p.wind.raw, '18010KT');
  assert.equal(site.incompleteSummary(lines(p, RWY_16)), null);
});

// ── The incomplete line covers any element that couldn't be checked, and is never a pass
test('the incomplete line names every element that could not be checked', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 1801OKT 15/10 A3000');   // no visibility, no sky, no readable wind
  const summary = site.incompleteSummary(lines(p, RWY_16));
  assert.match(summary, /sky condition is missing or unreadable, so ceiling wasn't checked/);
  assert.match(summary, /visibility is missing or unreadable, so visibility wasn't checked/);
  assert.match(summary, /wind couldn't be read, so wind and crosswind weren't checked/);
});

test('a missing saved limit makes the check incomplete too', () => {
  const out = lines(metar('18010KT'), RWY_16, { ...LIMITS, gusts: null });
  const p = metar('18010G20KT');
  const withGust = lines(p, RWY_16, { ...LIMITS, gusts: null });
  assert.equal(site.incompleteSummary(out), null, 'no gust reported, nothing to check');
  assert.match(site.incompleteSummary(withGust), /no limit is saved for gusts, so it wasn't checked/);
});

test('no runway chosen makes the check incomplete, and says why', () => {
  assert.match(site.incompleteSummary(lines(metar('18010KT'), null)), /no runway selected, so crosswind wasn't checked/);
});

test('the incomplete line never says pass, and the minimums have no overall verdict', () => {
  const html = site.buildMinimumsLines(lines(metar('1801OKT'), RWY_16));
  assert.doesNotMatch(html, /pass|all clear|go\b/i);
  assert.match(html, /mins-line--notChecked/);
  const summary = site.incompleteSummary(lines(metar('1801OKT'), RWY_16));
  assert.doesNotMatch(summary, /pass|within/i);
});

// ── TAF: an unreadable wind in a group
const HEAD = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC';
const NOW = new Date(Date.UTC(2026, 10, 3, 12));
const parseTaf = (raw) => site.parseTaf(raw);
const slider = (raw, step) => {
  const parsed = parseTaf(raw);
  const { start } = site.tafDefaultStep(parsed, NOW);
  return site.tafSliderView(parsed, step, start, 'en-US', 'UTC');
};
const sliderChips = (state) => [...site.stateChips(state).matchAll(/taf-chip-\w+">([^<]*)</g)].map((m) => m[1]);
const group = (raw, type) => parseTaf(raw).groups.find((g) => g.type === type);

test('TEMPO 0118/0120 1801OKT 3SM shows 3SM and a wind warning, and does not inherit the base wind', () => {
  const raw = `TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 1801OKT 3SM`;
  const parsed = parseTaf(raw);
  const tempo = group(raw, 'TEMPO');
  assert.equal(tempo.windUnreadable, '1801OKT');
  assert.equal(tempo.wind, null);
  assert.equal(tempo.visibility.raw, '3SM');
  assert.ok(parsed.warnings.some((w) => /Couldn't read 1801OKT in the Temporarily group at D01 18:00Z where wind belongs/.test(w)), parsed.warnings.join(' | '));
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind, null, 'the overlay must not show the base wind');
  assert.equal(overlay.windUnreadable, '1801OKT');
  assert.equal(overlay.visibility.raw, '3SM');
  assert.equal(overlay.category, 'MVFR', '3 SM and a 2,000 ft ceiling');
  const chips = sliderChips(overlay);
  assert.ok(chips.includes('Wind couldn\'t be read'), chips.join(' | '));
  assert.ok(chips.includes('3SM'));
  assert.ok(!chips.includes('180° / 10 KT'));
  const card = site.buildGroupCard(tempo);
  assert.match(card, /taf-chip-wind">Wind couldn't be read</);
  assert.match(card, /taf-chip-vis">3SM</);
  assert.doesNotMatch(card, /Carried over: 18010KT/);
});

test('the base forecast under that TEMPO still shows its own wind', () => {
  const raw = `TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 1801OKT 3SM`;
  const v = slider(raw, 7);
  assert.equal(v.base.wind.raw, '18010KT');
  assert.equal(v.base.windUnreadable, null);
});

for (const [name, tail, category] of [
  ['at the wind position', 'FM011600 1801OKT 5SM BKN020', 'MVFR'],
  ['after visibility', 'FM011600 5SM 1801OKT BKN020', 'MVFR'],
  ['after sky', 'FM011600 5SM BKN020 1801OKT', 'MVFR'],
  ['with weather after it', 'FM011600 1801OKT 3SM -RA OVC008', 'IFR'],
  ['in a base group', null, 'MVFR'],
]) {
  test(`TAF FM garbled wind ${name}: the rest is read and the category comes from it`, () => {
    const raw = tail ? `${HEAD} ${tail}` : 'TAF KXXX 011130Z 0112/0212 1801OKT 5SM BKN020';
    const type = tail ? 'FM' : 'BASE';
    const g = group(raw, type);
    assert.equal(g.windUnreadable, '1801OKT');
    assert.equal(g.wind, null);
    assert.equal(g.flightCategory, category);
    assert.ok(g.visibility, 'visibility read');
    assert.ok(g.sky.length, 'sky read');
    const parsed = parseTaf(raw);
    assert.ok(parsed.warnings.some((w) => /where wind belongs/.test(w)));
    assert.ok(!parsed.warnings.some((w) => /doesn't give a readable visibility and sky/.test(w)), 'no misleading warning');
  });
}

test('an FM with a garbled wind and an unreadable sky flags both, separately', () => {
  const g = group(`${HEAD} FM011600 1801OKT 5SM OVC0X0`, 'FM');
  assert.equal(g.windUnreadable, '1801OKT');
  assert.equal(g.unreadable, 'OVC0X0');
  assert.equal(g.flightCategory, null);
});

for (const token of ['18010K', 'VRB05KTS', '180/10KT', '18010KTS', '18O10KT']) {
  test(`TAF ${token}: flagged, and the visibility and sky after it still set the category`, () => {
    const g = group(`${HEAD} FM011600 ${token} 5SM BKN020`, 'FM');
    assert.equal(g.windUnreadable, token);
    assert.equal(g.visibility.raw, '5SM');
    assert.equal(g.flightCategory, 'MVFR');
  });
}

test('a BECMG with a garbled wind does not carry the earlier wind forward once it completes', () => {
  const raw = `${HEAD} BECMG 0114/0116 1801OKT 5SM BKN020`;
  const before = slider(raw, 1).base, after = slider(raw, 6).base;
  assert.equal(before.wind.raw, '18010KT');
  assert.equal(after.wind, null);
  assert.equal(after.windUnreadable, '1801OKT');
  assert.equal(after.visibility.raw, '5SM');
});

test('a later group that restates a readable wind clears the unreadable one', () => {
  const raw = `${HEAD} BECMG 0114/0116 1801OKT 5SM BKN020 FM011800 27012KT 5SM BKN020`;
  const state = slider(raw, 7).base;
  assert.equal(state.wind.raw, '27012KT');
  assert.equal(state.windUnreadable, null);
  assert.ok(!sliderChips(state).some((c) => /couldn't be read/.test(c)));
});

test('a TEMPO that restates a readable wind after an unreadable one shows the readable one', () => {
  const raw = `TAF KXXX 011130Z 0112/0212 1801OKT 5SM BKN020 TEMPO 0118/0120 27015G25KT 3SM`;
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind.raw, '27015G25KT');
  assert.equal(overlay.windUnreadable, null);
  assert.equal(slider(raw, 7).base.windUnreadable, '1801OKT');
});

test('a group that truly omits wind still inherits it and never says couldn\'t be read', () => {
  const raw = `TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 3SM`;
  const tempo = group(raw, 'TEMPO');
  assert.equal(tempo.windUnreadable, null);
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind.raw, '18010KT');
  assert.ok(!sliderChips(overlay).some((c) => /couldn't be read/.test(c)));
  assert.match(site.buildGroupCard(tempo), /Carried over: 18010KT/);
});

test('a base group with no wind at all still says not stated, not unreadable', () => {
  const chips = sliderChips(slider('TAF KXXX 011130Z 0112/0212 5SM BKN020', 1).base);
  assert.ok(chips.includes('Wind not stated'), chips.join(' | '));
});

test('wind shear, temperature groups, and a valid wind are never taken as a garbled wind', () => {
  for (const raw of [
    `${HEAD} FM011600 18010KT 5SM BKN020 WS020/25040KT`,
    `${HEAD} FM011600 18010KT 5SM BKN020 TX12/0118Z TN05/0210Z`,
    `${HEAD} FM011600 VRB05KT 5SM BKN020`,
    `${HEAD} FM011600 27015G25KT 5SM BKN020`,
    `${HEAD} FM011600 CAVOK`,
    `${HEAD} TEMPO 0118/0120 3SM -RA`,
    `${HEAD} PROB30 0118/0120 1/2SM FG VV002`,
  ]) {
    for (const g of parseTaf(raw).groups) assert.equal(g.windUnreadable, null, raw);
  }
});

test('a garbled wind in a TAF leaves a sky we could not read flagged as before', () => {
  const g = group(`${HEAD} FM011600 5XSM -TSRA BKN020`, 'FM');
  assert.equal(g.unreadable, '5XSM');
  assert.deepEqual([...g.unreadableCovers], ['visibility', 'weather', 'sky']);
  assert.equal(g.windUnreadable, null);
});
