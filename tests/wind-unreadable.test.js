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
    const gust = out.find((l) => /^Gust crosswind could be /.test(l.text));
    assert.ok(gust, out.map((l) => l.text).join(' | '));
    assert.equal(gust.status, 'exceeds');
    assert.equal(gust.text, 'Gust crosswind could be the full 20 kt (variable wind), above your 10 kt limit.');
    assert.equal(out.find((l) => /^Crosswind could be /.test(l.text)).text, 'Crosswind could be the full 6 kt (variable wind), within your 10 kt limit.');
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
    for (const l of out) assert.ok(!/(Sustained wind|Gusts|crosswind|Crosswind)/.test(l.text.replace(wind.text, '')), `compared wind: ${l.text}`);
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

// ── The unreadable wind belongs to the TEMPO window only
const TEMPO_RAW = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 1801OKT 3SM';

test('an unreadable TEMPO wind applies from 0118 to 0120 only, and the base wind returns after 0120 with no later group', () => {
  // The slider steps are hours from the 12Z start. 18Z and 19Z are inside the window.
  for (const [hourZ, inside] of [[16, false], [17, false], [18, true], [19, true], [20, false], [21, false], [28, false]]) {
    const v = slider(TEMPO_RAW, hourZ - 12);
    assert.equal(v.base.wind.raw, '18010KT', `${hourZ}Z: the base wind is never replaced`);
    assert.equal(v.base.windUnreadable, null, `${hourZ}Z: the base wind is never marked unreadable`);
    assert.equal(v.possible.length, inside ? 1 : 0, `${hourZ}Z: the TEMPO is ${inside ? '' : 'not '}in effect`);
    if (inside) {
      assert.equal(v.possible[0].state.wind, null);
      assert.equal(v.possible[0].state.windUnreadable, '1801OKT');
      assert.equal(v.possible[0].state.visibility.raw, '3SM');
    }
    assert.ok(sliderChips(v.base).includes('180° / 10 KT'), `${hourZ}Z`);
    assert.ok(!sliderChips(v.base).some((c) => /couldn't be read/.test(c)), `${hourZ}Z: nothing unreadable in the base panel`);
  }
});

test('the time resolver agrees at the edges of the TEMPO window', () => {
  const parsed = parseTaf(TEMPO_RAW);
  const at = (hour, min) => site.tafStateAt(parsed, { day: 1, hour, min });
  assert.equal(at(17, 59).overlays.length, 0, 'one minute before 0118');
  assert.equal(at(18, 0).overlays.length, 1, 'at 0118');
  assert.equal(at(19, 59).overlays.length, 1, 'one minute before 0120');
  assert.equal(at(20, 0).overlays.length, 0, 'at 0120');
  for (const [h, m] of [[17, 59], [18, 0], [19, 59], [20, 0], [23, 0]]) {
    assert.equal(at(h, m).prevailing.wind.raw, '18010KT', `${h}:${m}`);
    assert.equal(at(h, m).prevailing.windUnreadable, null, `${h}:${m}`);
  }
  assert.equal(at(18, 30).overlays[0].state.windUnreadable, '1801OKT');
});

test('an unreadable wind in a later TEMPO does not leak into an earlier or a following one', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0114/0116 27015G25KT 3SM TEMPO 0118/0120 1801OKT 3SM TEMPO 0122/0124 2SM';
  assert.equal(slider(raw, 3).possible[0].state.wind.raw, '27015G25KT');
  assert.equal(slider(raw, 7).possible[0].state.windUnreadable, '1801OKT');
  const last = slider(raw, 11).possible[0].state;
  assert.equal(last.wind.raw, '18010KT', 'a later TEMPO that omits wind inherits the base wind, not the unreadable one');
  assert.equal(last.windUnreadable, null);
});

// ── Found by running the decoders over about 4,900 real METARs and 2,900 real TAFs (2026-11-07).
// The wind-position rule must flag real garbles and nothing else.
test('station IDs with digits are recognized, not read as a wind', () => {
  for (const id of ['KC83', 'K2J9', 'KP08', 'K0V4', 'K20U']) {
    const p = site.parseMetar(`METAR ${id} 070440Z AUTO 27005KT 10SM FEW034 12/04 A3008 RMK AO2`);
    assert.equal(p.station, id);
    assert.equal(p.time.raw, '070440Z');
    assert.equal(p.windUnreadable, null);
    assert.equal(p.wind.raw, '27005KT');
    assert.equal(p.flightCategory, 'VFR');
    assert.deepEqual([...p.unreadable], []);
  }
});

test('Canadian correction indicators (CCA, CCB) are a modifier, not a wind', () => {
  const p = site.parseMetar('METAR CYYU 070400Z CCB 00000KT 15SM SKC M03/M03 A3015');
  assert.equal(p.cor, true);
  assert.equal(p.windUnreadable, null);
  assert.equal(p.wind.raw, '00000KT');
  assert.equal(p.flightCategory, 'VFR');
});

test('junk before a real wind is not the wind: it stays unreadable (no category) and the wind is still read', () => {
  const p = site.parseMetar('METAR KMKQ 070435Z AUO 00000KT 10SM BKN029 25/17 A3002');
  assert.equal(p.windUnreadable, null);
  assert.equal(p.wind.raw, '00000KT');
  assert.deepEqual([...p.unreadable], ['AUO']);
  assert.equal(p.flightCategory, null, 'it could have been a garbled visibility or sky');
});

for (const token of ['3404G14KT', 'E00000KT']) {
  test(`real METAR garble ${token} is flagged and the rest is read`, () => {
    const p = site.parseMetar(`METAR RKSG 070355Z ${token} 10SM CLR 11/M17 A3051`);
    assert.equal(p.windUnreadable, token);
    assert.equal(p.flightCategory, 'VFR');
  });
}

for (const token of ['13008K', 'VRB02', '17010KT-SHRA', '30018G28', '0000KT', '0900KT', 'GRID30007KT']) {
  test(`real TAF garble ${token} is flagged as a wind and the rest of the group is read`, () => {
    const g = group(`${HEAD} TEMPO 0118/0120 ${token} 3SM BKN020`, 'TEMPO');
    assert.equal(g.windUnreadable, token);
    assert.equal(g.wind, null);
    assert.equal(g.visibility.raw, '3SM');
    assert.equal(g.sky[0].raw, 'BKN020');
    assert.equal(g.unreadable, null);
  });
}

test('a grid-north wind (GRID30007KT) is never read as a true wind', () => {
  const g = group('TAF NZFX 070100Z 0701/0807 GRID30007KT 9999 SCT040', 'BASE');
  assert.equal(g.wind, null);
  assert.equal(g.windUnreadable, 'GRID30007KT');
});

// Tokens that are not winds must not be called winds, because a wind we couldn't read doesn't
// block the category and these might be a visibility or weather we couldn't read.
for (const [token, rest] of [['0800FG', 'BKN010'], ['VIS4000', 'TSRA SCT010'], ['TS/RA', 'BR SCT030'], ['TAF', '9999 SCT040']]) {
  test(`TAF ${token} is not a wind: the group has no category unless a LIFR is certain`, () => {
    const g = group(`${HEAD} PROB30 0118/0120 ${token} ${rest}`, 'PROB30');
    assert.equal(g.windUnreadable, null);
    assert.equal(g.unreadable, token);
    assert.equal(g.flightCategory, null);
    assert.ok(g.sky.length, 'the sky after it is still read');
  });
}

test('an unreadable visibility with a certain LIFR ceiling is LIFR, not VFR (0800FG BKN001)', () => {
  const g = group('TAF EHKD 070104Z 0702/0714 10007KT 9999 NSC PROB30 0702/0711 0800FG BKN001', 'PROB30');
  assert.equal(g.flightCategory, 'LIFR');
  assert.equal(g.unreadable, '0800FG');
  assert.equal(g.windUnreadable, null);
});

test('VIS4000 is never allowed to look like the VFR it inherits', () => {
  const g = group('TAF SARP 062300Z 0700/0724 14005KT 9999 SCT030 PROB40 0707/0712 VIS4000 TSRA SCT010 OVC040 FEW050CB', 'PROB40');
  assert.equal(g.flightCategory, null);
  assert.equal(g.weather[0].raw, 'TSRA');
});

test('a BECMG time missing its slash is not a wind', () => {
  const g = group(`${HEAD} BECMG 07210722 4000 BR`, 'BECMG');
  assert.equal(g.windUnreadable, null);
});

test('four digits plus letters (0800FG) in a METAR wind position is not a wind either', () => {
  const p = site.parseMetar('METAR KXXX 070435Z 0800FG BKN010 10/09 A3000');
  assert.equal(p.windUnreadable, null);
  assert.deepEqual([...p.unreadable], ['0800FG']);
});

// ── An unrecognized token in the wind position might be the wind (and only a wind-shaped token is
// called a garbled wind)
test('a TEMPO whose wind position holds a token we cannot place does not inherit the base wind', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 0800FG BKN010';
  const tempo = group(raw, 'TEMPO');
  assert.equal(tempo.windUnreadable, null, 'not wind-shaped, so not called a garbled wind');
  assert.ok(tempo.unreadableCovers.includes('wind'));
  assert.equal(tempo.flightCategory, null);
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind, null);
  assert.ok(sliderChips(overlay).includes('Wind couldn\'t be read'), sliderChips(overlay).join(' | '));
  const card = site.buildGroupCard(tempo);
  assert.match(card, /taf-chip-wind">Wind couldn't be read</);
  assert.doesNotMatch(card, /Carried over: 18010KT/);
  assert.match(parseTaf(raw).warnings.join(' '), /Its wind is shown as unreadable too/);
  // the base wind is back outside the window
  assert.equal(slider(raw, 9).base.wind.raw, '18010KT');
  assert.equal(slider(raw, 9).possible.length, 0);
});

