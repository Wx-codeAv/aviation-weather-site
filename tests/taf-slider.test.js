// TAF slider tests. Run with: node --test
// The expected values for the 23 scoped cases are the same hand-worked ones taf.test.js uses.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDecoders, readRepoFile } = require('./load-site');
const { REAL_TAFS, SCOPED_CASES } = require('./fixtures/taf-cases');

const site = loadDecoders();

const elementText = (state) => [
  state.wind && state.wind.raw,
  state.visibility && state.visibility.raw,
  ...state.weather.map((w) => w.raw),
  ...state.sky.map((s) => s.raw),
].filter(Boolean).join(' ');

const BASE = 'TAF KXXX 011130Z 0112/0212 18010KT 5SM BR BKN020';
const utc = (...parts) => new Date(Date.UTC(...parts));
const NOW = utc(2026, 10, 3, 12);
const view = (raw, step) => {
  const parsed = site.parseTaf(raw);
  const { start } = site.tafDefaultStep(parsed, NOW);
  return site.tafSliderView(parsed, step, start, 'en-US', 'America/New_York');
};
const stepFor = (parsed, time) => Math.floor(site.tafTimeBase(parsed).toHours(time));

// ── The 23 scoped cases, on the slider
for (const [key, name, time, prevailing, category, active] of SCOPED_CASES) {
  test(`slider ${key} D${time.day} ${time.hour}Z: ${name}`, () => {
    const raw = REAL_TAFS[key];
    const v = view(raw, stepFor(site.parseTaf(raw), time));
    assert.equal(elementText(v.base), prevailing, 'the base forecast is never replaced');
    assert.equal(v.base.category, category);
    const becoming = active.filter(([type]) => type === 'BECMG');
    const possible = active.filter(([type]) => type !== 'BECMG');
    assert.deepEqual([...v.becoming].map((o) => [o.type, elementText(o.state), o.state.category]), becoming);
    assert.deepEqual([...v.possible].map((o) => [o.type, elementText(o.state), o.state.category]), possible);
  });
}

