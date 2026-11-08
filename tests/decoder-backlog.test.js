// Decoder backlog tests. Run with: node --test
//
// 1 ///10KT, 2 fused groups, 3 military TAF 5xxxxx and 6xxxxx groups, 4 BLACK, 5 bare /////,
// 6 FN##### at the end of a TAF, 7 GRID winds.
//
// Sources for the military groups: AFMAN 15-124, Meteorological Codes (28 October 2009), paragraphs
// 1.3.4.7 and 1.3.4.8 and Tables 1.4 to 1.7. BLACK: UK Met Office aerodrome colour state register,
// entry "8. Black": "Airfield not usable for reasons other than cloud or visibility minima."
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadDecoders, readRepoFile } = require('./load-site');

const site = loadDecoders();
for (const file of ['js/wind-math.js', 'js/minimums-check.js']) {
  vm.runInContext(readRepoFile(file), site, { filename: file });
}

const LIMITS = { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18, gustSpreadOn: false, gustSpread: null };
const RWY_16 = { id: '16', t: 157, variation: -7.2 };
const metar = (body) => site.parseMetar(`METAR KXXX 081200Z ${body}`);
const lines = (p, runway = null) => [...site.checkMetarAgainstMinimums(p, LIMITS, runway, 'No runway selected.')];
const field = (p, token) => p.fields.find((f) => f.token === token);
const taf = (body) => site.parseTaf(`TAF KXXX 081130Z 0812/0912 ${body}`);

// ── 1. ///10KT is a wind with a missing direction, not a missing wind
test('///10KT: the speed is kept and the direction is marked missing', () => {
  const p = metar('///10KT 10SM CLR 15/10 A3000');
  assert.equal(p.wind.speed, 10);
  assert.equal(p.wind.dir, null);
  assert.equal(p.wind.directionMissing, true);
  assert.equal(p.windUnreadable, null);
  assert.equal(p.flightCategory, 'VFR');
  assert.match(field(p, '///10KT').explanation, /Direction not reported, 10 KT/);
});

test('///10G20KT: the gust is kept too', () => {
  const p = metar('///10G20KT 10SM CLR 15/10 A3000');
  assert.deepEqual([p.wind.speed, p.wind.gust, p.wind.directionMissing], [10, 20, true]);
});