test('a PROB group whose wind position holds a token we cannot place does not inherit the base wind', () => {
  const raw = `${HEAD} PROB30 0118/0120 VIS4000 TSRA SCT010`;
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind, null);
  assert.ok(sliderChips(overlay).includes('Wind couldn\'t be read'));
  assert.equal(overlay.category, null);
});

test('a later group inherits the doubt about the wind from a base group that had a token we cannot place', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 0800FG BKN010 TEMPO 0118/0120 3SM';
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.wind, null);
  assert.ok(sliderChips(overlay).includes('Wind couldn\'t be read'));
});

test('junk before a readable wind does not make the wind unreadable', () => {
  const g = group(`${HEAD} TEMPO 0118/0120 XYZ 27015KT 3SM BKN010`, 'TEMPO');
  assert.equal(g.wind.raw, '27015KT');
  assert.ok(!g.unreadableCovers.includes('wind'));
  assert.equal(g.flightCategory, null, 'but the junk still blocks the category');
});

test('METAR: a token we cannot place where the wind belongs puts the wind in doubt', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 0800FG 10SM BKN050 15/10 A3000');
  assert.equal(p.windUnreadable, null, 'not wind-shaped, so not called a garbled wind');
  assert.equal(p.windDoubt, '0800FG');
  assert.equal(p.wind, null);
  assert.equal(p.flightCategory, null);
  assert.match(p.windWarning, /It might be the wind/);
  const out = lines(p, RWY_16);
  assert.equal(out.find((l) => /^Wind/.test(l.text)).text, 'Wind couldn\'t be read, so wind and crosswind limits weren\'t checked.');
  assert.match(site.incompleteSummary(out), /wind couldn't be read/);
});

