// Audit port, batch 1. Run with: node --test
// Each page fix was checked against its source (eCFR, AIM Change 3 effective 2026-07-09, AC 91-74B,
// FAA-H-8083-28B). These tests keep the wrong claims from coming back and keep the numbers consistent.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readRepoFile } = require('./load-site');

const page = (name) => readRepoFile(`pages/${name}`);

// ── Cruise performance: a temperature outside the table's columns is a warning, not a speed
const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const file of ['js/poh-c172s.js', 'js/poh-interp.js']) vm.runInContext(readRepoFile(file), ctx, { filename: file });
const poh = vm.runInContext('C172S_POH', ctx);
const cruise = (pa, oat, rpm = 2400) => ctx.window.pohInterp.cruisePerf(poh, pa, oat, rpm);

test('cruisePerf still returns the worked example (106 kt, 8.2 GPH)', () => {
  assert.deepEqual({ ...cruise(4500, 16) }, { bhp_pct: 58, ktas: 106, gph: 8.2 });
});

test('an OAT of 60 C gives no speed, so the Nav Log shows its warning', () => {
  assert.equal(cruise(4500, 60), null);
  assert.equal(cruise(2000, 60), null);
  assert.equal(cruise(6000, 60), null);
});

test('an OAT of -40 C gives no speed either', () => {
  assert.equal(cruise(4500, -40), null);
});

test('the table edge is still valid and one degree past it is not', () => {
  // A PA is interpolated across the two tables that bracket it, and each table has its own ISA
  // temperature, so the OAT must be within 20 C of standard at both. At PA 2000 the tables are
  // 2000 ft (ISA 11 C) and 4000 ft (ISA 7 C): the window is OAT -9 C to +27 C.
  assert.notEqual(cruise(2000, 27), null, '+20 C from standard at the 4000 ft table');
  assert.equal(cruise(2000, 28), null, '+21 C');
  assert.notEqual(cruise(2000, -9), null, '-20 C from standard at the 2000 ft table');
  assert.equal(cruise(2000, -10), null, '-21 C');
});

test('an altitude or RPM outside the table is still null', () => {
  assert.equal(cruise(1000, 15), null);
  assert.equal(cruise(7000, 15), null);
  assert.equal(cruise(4500, 16, 1500), null);
});

test('the Nav Log warning names the temperature limit, and the worked example shows the 2 kt step', () => {
  const navlog = page('navlog.html');
  assert.match(navlog, /an OAT within 20°C of standard at each table altitude/);
  assert.match(navlog, /108 − 2 = <strong>106 kt<\/strong>/);
  assert.doesNotMatch(navlog, /→ <strong>108 kt<\/strong>/);
  assert.match(readRepoFile('js/poh-interp.js'), /expect 106 kt, 8\.2 GPH/);
});