// ── Layers
test('a TEMPO shows beside the base forecast, with its own category', () => {
  const v = view(REAL_TAFS.T8, 3);
  assert.equal(v.base.category, 'VFR');
  assert.equal(v.possible[0].state.category, 'IFR');
  const html = site.buildSliderReadout(v);
  assert.ok(html.indexOf('Base forecast') < html.indexOf('Possible'));
  assert.match(html, /cat-vfr">VFR/);
  assert.match(html, /cat-ifr">IFR/);
});

test('a BECMG window shows before and after conditions, each with a category', () => {
  const html = site.buildSliderReadout(view(REAL_TAFS.T6, 11));
  assert.match(html, /Before the change/);
  assert.match(html, /After the change/);
  assert.match(html, /cat-mvfr">MVFR/);
  assert.match(html, /cat-vfr">VFR/);
  assert.match(html, /unspecified time/);
});

test('a BECMG is not listed in the possible layer', () => {
  const v = view(REAL_TAFS.T6, 11);
  assert.equal(v.possible.length, 0);
  assert.match(site.buildSliderReadout(v), /No Temporarily or probability group covers this hour/);
});

test('after a BECMG window, only the new conditions show', () => {
  const html = site.buildSliderReadout(view(REAL_TAFS.T6, 12));
  assert.doesNotMatch(html, /Before the change/);
  assert.match(html, /In effect/);
});

test('three possible groups each keep a category, and the lowest is named', () => {
  const v = view(REAL_TAFS.T6, 5);
  assert.deepEqual([...v.possible].map((p) => p.state.category), ['IFR', 'IFR', 'LIFR']);
  assert.equal(v.possibleLowest, 'LIFR');
  assert.match(site.buildSliderReadout(v), /Lowest <span class="cat-badge cat-lifr">/);
});

test('each possible group says what it means', () => {
  const [tempo, prob40, prob30] = view(REAL_TAFS.T6, 5).possible;
  assert.match(tempo.meaning, /less than half of this period/);
  assert.match(prob40.meaning, /^40 to 49% chance.*less than half/);
  assert.match(prob30.meaning, /^30 to 39% chance/);
  assert.match(view(REAL_TAFS.T2, 26).possible[0].meaning, /^30 to 39% chance of these conditions during this period/);
});

// ── Lowest category
for (const [cats, expected] of [
  [['VFR'], 'VFR'],
  [['VFR', 'MVFR'], 'MVFR'],
  [['IFR', 'MVFR'], 'IFR'],
  [['MVFR', null], null],
  [[null, 'LIFR'], 'LIFR'],
]) {
  test(`the lowest of ${cats.join(', ')} is ${expected}`, () => {
    assert.equal(site.lowestCategory(cats.map((category) => ({ category }))), expected);
  });
}

// ── Fail loudly
test('a base forecast with no category says so, and never shows VFR', () => {
  const v = view('TAF KXXX 011130Z 0112/0212 18010KT', 2);
  assert.equal(v.base.category, null);
  const html = site.buildSliderReadout(v);
  assert.match(html, /No category/);
  assert.match(html, /Visibility not stated/);
  assert.match(html, /Sky not stated/);
  assert.doesNotMatch(html, /cat-vfr/);
});

for (const [name, raw, step] of [
  ['TEMPO', `${'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC'} TEMPO 0116/0118 OVC0X0`, 5],
  ['TEMPO with a readable visibility', `${'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC'} TEMPO 0116/0118 3SM OVC0X0`, 5],
]) {
  test(`a ${name} with an unreadable sky token shows no category, not the one it inherits`, () => {
    const v = view(raw, step);
    assert.equal(v.base.category, 'VFR');
    assert.equal(v.possible[0].state.category, null);
    assert.match(site.buildSliderReadout(v), /couldn't be read \(OVC0X0\)/);
  });
}

test('an unreadable token in a finished BECMG stays unknown until an FM replaces it', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC BECMG 0114/0115 OVC0X0 FM011800 18010KT P6SM SKC';
  assert.equal(view(raw, 2).becoming[0].state.category, null, 'in the window');
  assert.equal(view(raw, 5).base.category, null, 'after the window');
  assert.equal(view(raw, 6).base.category, 'VFR', 'after FM');
});

test('a later group that restates visibility and sky clears an earlier unreadable token', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC BECMG 0114/0115 OVC0X0 TEMPO 0116/0118 3SM BKN010';
  assert.equal(view(raw, 5).possible[0].state.category, 'MVFR', '3 SM and a 1,000 ft ceiling');
});

test('an unreadable base layer shows no category in the slider or the band', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SCT050 OVC0X0';
  assert.equal(view(raw, 2).base.category, null);
  assert.doesNotMatch(site.buildTafOverview(site.parseTaf(raw)), /title="VFR /);
});

test('an unreadable token does not hide a LIFR that is already certain', () => {
  assert.equal(view('TAF KXXX 011130Z 0112/0212 18010KT 1/2SM FG OVC0X0', 2).base.category, 'LIFR');
});

// ── Unreadable sky inside an FM, and a TEMPO that inherits it.
// The FM starts at 16Z (step 4 from the 12Z start); the TEMPO runs 18Z to 20Z (step 6 and 7).
const HEAD = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC';
const bandTitles = (raw) => [...site.buildTafOverview(site.parseTaf(raw)).matchAll(/class="tl-seg[^"]*" style="[^"]*" title="([^"]*)"/g)].map((m) => m[1]);
// The band segment that starts at the FM time (titles read "<category> D01 16:00Z → D02 12:00Z").
const fmBandTitle = (raw) => bandTitles(raw).find((t) => /D01 16:00Z →/.test(t));
const cardCategory = (raw, type) => site.parseTaf(raw).groups.find((g) => g.type === type).flightCategory;

for (const [vis, why] of [['1/2SM FG', 'a fraction'], ['M1/4SM', 'less than'], ['3/4SM', 'three quarters'], ['0800', 'metric, under 1 SM']]) {
  test(`an FM with OVC0X0 and visibility below 1 SM (${why}) is LIFR on the card, slider, and band`, () => {
    const raw = `${HEAD} FM011600 18010KT ${vis} OVC0X0`;
    assert.equal(cardCategory(raw, 'FM'), 'LIFR');
    assert.equal(view(raw, 5).base.category, 'LIFR');
    assert.match(fmBandTitle(raw), /^LIFR /);
    assert.match(site.parseTaf(raw).warnings.join(' '), /LIFR is shown because the visibility it does state alone sets it/);
  });
}

for (const vis of ['1SM', '5SM']) {
  test(`an FM with OVC0X0 and ${vis} has no category anywhere, since that visibility does not settle LIFR`, () => {
    const raw = `${HEAD} FM011600 18010KT ${vis} OVC0X0`;
    assert.equal(cardCategory(raw, 'FM'), null);
    assert.equal(view(raw, 5).base.category, null);
    assert.match(fmBandTitle(raw), /^No category /);
    assert.doesNotMatch(site.buildSliderReadout(view(raw, 5)), /cat-(vfr|mvfr|ifr|lifr)"/);
  });
}

for (const [tempo, expected] of [
  ['3SM', null], ['3SM -RA', null], ['-TSRA', null], ['P6SM', null], ['1SM', null],
  ['1/2SM', 'LIFR'], ['3/4SM', 'LIFR'], ['0800', 'LIFR'],
]) {
  test(`a TEMPO "${tempo}" inside an FM with OVC0X0 inherits the unreadable sky: ${expected || 'no category'}`, () => {
    const raw = `${HEAD} FM011600 18010KT 5SM OVC0X0 TEMPO 0118/0120 ${tempo}`;
    assert.equal(cardCategory(raw, 'TEMPO'), expected, 'the group card');
    const v = view(raw, 7);
    assert.equal(v.possible[0].state.category, expected, 'the slider overlay');
    assert.equal(v.base.category, null, 'the prevailing forecast stays unknown');
    assert.match(fmBandTitle(raw), /^No category /, 'the band shows only the prevailing forecast');
    assert.doesNotMatch(site.buildSliderReadout(v), /cat-vfr"/);
  });
}

// ── Chip wording: "couldn't be read" for an unreadable token, "not stated" only when the group leaves it out
const chipTexts = (raw, step) => [...site.buildSliderReadout(view(raw, step)).matchAll(/taf-chip-(wind|vis|sky)">([^<]*)</g)].map((m) => m[2]);

test('an unreadable sky token makes the sky chip say it could not be read', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT 5SM OVC0X0`, 5);
  assert.ok(chips.includes('Sky couldn\'t be read'), chips.join(' | '));
  assert.ok(!chips.includes('Sky not stated'));
  assert.ok(chips.includes('5SM'), 'the visibility it did state still shows');
});

test('an unreadable sky token does not blame the visibility chip', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT OVC0X0`, 5);
  assert.ok(chips.includes('Visibility not stated'), 'the group really leaves visibility out');
  assert.ok(chips.includes('Sky couldn\'t be read'));
});

test('an unreadable visibility token makes the visibility chip say so, and the sky after it too', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT 5XSM BKN020`, 5);
  assert.ok(chips.includes('Visibility couldn\'t be read'), chips.join(' | '));
  assert.ok(chips.includes('Sky couldn\'t be read'), 'BKN020 sits after the bad token and was never read');
  assert.ok(!chips.includes('Visibility not stated') && !chips.includes('Sky not stated'));
});

test('an unreadable visibility token with nothing after it leaves the sky as truly not stated', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT 5XSM`, 5);
  assert.ok(chips.includes('Visibility couldn\'t be read'));
  assert.ok(chips.includes('Sky not stated'));
});

test('wind shear after an unreadable visibility token does not count as an unread sky', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT 5XSM WS020/25040KT`, 5);
  assert.ok(chips.includes('Sky not stated'));
});

test('a group that truly omits visibility and sky still says not stated', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT`, 5);
  assert.ok(chips.includes('Visibility not stated'));
  assert.ok(chips.includes('Sky not stated'));
  assert.ok(!chips.some((c) => /couldn't be read/.test(c)));
});

test('a TEMPO that inherits an unreadable sky shows the sky chip as unreadable, not not stated', () => {
  const chips = chipTexts(`${HEAD} FM011600 18010KT 5SM OVC0X0 TEMPO 0118/0120 3SM`, 7);
  assert.ok(chips.includes('Sky couldn\'t be read'), chips.join(' | '));
  assert.ok(!chips.includes('Sky not stated'));
});

test('once a later group restates visibility and sky, the unreadable chip wording goes away', () => {
  const raw = `${HEAD} FM011600 18010KT 5SM OVC0X0 FM011800 18010KT 5SM BKN020`;
  assert.ok(!chipTexts(raw, 7).some((c) => /couldn't be read/.test(c)));
  assert.ok(chipTexts(raw, 7).includes('BKN020'));
});

test('low-level wind shear shows on the slider', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC WS020/25040KT';
  assert.match(site.buildSliderReadout(view(raw, 2)), /WS 2,000 ft: 250° \/ 40 KT/);
});

test('wind shear does not survive an FM', () => {
  const raw = 'TAF KXXX 011130Z 0112/0212 18010KT P6SM SKC WS020/25040KT FM011600 18010KT P6SM SKC';
  assert.doesNotMatch(site.buildSliderReadout(view(raw, 5)), /WS 2,000/);
});

test('text from the TAF is escaped', () => {
  const v = view(BASE, 1);
  v.base.category = null;
  v.base.unreadable = '<B>';
  assert.match(site.buildSliderReadout(v), /&lt;B&gt;/);
});

// ── Default position
const CHECK = 'TAF KXXX 030000Z 0312/0412 18010KT P6SM SKC';
const defaults = (now, raw = CHECK) => {
  const { step, inside } = site.tafDefaultStep(site.parseTaf(raw), now);
  return [step, inside];
};

for (const [name, now, expected] of [
  ['at the start of the period', utc(2026, 10, 3, 12), [0, true]],
  ['inside, snapped down to the hour', utc(2026, 10, 3, 15, 59), [3, true]],
  ['on the last hour', utc(2026, 10, 4, 11, 59), [23, true]],
  ['before the period', utc(2026, 10, 3, 11, 59), [0, false]],
  ['exactly at the end, which is exclusive', utc(2026, 10, 4, 12), [0, false]],
  ['long after the period', utc(2026, 10, 20, 12), [0, false]],
]) {
  test(`default position ${name}`, () => assert.deepEqual(defaults(now), expected));
}

test('default position works across the end of a 30-day month', () => {
  const raw = 'TAF KABC 301730Z 3018/0124 32012KT P6SM SKC';
  assert.deepEqual(defaults(utc(2026, 10, 30, 21, 30), raw), [3, true]);
  assert.deepEqual(defaults(utc(2026, 11, 1, 3, 10), raw), [9, true]);
});

test('a period that rolls over after day 30 is never placed in a 31-day month', () => {
  // 3018/0124 is 30 hours only if the month has 30 days. December has 31, so December 30 can't be it.
  assert.deepEqual(defaults(utc(2026, 11, 30, 21), 'TAF KABC 301730Z 3018/0124 32012KT P6SM SKC'), [0, false]);
});

test('default position works across the end of a 31-day month', () => {
  assert.deepEqual(defaults(utc(2027, 0, 1, 3), 'TAF KABC 311730Z 3118/0124 32012KT P6SM SKC'), [9, true]);
});

test('default position works across a year end', () => {
  const parsed = site.parseTaf('TAF KABC 311730Z 3118/0124 32012KT P6SM SKC');
  const { start } = site.tafDefaultStep(parsed, utc(2027, 0, 1, 3));
  assert.equal(start.getTime(), utc(2026, 11, 31, 18).getTime());
});

test('a period starting on day 31 finds a month that has one', () => {
  const parsed = site.parseTaf('TAF KABC 311130Z 3112/3124 32012KT P6SM SKC');
  const { start } = site.tafDefaultStep(parsed, utc(2026, 10, 4));
  assert.equal(start.getTime(), utc(2026, 9, 31, 12).getTime());
});

// ── Hours and labels
test('steps are whole hours, and the last one is before the exclusive end', () => {
  const parsed = site.parseTaf(CHECK);
  const v = (step) => site.tafSliderView(parsed, step, site.tafDefaultStep(parsed, NOW).start, 'en-US', 'UTC');
  assert.equal(v(0).timeZ, 'D03 12:00Z');
  assert.equal(v(23).timeZ, 'D04 11:00Z');
  assert.equal(v(24), null);
  assert.equal(v(-1), null);
});

test('Z times cross the end of a month correctly', () => {
  const v = view('TAF KABC 301730Z 3018/0124 32012KT P6SM SKC', 7);
  assert.equal(v.timeZ, 'D01 01:00Z');
});

test('local time is secondary to Z and follows the time zone, including daylight saving', () => {
  const clean = (s) => s.replace(/\s/g, ' ');
  const parsed = site.parseTaf(CHECK);
  const start = site.tafDefaultStep(parsed, NOW).start;
  assert.equal(clean(site.tafSliderView(parsed, 0, start, 'en-US', 'America/New_York').timeLocal), 'Tue, 7:00 AM EST');
  assert.equal(clean(site.tafSliderView(parsed, 0, start, 'en-US', 'America/Chicago').timeLocal), 'Tue, 6:00 AM CST');
  const summer = site.tafDefaultStep(parsed, utc(2026, 6, 3, 12)).start;
  assert.equal(clean(site.tafSliderView(parsed, 0, summer, 'en-US', 'America/New_York').timeLocal), 'Fri, 8:00 AM EDT');
});

test('with no month to work from, local time is left out and Z remains', () => {
  const parsed = site.parseTaf(CHECK);
  const v = site.tafSliderView(parsed, 0, null, 'en-US', 'UTC');
  assert.equal(v.timeLocal, null);
  assert.equal(v.timeZ, 'D03 12:00Z');
});

// ── Minute-precise FM, which an hourly slider can't land on
const MINUTE_FM = `${BASE} FM011830 25015KT P6SM SKC`;

test('a minute-precise FM applies from the next whole hour, with a note before it', () => {
  const before = view(MINUTE_FM, 6);
  assert.equal(before.base.wind.raw, '18010KT');
  assert.match(site.buildSliderReadout(before), /changes at D01 18:30Z, partway through this hour/);
  const after = view(MINUTE_FM, 7);
  assert.equal(after.base.wind.raw, '25015KT');
  assert.doesNotMatch(site.buildSliderReadout(after), /partway/);
});

test('the axis marks a minute-precise FM at its exact time, between the hours', () => {
  const parsed = site.parseTaf(MINUTE_FM);
  const html = site.buildSliderAxis(parsed, site.tafTimeBase(parsed));
  assert.match(html, new RegExp(`taf-sl-mark" style="left:calc\\(var\\(--taf-thumb\\) / 2 \\+ \\(100% - var\\(--taf-thumb\\)\\) \\* ${(6.5 / 23).toFixed(4)}\\)`));
});

test('an FM on the hour gets no partway note or mark', () => {
  const parsed = site.parseTaf(`${BASE} FM011800 25015KT P6SM SKC`);
  assert.equal(site.tafMidHourChanges(parsed, site.tafTimeBase(parsed)).length, 0);
});

test('every real TAF has a usable view at every hour', () => {
  const fixture = readRepoFile('tests/fixtures/tafs-2026-11-03.txt').trim().split(/\r?\n/);
  for (const raw of fixture) {
    const parsed = site.parseTaf(raw);
    const base = site.tafTimeBase(parsed);
    for (let step = 0; step < base.dur; step++) {
      const v = site.tafSliderView(parsed, step, null, 'en-US', 'UTC');
      assert.ok(v, `${raw} at ${step}`);
      assert.ok(site.buildSliderReadout(v).includes('Base forecast'));
      assert.doesNotMatch(site.tafSliderSpoken(v), /undefined/);
    }
  }
});

// ── Spoken text and page wiring
test('the spoken text gives the time and both categories', () => {
  assert.equal(site.tafSliderSpoken(view(REAL_TAFS.T8, 3)), 'D03 06:00Z. Base forecast VFR. Possible: Temporarily IFR.');
  assert.equal(site.tafSliderSpoken(view(REAL_TAFS.T6, 11)), 'D03 11:00Z. Base forecast before the change MVFR. After the change VFR. Nothing possible listed.');
});

test('the slider sits inside a region that does not announce every step', () => {
  const page = readRepoFile('pages/decoder.html');
  assert.match(page, /<div id="taf-slider" class="taf-slider"><\/div>/);
  assert.match(readRepoFile('js/taf-slider.js'), /id="taf-sl-readout" aria-live="off"/);
  assert.ok(page.indexOf('taf-decoder.js') < page.indexOf('taf-slider.js'));
});

test('no em dashes in the slider text', () => {
  assert.doesNotMatch(readRepoFile('js/taf-slider.js'), /—/);
});