test('///10KT: minimums compares the full speed and gust with the crosswind limit, with or without a runway', () => {
  for (const runway of [null, RWY_16]) {
    const out = lines(metar('///12G20KT 10SM CLR 15/10 A3000'), runway);
    const texts = out.map((l) => l.text);
    assert.ok(texts.some((t) => /^The wind direction isn't reported, so crosswind for a runway can't be calculated\./.test(t)), texts.join(' | '));
    assert.ok(texts.includes('Crosswind could be the full 12 kt (direction not reported), above your 10 kt limit.'), texts.join(' | '));
    assert.ok(texts.includes('Gust crosswind could be the full 20 kt (direction not reported), above your 10 kt limit.'), texts.join(' | '));
    assert.ok(!texts.some((t) => /isn't reported, so wind limits/.test(t)), 'must not say the wind is not reported');
    assert.ok(!out.some((l) => l.status === 'notChecked' && /Wind/.test(l.text)));
  }
});

test('///10KT: a station with no wind direction and no speed (/////KT) is still an outage', () => {
  const p = metar('/////KT 10SM CLR 15/10 A3000');
  assert.equal(p.wind, null);
  assert.match(field(p, '/////KT').explanation, /Not available/);
});

test('///10KT in a TAF group keeps the speed, and the chip says the direction is missing', () => {
  const t = taf('///10G20KT 9999 SCT030');
  const g = t.groups[0];
  assert.deepEqual([g.wind.speed, g.wind.gust, g.wind.directionMissing], [10, 20, true]);
  assert.equal(g.windUnreadable, null);
  assert.equal(g.flightCategory, 'VFR');
  assert.match(site.buildGroupCard(g), /Direction not reported \/ 10 KT G20/);
});

// ── 2. Fused groups
test('a weather code fused to a sky code is split, and the CB is shown', () => {
  const p = site.parseMetar('METAR UBTT 081200Z 27005MPS 9999 -SHRASCT030CB 15/10 Q1015');
  assert.equal(p.unrecognized.length, 0);
  assert.equal(p.unreadable.length, 0);
  assert.equal(p.weather[0].raw, '-SHRA');
  assert.equal(p.sky[0].raw, 'SCT030CB');
  assert.equal(p.sky[0].cb, 'CB');
  assert.equal(p.flightCategory, 'VFR');
  assert.equal(field(p, '-SHRASCT030CB').label, 'Groups run together');
  assert.match(p.notes[0], /wrote -SHRA and SCT030CB with no space, as -SHRASCT030CB/);
});

test('a wind fused to a weather code is split', () => {
  const p = site.parseMetar('METAR UBTT 081200Z 17010KT-SHRA 9999 SCT030 15/10 Q1015');
  assert.equal(p.wind.raw, '17010KT');
  assert.equal(p.weather[0].raw, '-SHRA');
  assert.equal(p.unreadable.length, 0);
  assert.equal(field(p, '17010KT-SHRA').label, 'Groups run together');
});

test('a fused TEMPO group in a TAF is split and noted', () => {
  const t = taf('27010KT 9999 SCT030 TEMPO 0814/0818 17010KT-SHRA SCT030CB');
  const g = t.groups[1];
  assert.equal(g.wind.raw, '17010KT');
  assert.equal(g.weather[0].raw, '-SHRA');
  assert.equal(g.windUnreadable, null);
  assert.ok(t.notes.some((n) => /Temporarily group/.test(n) && /17010KT-SHRA/.test(n)));
  const t2 = taf('27010KT 9999 SCT030 TEMPO 0814/0818 3000 -SHRASCT030CB');
  assert.equal(t2.groups[1].weather[0].raw, '-SHRA');
  assert.equal(t2.groups[1].sky[0].raw, 'SCT030CB');
});

const t2bad = (tok) => taf(`27010KT 9999 SCT030 TEMPO 0814/0818 3000 ${tok}`);

test('a fused token stays unrecognized, and the category stays withheld, when any part fails', () => {
  for (const bad of ['-SHRASCT030CBX', '-SHRAXXX030', '-ZZSCT030', '17010KT-ZZZ', '17010KT-SHRAX']) {
    const p = site.parseMetar(`METAR UBTT 081200Z 27005KT 9999 ${bad} 15/10 Q1015`);
    assert.ok(p.unrecognized.includes(bad), bad);
    assert.equal(p.flightCategory, null, bad);
    assert.equal(p.notes.length, 0, bad);
  }
  const t = taf('27010KT 9999 SCT030 TEMPO 0814/0818 17010KT-ZZZ');
  // In a TAF a wind with junk run on after it is an unreadable wind, never split and never read. The junk
  // could be a visibility, weather, or sky group, so the group has no category, as in a METAR.
  const bad = t.groups[1];
  assert.equal(bad.windUnreadable, '17010KT-ZZZ');
  assert.equal(bad.wind, null);
  assert.equal(bad.unreadable, '17010KT-ZZZ');
  assert.deepEqual(Array.from(bad.unreadableCovers).sort(), ['sky', 'visibility', 'weather', 'wind']);
  assert.equal(bad.flightCategory, null);
  assert.match(site.buildGroupCard(bad), /Wind couldn't be read/);
  assert.ok(t.warnings.some((w) => /Couldn't read 17010KT-ZZZ/.test(w) && /No flight category is shown/.test(w)));
  // The same in the base group, and with a readable visibility and sky after it.
  for (const body of ['17010KT-ZZZ 9999 SCT030', '17010KT-ZZZ']) {
    const b = taf(body).groups[0];
    assert.equal(b.flightCategory, null, body);
    assert.equal(b.windUnreadable, '17010KT-ZZZ', body);
  }
  // Only a certain LIFR survives it.
  assert.equal(taf('17010KT-ZZZ 0400 OVC001').groups[0].flightCategory, 'LIFR');
  // The slider state for that group also shows the wind as unreadable and no category.
  const parsedBad = taf('27010KT 9999 SCT030 TEMPO 0814/0818 17010KT-ZZZ');
  const at = site.tafStateAtHours(parsedBad, site.tafTimeBase(parsedBad), 3);
  assert.equal(at.overlays[0].state.category, null);
  assert.match(site.stateChips(at.overlays[0].state), /Wind couldn't be read/);
  assert.equal(t2bad('-SHRASCT030CBX').groups[1].flightCategory, null);
});

test('a whole token that is already a group is never split', () => {
  assert.equal(site.splitFusedGroup('-SHRA'), null);
  assert.equal(site.splitFusedGroup('SCT030CB'), null);
  assert.equal(site.splitFusedGroup('27010KT'), null);
  assert.equal(site.splitFusedGroup('BKN010'), null);
  assert.deepEqual([...site.splitFusedGroup('-SHRASCT030CB')], ['-SHRA', 'SCT030CB']);
  assert.deepEqual([...site.splitFusedGroup('17010KT-SHRA')], ['17010KT', '-SHRA']);
});

test('nothing in the remarks is split', () => {
  const p = site.parseMetar('METAR KXXX 081200Z 27010KT 10SM CLR 15/10 A3000 RMK AO2 -SHRASCT030CB');
  assert.equal(p.fused.length, 0);
});

// ── 3. Military TAF turbulence and icing groups (AFMAN 15-124 Tables 1.4 to 1.7)
test('650203 is moderate icing in cloud from 2,000 to 5,000 ft AGL', () => {
  const g = taf('27010KT 9999 SCT030 650203').groups[0];
  assert.equal(g.hazards.length, 1);
  assert.equal(g.hazards[0].kind, 'icing');
  assert.equal(g.hazards[0].text, 'Moderate icing in cloud (rime), 2,000 to 5,000 ft AGL');
  assert.equal(g.hazards[0].label, '650203: Moderate icing in cloud (rime), 2,000 to 5,000 ft AGL');
  assert.equal(g.flightCategory, 'VFR');   // the group is decoded, not skipped, and it does not set the category
  assert.deepEqual([...g.unparsed], []);
});

test('561205 is occasional severe turbulence in clear air from 12,000 to 17,000 ft AGL', () => {
  assert.equal(taf('27010KT 9999 SCT030 561205').groups[0].hazards[0].text,
    'Severe turbulence in clear air, occasional, 12,000 to 17,000 ft AGL');
});

test('every icing type in Table 1.5 and turbulence type in Table 1.7 is decoded', () => {
  const ice = ['Trace icing', 'Light icing (mixed)', 'Light icing in cloud (rime)', 'Light icing in precipitation (clear)',
    'Moderate icing (mixed)', 'Moderate icing in cloud (rime)', 'Moderate icing in precipitation (clear)',
    'Severe icing (mixed)', 'Severe icing in cloud (rime)', 'Severe icing in precipitation (clear)'];
  ice.forEach((name, n) => assert.equal(site.decodeTafHazard(`6${n}0501`).text, `${name}, 5,000 to 6,000 ft AGL`));
  const turb = { 0: 'No turbulence', 1: 'Light turbulence', 2: 'Moderate turbulence in clear air, occasional',
    3: 'Moderate turbulence in clear air, frequent', 4: 'Moderate turbulence in cloud, occasional',
    5: 'Moderate turbulence in cloud, frequent', 6: 'Severe turbulence in clear air, occasional',
    7: 'Severe turbulence in clear air, frequent', 8: 'Severe turbulence in cloud, occasional',
    9: 'Severe turbulence in cloud, frequent', X: 'Extreme turbulence' };
  for (const [k, name] of Object.entries(turb)) assert.equal(site.decodeTafHazard(`5${k}0501`).text, `${name}, 5,000 to 6,000 ft AGL`);
});

test('heights are hundreds of feet AGL, thickness is thousands of feet, and 10,000 ft is code 100', () => {
  assert.equal(site.decodeTafHazard('621009').text, 'Light icing in cloud (rime), 10,000 to 19,000 ft AGL');
  assert.equal(site.decodeTafHazard('620019').text, 'Light icing in cloud (rime), 100 to 9,100 ft AGL');
  assert.equal(site.decodeTafHazard('620003').text, 'Light icing in cloud (rime), from below 100 ft up to about 3,000 ft AGL');
});

test('a 5 or 6 group that does not fit the tables is shown as not decoded, with its digits', () => {
  const g = taf('27010KT 9999 SCT030 600000 500000').groups[0];
  assert.deepEqual(Array.from(g.hazards, (h) => h.label), ['Icing group (not decoded): 600000', 'Turbulence group (not decoded): 500000']);
  assert.equal(g.flightCategory, 'VFR');
  const card = site.buildGroupCard(g);
  assert.match(card, /Icing group \(not decoded\): 600000/);
  assert.match(card, /Turbulence group \(not decoded\): 500000/);
});

test('decoded 5 and 6 groups show on the group card and on the slider chips', () => {
  const g = taf('27010KT 9999 SCT030 650203 561205').groups[0];
  const card = site.buildGroupCard(g);
  assert.match(card, /650203: Moderate icing in cloud \(rime\), 2,000 to 5,000 ft AGL/);
  assert.match(card, /561205: Severe turbulence in clear air, occasional, 12,000 to 17,000 ft AGL/);
  assert.match(site.stateChips(site.tafStateFromGroup(g)), /650203: Moderate icing in cloud/);
});

// ── 3b. Slider: FM replaces icing and turbulence, TEMPO, BECMG and PROB inherit them unless restated
const hours = (parsed, T) => site.tafStateAtHours(parsed, site.tafTimeBase(parsed), T);
const kinds = (state) => Array.from(state.hazards, (h) => h.raw);
const BASE = '27010KT 9999 SCT030 650203 561205';

test('an FM group replaces everything, including icing and turbulence it does not restate', () => {
  const p = taf(`${BASE} FM081800 18010KT 9999 SCT040`);
  assert.deepEqual(kinds(hours(p, 2).prevailing), ['650203', '561205']);   // 14Z, before the FM
  assert.deepEqual(kinds(hours(p, 8).prevailing), []);                      // 20Z, after the FM
  assert.doesNotMatch(site.stateChips(hours(p, 8).prevailing), /icing|turbulence/);
  const restated = taf(`${BASE} FM081800 18010KT 9999 SCT040 620503`);
  assert.deepEqual(kinds(hours(restated, 8).prevailing), ['620503']);       // its own icing only, no turbulence
});

test("a TEMPO that changes only visibility still shows the base forecast's icing and turbulence", () => {
  const p = taf(`${BASE} TEMPO 0814/0818 3000 BR`);
  const at = hours(p, 3);   // 15Z
  assert.equal(at.overlays.length, 1);
  assert.deepEqual(kinds(at.overlays[0].state), ['650203', '561205']);
  assert.match(site.stateChips(at.overlays[0].state), /650203: Moderate icing in cloud/);
  assert.match(site.stateChips(at.overlays[0].state), /561205: Severe turbulence/);
  assert.deepEqual(kinds(at.prevailing), ['650203', '561205']);
});

test('a TEMPO that restates icing replaces the base icing for those hours only, and keeps the turbulence', () => {
  const p = taf(`${BASE} TEMPO 0814/0818 3000 BR 620503`);
  const at = hours(p, 3);
  assert.deepEqual(kinds(at.overlays[0].state), ['561205', '620503']);
  assert.deepEqual(kinds(at.prevailing), ['650203', '561205']);             // the base is untouched
  assert.deepEqual(kinds(hours(p, 8).prevailing), ['650203', '561205']);    // after the TEMPO window
  assert.equal(hours(p, 8).overlays.length, 0);
});

test('a TEMPO that restates turbulence replaces the base turbulence and keeps the icing', () => {
  const at = hours(taf(`${BASE} TEMPO 0814/0818 3000 BR 511003`), 3);
  assert.deepEqual(kinds(at.overlays[0].state), ['650203', '511003']);
});

test('BECMG and PROB groups inherit the same way', () => {
  const becmg = taf(`${BASE} BECMG 0814/0816 18010KT 9999 SCT040`);
  assert.deepEqual(kinds(hours(becmg, 3).transitions[0].state), ['650203', '561205']);   // inside the window, after state
  assert.deepEqual(kinds(hours(becmg, 6).prevailing), ['650203', '561205']);             // the change has completed
  const prob = taf(`${BASE} PROB30 0814/0818 3000 TSRA`);
  assert.deepEqual(kinds(hours(prob, 3).overlays[0].state), ['650203', '561205']);
  const probTempo = taf(`${BASE} PROB40 TEMPO 0814/0818 3000 BR 600502`);
  assert.deepEqual(kinds(hours(probTempo, 3).overlays[0].state), ['561205', '600502']);
});

test("a TEMPO's own group card lists only what it states", () => {
  const g = taf(`${BASE} TEMPO 0814/0818 3000 BR 620503`).groups[1];
  assert.deepEqual(Array.from(g.hazards, (h) => h.raw), ['620503']);
});

// ── 4. BLACK
test('BLACKWHT says the airfield is not usable for reasons other than cloud or visibility', () => {
  const p = site.parseMetar('METAR EGVN 081200Z 27010KT 9999 FEW030 15/10 Q1015 BLACKWHT');
  const f = field(p, 'BLACKWHT');
  assert.equal(f.label, 'BLACK prefix');
  assert.match(f.explanation, /not usable for reasons other than cloud or visibility minima/);
  assert.match(f.explanation, /UK Met Office aerodrome colour state register/);
  assert.match(f.explanation, /color state that follows is WHT/);
  assert.ok(p.notes.some((n) => /BLACKWHT: the airfield is not usable/.test(n)));
  assert.equal(p.flightCategory, 'VFR');   // the category is weather only
});

test('a bare BLACK says the same, and a plain color state is unchanged', () => {
  assert.equal(field(site.parseMetar('METAR EGVN 081200Z 27010KT 9999 FEW030 15/10 Q1015 BLACK'), 'BLACK').label, 'BLACK prefix');
  const plain = site.parseMetar('METAR EGVN 081200Z 27010KT 9999 FEW030 15/10 Q1015 WHT');
  assert.equal(field(plain, 'WHT').label, 'Color state');
  assert.equal(plain.notes.length, 0);
});

// ── 5. Bare /////
test('///// where the position does not say which field it is gets the unclear label and no category', () => {
  const p = metar('27010KT 10SM ///// 15/10 A3000');
  assert.equal(field(p, '/////').label, 'Missing group (field unclear)');
  assert.doesNotMatch(field(p, '/////').label, /Temperature/);
  assert.ok(p.unreadable.includes('/////'));
  assert.equal(p.flightCategory, null);
});

test('///// directly before the altimeter, after the sky, is the temperature group', () => {
  const p = metar('27010KT 10SM CLR ///// A3000');
  assert.equal(field(p, '/////').label, 'Temperature / Dewpoint');
  assert.equal(p.flightCategory, 'VFR');
});

// ── 6. FN##### at the end of a TAF
test('an FN group that ends the TAF is shown as not decoded and does not withhold the category', () => {
  const t = taf('27010KT 9999 SCT030 FM081800 18010KT 9999 SCT040 FN20003');
  assert.equal(t.fnGroup, 'FN20003');
  assert.ok(t.groups.every((g) => g.flightCategory === 'VFR'));
  assert.match(t.notes[0], /^FN group \(not decoded\): FN20003\./);
  assert.deepEqual([...t.warnings], []);
});

test('an FN group that is not exactly FN and five digits at the very end still withholds the category', () => {
  for (const bad of ['FN2000', 'FN200031', 'FN2000A']) {
    const t = taf(`27010KT 9999 SCT030 ${bad}`);
    assert.equal(t.fnGroup, null, bad);
    assert.equal(t.groups[0].flightCategory, null, bad);
  }
  const mid = taf('27010KT 9999 SCT030 FN20003 FM081800 18010KT 9999 SCT040');
  assert.equal(mid.fnGroup, null);
  assert.equal(mid.groups[0].flightCategory, null);
});

test('the three real Navy TAFs ending in FN keep every group\'s category', () => {
  const fixture = readRepoFile('tests/fixtures/tafs-2026-11-03.txt').split(/\r?\n/).filter((l) => / FN\d{5}$/.test(l));
  assert.equal(fixture.length, 3);
  for (const raw of fixture) assert.ok(site.parseTaf(raw).groups.every((g) => g.flightCategory), raw);
});

// ── 7. GRID winds
test('GRID30007KT in a METAR is a grid wind: raw values shown, nothing converted or compared', () => {
  const p = site.parseMetar('METAR NZFX 081200Z GRID30007KT 9999 SCT040 M05/M10 Q0990');
  assert.equal(p.wind, null);
  assert.equal(p.windUnreadable, null);
  assert.deepEqual([p.gridWind.gridDir, p.gridWind.speed, p.gridWind.unit], [300, 7, 'KT']);
  const f = field(p, 'GRID30007KT');
  assert.equal(f.label, 'Grid wind, not referenced to true north');
  assert.match(f.explanation, /grid direction 300 at 7 KT/);
  assert.equal(p.flightCategory, 'VFR');
  for (const runway of [null, RWY_16]) {
    const out = lines(p, runway);
    const wind = out.find((l) => /grid wind/.test(l.text));
    assert.equal(wind.status, 'notChecked');
    assert.ok(!out.some((l) => /crosswind could be|Crosswind|Sustained wind/i.test(l.text) && l.status !== 'notChecked'), out.map((l) => l.text).join(' | '));
  }
});

test('GRID27007KT with a gust keeps the gust as written', () => {
  const p = site.parseMetar('METAR NZWD 081200Z GRID27007G15KT 9999 SCT040 M05/M10 Q0990');
  assert.deepEqual([p.gridWind.gridDir, p.gridWind.speed, p.gridWind.gust], [270, 7, 15]);
});

test('GRID27007KT in a TAF group never falls back to the true wind before it', () => {
  const t = taf('18010KT 9999 SCT030 FM081800 GRID27007KT 9999 SCT040');
  const g = t.groups[1];
  assert.equal(g.gridWind.raw, 'GRID27007KT');
  assert.equal(g.wind, null);
  assert.equal(g.windUnreadable, null);
  assert.equal(g.flightCategory, 'VFR');
  const card = site.buildGroupCard(g);
  assert.match(card, /Grid wind, not referenced to true north: GRID27007KT/);
  assert.doesNotMatch(card, /180°/);
  const state = site.mergeTafGroup(site.tafStateFromGroup(t.groups[0]), g);
  assert.equal(state.wind, null);
  assert.match(site.stateChips(state), /Grid wind, not referenced to true north: GRID27007KT/);
});

test('a GRID token anywhere but the wind position is still an unreadable wind', () => {
  const p = site.parseMetar('METAR KXXX 081200Z 27010KT 10SM GRID30007KT CLR 15/10 A3000');
  assert.equal(p.gridWind, null);
  assert.equal(p.windUnreadable, 'GRID30007KT');
});

// ── No em dashes in the text added here
test('the words added for this batch have no em dashes', () => {
  const p = site.parseMetar('METAR UBTT 081200Z ///10G20KT 9999 -SHRASCT030CB BLACKWHT ///// 15/10 Q1015');
  const t = taf('GRID30007KT 9999 SCT030 650203 600000 FN20003');
  const ours = new Set(['///10G20KT', '-SHRASCT030CB', 'BLACKWHT', '/////']);
  const text = [...p.notes, ...p.fields.filter((f) => ours.has(f.token)).map((f) => f.label + f.explanation), ...t.notes, ...t.groups[0].hazards.map((h) => h.label)].join(' ');
  assert.doesNotMatch(text, /—/);
});