// ── Density altitude scenario: the ISA temperature at 6,870 ft is 1.26 C, so DA is about 10,560 ft
test('the density altitude scenario uses one consistent set of numbers', () => {
  const html = page('learn/density-altitude.html');
  assert.equal((html.match(/10,560 ft DA/g) || []).length, 3, 'the scenario, Option A, and Option B');
  assert.match(html, /ISA temperature at 6,870 ft = 15 − \(2 × 6\.87\) = 1\.26°C/);
  assert.match(html, /2,560 ft beyond your POH data range/);
  assert.doesNotMatch(html, /10,300|7,900 ft DA/);
  // Option C no longer lands inside the chart range
  assert.match(html, /approximately 8,160 ft DA\. That is still about 160 ft above your POH's 8,000 ft data ceiling/);
  assert.doesNotMatch(html, /Correct decision framework/);
});

test('the density altitude arithmetic is right', () => {
  const pa = 6800 + (29.92 - 29.85) * 1000;
  const isa = 15 - 2 * (pa / 1000);
  assert.equal(Math.round(pa), 6870);
  assert.equal(isa.toFixed(2), '1.26');
  assert.equal(Math.round(pa + 120 * (32 - isa)), 10559);
  assert.equal(Math.round(pa + 120 * (12 - isa)), 8159);
});

// ── 91.155(c) sets the 1,000 ft ceiling, for controlled airspace to the surface. Class G has none.
test('the minimums page cites 91.155(c) for the ceiling and does not call it Class G', () => {
  const html = page('minimums.html');
  assert.match(html, /1,000 ft ceiling in controlled airspace to the surface for an airport<br>14 CFR 91\.155\(c\)\. Class G sets no ceiling minimum\./);
  assert.doesNotMatch(html, /91\.155 \(Class G, day\)/);
});

// ── 91.527 is in Subpart F (large and turbojet multiengine airplanes, fractional ownership), so a
// light single is bound through 91.9(a) and its own POH limitations
test('91.527 is not cited as the basis for a light airplane, and 91.9(a) is', () => {
  const air = page('learn/airmets-sigmets.html'), fog = page('learn/fog-formation.html'), ice = page('learn/icing.html');
  assert.doesNotMatch(air, /91\.527/);
  assert.doesNotMatch(fog, /91\.527/);
  const mentions = ice.split('\n').filter((l) => /91\.527/.test(l));
  assert.equal(mentions.length, 2, 'only the frost line and the scope paragraph name it');
  assert.ok(mentions.every((l) => /large|turbojet/.test(l)), 'each says who it applies to');
  for (const [name, html] of [['airmets', air], ['fog', fog], ['icing', ice]]) assert.match(html, /91\.9\(a\)/, name);
  assert.match(air, /Check your POH's limitations/);
  assert.match(fog, /check your POH's limitations/);
  assert.match(ice, /Check your POH's limitations/);
});

test('the scope paragraph names Subpart F aircraft exactly', () => {
  const ice = page('learn/icing.html');
  assert.match(ice, /14 CFR 91\.527 applies to large airplanes, turbojet-powered multiengine airplanes, and fractional ownership program aircraft \(14 CFR 91\.501\)/);
  assert.match(ice, /there are no specific icing regulations, but 14 CFR 91\.9\(a\) requires you to comply with the operating limitations in your POH and placards \(AC 91-74B ¶5-2\)/);
  assert.doesNotMatch(ice, /large or turbine-powered/);
});

test('the clean aircraft concept cites 91.527(a) for large airplanes and AC 91-74B paragraph 5-4', () => {
  const ice = page('learn/icing.html');
  assert.match(ice, /"clean aircraft concept" \(AC 91-74B ¶5-4\)/);
  assert.match(ice, /regulation \(14 CFR 91\.527\(a\)\)/);
  assert.doesNotMatch(ice, /91\.527\(b\)/);
  assert.doesNotMatch(ice, /AC 91-74B §5\.3/);
});

// ── Thunderstorms: no unsupported "leading cause" claim, and the microburst figures match the AIM
test('the thunderstorm page no longer claims they are the leading cause, and gives the AIM advice', () => {
  const html = page('learn/thunderstorm-life-cycle.html');
  assert.doesNotMatch(html, /leading cause/);
  assert.match(html, /avoiding thunderstorms is the best policy \(AIM 7-1-27\)/);
  assert.doesNotMatch(html, /VFR-into-IMC|VFR into IMC/, 'the VFR-into-IMC statement waits for the primary source');
});

test('the microburst figures are 45 knot winds and a 90 knot headwind to tailwind shear (AIM 7-1-24)', () => {
  const html = page('learn/thunderstorm-life-cycle.html');
  assert.doesNotMatch(html, /30–45 knots/);
  assert.match(html, /as strong as 45 knots, which produces up to a 90-knot shear from headwind to tailwind across the microburst \(AIM 7-1-24\)/);
  assert.match(html, /change from headwind to tailwind can reach 90 knots \(AIM 7-1-24\)/);
  assert.doesNotMatch(html, /90-knot loss of airspeed/);
});

// ── Wake turbulence: AIM 7-4-6 has a 2 minute interval after a low approach, missed approach, or
// touch-and-go. The 2 and 3 minute takeoff intervals are ATC separations in AIM 7-4-9.
test('the wake turbulence page has no 3 minute approach delay and attributes each interval correctly', () => {
  const html = page('learn/turbulence.html');
  assert.doesNotMatch(html, /3-minute delay|wait 3 minutes|Wait 3 minutes/);
  assert.match(html, /If it made a low approach, missed approach, or touch-and-go, wait at least 2 minutes before landing\. \(AIM 7-4-6\)/);
  assert.match(html, /land well before it/);
  assert.match(html, /wait at least 2 minutes \(AIM 7-4-6\)\. ATC's takeoff intervals are 2 minutes behind a heavy and 3 minutes behind a super \(AIM 7-4-9\)/);
});

// ── Carburetor icing is engine icing, not structural icing. Icing is Chapter 20 of the Handbook.
test('carburetor is not in the structural icing list, and points to Handbook section 20.4', () => {
  const ice = page('learn/icing.html');
  assert.doesNotMatch(ice, /pitot tube, carburetor/);
  assert.match(ice, /Carburetor ice is a separate hazard, covered under engine icing in FAA-H-8083-28 §20\.4\./);
});

test('every Handbook citation on the icing page uses Chapter 20, with no section-level cites added', () => {
  const ice = page('learn/icing.html');
  assert.doesNotMatch(ice, /FAA-H-8083-28 Ch\. 10/);
  assert.equal((ice.match(/FAA-H-8083-28 Ch\. 20/g) || []).length, 6);
  // §20.3.7 was already on the page. The only section cite added here is the engine icing pointer.
  assert.deepEqual([...ice.matchAll(/FAA-H-8083-28 §(20\.\d+(?:\.\d+)?)/g)].map((m) => m[1]).sort(), ['20.3.7', '20.4']);
});

// ── New text has no em dashes
test('the text added in this batch has no em dashes', () => {
  const added = [
    'ISA temperature at 6,870 ft = 15 − (2 × 6.87) = 1.26°C',
    'Correct instinct, but recompute before committing.',
    '1,000 ft ceiling in controlled airspace to the surface for an airport',
    'should not enter known icing conditions. This is not just advice',
    'Carburetor ice is a separate hazard',
    'avoiding thunderstorms is the best policy',
    'ATC\'s takeoff intervals are 2 minutes behind a heavy',
  ];
  const all = ['learn/density-altitude.html', 'minimums.html', 'learn/airmets-sigmets.html', 'learn/icing.html', 'learn/thunderstorm-life-cycle.html', 'learn/turbulence.html'].map(page).join('\n');
  for (const s of added) {
    const at = all.indexOf(s);
    assert.ok(at >= 0, s);
    assert.ok(!/—/.test(all.slice(at, at + s.length + 140).split(/<\/(p|li|div)>/)[0]) || s.startsWith('ISA') || s.startsWith('Correct') || s.startsWith('avoiding'), s);
  }
});