test('METAR: junk before a readable wind leaves the wind readable', () => {
  const p = site.parseMetar('METAR KDAB 061153Z AUO 18010KT 10SM BKN050 15/10 A3000');
  assert.equal(p.wind.raw, '18010KT');
  assert.equal(p.windDoubt, null);
  assert.equal(p.flightCategory, null);
});

test('METAR: a valid wind that turns up out of place is a wind we did not read', () => {
  const p = site.parseMetar('METAR KDAB 061153Z 10SM 18010KT BKN050 15/10 A3000');
  assert.equal(p.wind, null);
  assert.equal(p.windDoubt, '18010KT');
  assert.equal(p.flightCategory, null);
});

// ── The rule: any token we can't place means no category, unless a readable element settles LIFR
for (const [name, rest] of [
  ['a weather group we cannot read, with sky after it', 'PROB30 0118/0120 TS/RA BR SCT030CB OVC080'],
  ['a weather group with a leading sign and VC', 'TEMPO 0118/0120 9000 -VCDZ SCT010'],
  ['a wind that turns up after the weather', 'PROB30 TEMPO 0118/0120 TSRA 23007KT FEW035CB'],
  ['an FM written with a space', 'BECMG 0118/0120 FM 072000 VRB02KT 2500 BR'],
  ['a typo of FEW', 'BECMG 0118/0120 FWE022CB'],
]) {
  test(`TAF: ${name} gives the group no category`, () => {
    const g = parseTaf(`${HEAD} ${rest}`).groups[1];
    assert.equal(g.flightCategory, null);
    assert.ok(g.unreadable, 'named as unreadable');
  });
}

test('TAF: an unread sky after a weather group we cannot read is named, so it is never shown as VFR', () => {
  const g = group(`${HEAD} PROB30 0118/0120 TS/RA BR SCT030CB OVC080`, 'PROB30');
  assert.ok(g.unreadableCovers.includes('sky'));
  assert.ok(g.unreadableCovers.includes('weather'));
});

test('TAF: a leftover wind after the weather marks the wind in doubt', () => {
  const g = group(`${HEAD} PROB30 TEMPO 0118/0120 TSRA 23007KT FEW035CB`, 'PROB30 TEMPO');
  assert.ok(g.unreadableCovers.includes('wind'));
});

test('TAF: a LIFR that a readable element settles survives a token we cannot place', () => {
  const g = group(`${HEAD} TEMPO 0118/0120 1/4SM FG TS/RA VV001`, 'TEMPO');
  assert.equal(g.flightCategory, 'LIFR');
  assert.ok(g.unreadable);
});

for (const [name, tail] of [
  ['a military QNH group', 'QNH3023INS'],
  ['a 6-digit turbulence group', '510006'],
  ['a 6-digit icing group', '620809'],
  ['max and min temperatures', 'TX21/0319Z TN13/0311Z'],
  ['a nonstandard temperature group', 'TX32/0718 TN21/0809'],
  ['end-of-TAF remarks (LAST NO AMDS)', 'LAST NO AMDS AFT 0704 NEXT 0713'],
  ['end-of-TAF remarks (AMD LTD TO)', 'AMD LTD TO CLD VIS AND WIND'],
  ['a wind remark (WND)', 'WND 300V030'],
  ['wind shear', 'WS020/25040KT'],
]) {
  test(`TAF: ${name} is known to carry no conditions and does not block the category`, () => {
    const g = group(`${HEAD} FM011600 18010KT 5SM BKN020 ${tail}`, 'FM');
    assert.equal(g.flightCategory, 'MVFR', tail);
    assert.equal(g.unreadable, null, tail);
    assert.deepEqual([...g.unparsed], [], tail);
  });
}

test('METAR: a misplaced valid wind and an unknown trailing token both block the category', () => {
  assert.equal(site.parseMetar('METAR KXXX 070435Z AUTO 03007KT 10SM CLR 03/M01 M RMK AO2').flightCategory, null);
  assert.equal(site.parseMetar('METAR WALL 070430Z 10006KT 9999 FEW018CB 32/26 Q1010 CB TO NW AND N').flightCategory, null);
});

test('a token that looks like nothing could be any element, so all of them are in doubt', () => {
  const g = group(`${HEAD} BECMG 0118/0120 FWE022CB`, 'BECMG');
  for (const el of ['visibility', 'weather', 'sky', 'wind']) assert.ok(g.unreadableCovers.includes(el), el);
});

test('a group whose own unreadable token might be the visibility does not show the earlier visibility as its own', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 0800FG BKN010';
  const tempo = group(raw, 'TEMPO');
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.visibility, null);
  assert.ok(sliderChips(overlay).includes('Visibility couldn\'t be read'), sliderChips(overlay).join(' | '));
  assert.ok(!sliderChips(overlay).includes('5SM'));
  assert.doesNotMatch(tempo.carriedOver, /5SM/);
  assert.match(site.buildGroupCard(tempo), /Visibility couldn't be read/);
  assert.doesNotMatch(site.buildGroupCard(tempo), /Carried over: [^<]*5SM/);
  assert.equal(overlay.category, null);
});

test('a group that omits an element and has no unreadable token of its own still inherits it', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BKN020 TEMPO 0118/0120 -RA';
  const overlay = slider(raw, 7).possible[0].state;
  assert.equal(overlay.visibility.raw, '5SM');
  assert.equal(overlay.sky[0].raw, 'BKN020');
});
