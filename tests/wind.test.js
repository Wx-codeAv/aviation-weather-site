// Crosswind and magnetic variation tests. Run with: node --test
//
// "Today" values below are what manual mode gives when true wind meets a painted number.
// "Actual" values compare true wind with the runway's FAA true alignment, worked by hand:
//   KSEA 16L: true alignment 180, wind 200T at 20: 20 x sin(20) = 6.8
//   PANC 15:  true alignment 165, wind 165T at 25: straight down the runway = 0
//   KDAB 07L: true alignment 065, wind 100T at 15: 15 x sin(35) = 8.6
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { load, declination, decimalYear } = require('../scripts/wmm');

const ROOT = path.join(__dirname, '..');
const site = {};
vm.createContext(site);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/wind-math.js'), 'utf8'), site);
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/airports-us.json'), 'utf8'));

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label || ''} expected ${expected}, got ${actual}`);

const endOf = (airport, id) => {
  for (const pair of airport.r) for (const [endId, t] of pair) if (endId === id) return { id: endId, t };
  throw new Error(`${id} not found`);
};

// ── Conversion direction: the mistake that matters most
test('east variation is subtracted', () => {
  assert.equal(site.toMagnetic(200, 15), 185);
});
test('west variation is added', () => {
  assert.equal(site.toMagnetic(100, -7), 107);
});
test('conversion wraps below north', () => {
  assert.equal(site.toMagnetic(5, 15), 350);
});
test('conversion wraps above north', () => {
  assert.equal(site.toMagnetic(355, -10), 5);
});
test('north is 360, not 0', () => {
  assert.equal(site.toMagnetic(15, 15), 360);
  assert.equal(site.normalizeHeading(0), 360);
});

// ── The displayed math must add up
for (const [t, v, text] of [
  [200, 14.8, '200°T − 14.8°E = 185.2°M'],
  [100, -7.2, '100°T + 7.2°W = 107.2°M'],
  [65, -7.2, '065°T + 7.2°W = 072.2°M'],
  [5, 14.8, '005°T − 14.8°E = 350.2°M'],
  [360, 14.8, '360°T − 14.8°E = 345.2°M'],
  [0, 14.8, '360°T − 14.8°E = 345.2°M'],
]) {
  test(`display: ${text}`, () => assert.equal(site.conversionStep(t, v), text));
}

// ── Wind source
test('the page offers tower wind as magnetic and cites the current ATC order', () => {
  const page = fs.readFileSync(path.join(ROOT, 'pages/crosswind.html'), 'utf8');
  assert.match(page, /voice broadcast, or tower \(magnetic north\)/);
  assert.match(page, /JO 7110\.65BB para 1-2-1/);
});
test('true wind is converted', () => {
  assert.equal(site.windToMagnetic(200, 'true', 15), 185);
});
test('magnetic wind is not converted a second time', () => {
  assert.equal(site.windToMagnetic(185, 'magnetic', 15), 185);
});
test('an unknown wind source throws instead of guessing', () => {
  assert.throws(() => site.windToMagnetic(200, undefined, 15), /Wind source/);
  assert.throws(() => site.windToMagnetic(200, '', 15), /Wind source/);
});

// ── Real airports, against the published scoping table
const CASES = [
  ['KSEA', '16L', 200, 20, 14.8, 12.9, 6.8],
  ['PANC', '15', 165, 25, 13.9, 6.5, 0],
  ['PANC', '15', 180, 25, 13.9, 12.5, 6.5],
  ['KDAB', '07L', 100, 15, -7.2, 7.5, 8.6],
  ['PAJN', '08', 130, 20, 17.5, 15.3, 8.5],
];

for (const [id, rwy, dir, speed, variation, today, actual] of CASES) {
  test(`${id} ${rwy}, ${dir}T at ${speed}: ${today} kt unconverted, ${actual} kt converted`, () => {
    const airport = site.findAirport(data, id);
    near(airport.v, variation, 0.05, 'variation');
    const number = site.paintedNumber(rwy);
    near(site.calc(dir, speed, 0, number).cwAbs, today, 0.05, 'manual');

    const windM = site.windToMagnetic(dir, 'true', airport.v);
    const hdg = site.runwayMagnetic(endOf(airport, rwy), airport.v);
    assert.equal(hdg.approximate, false);
    near(site.calc(windM, speed, 0, number, hdg.heading).cwAbs, actual, 0.05, 'converted');
  });
}

test('the same wind gives the same crosswind whichever way it is reported', () => {
  const airport = site.findAirport(data, 'KSEA');
  const hdg = site.runwayMagnetic(endOf(airport, '16L'), airport.v).heading;
  const fromMetar = site.calc(site.windToMagnetic(200, 'true', airport.v), 20, 0, 16, hdg);
  const fromAtis = site.calc(site.windToMagnetic(200 - airport.v, 'magnetic', airport.v), 20, 0, 16, hdg);
  near(fromMetar.cwAbs, fromAtis.cwAbs, 1e-9);
});

test('crosswind side stays correct after conversion', () => {
  const airport = site.findAirport(data, 'KSEA');
  const hdg = site.runwayMagnetic(endOf(airport, '16L'), airport.v).heading;
  const r = site.calc(site.windToMagnetic(200, 'true', airport.v), 20, 0, 16, hdg);
  assert.equal(r.side, 'RIGHT');
  assert.equal(r.tail, false);
});

test('gusts convert with the same angle', () => {
  const airport = site.findAirport(data, 'KSEA');
  const hdg = site.runwayMagnetic(endOf(airport, '16L'), airport.v).heading;
  const r = site.calc(site.windToMagnetic(200, 'true', airport.v), 20, 30, 16, hdg);
  near(r.gCwAbs, 10.3, 0.05);
});

// ── Manual mode must not change
test('manual mode still uses the painted number', () => {
  const r = site.calc(270, 15, 0, 27);
  assert.equal(r.rwyHdg, 270);
  assert.equal(r.cwAbs, 0);
  assert.equal(site.calc(10, 10, 0, 36).rwyHdg, 360);
});

// ── Missing data
test('a runway with no FAA alignment is marked approximate', () => {
  const hdg = site.runwayMagnetic({ id: '08', t: null }, 15);
  assert.deepEqual({ ...hdg }, { heading: 80, approximate: true });
});

// ── Airport lookup
test('lookup accepts ICAO IDs, lowercase, and 3-letter IDs for K airports', () => {
  assert.equal(site.findAirport(data, 'KSEA').id, 'KSEA');
  assert.equal(site.findAirport(data, ' ksea ').id, 'KSEA');
  assert.equal(site.findAirport(data, 'SEA').id, 'KSEA');
  assert.equal(site.findAirport(data, 'PANC').id, 'PANC');
});
test('an unknown or foreign airport returns nothing rather than a guess', () => {
  assert.equal(site.findAirport(data, 'EGLL'), null);
  assert.equal(site.findAirport(data, 'ZZZZ'), null);
  assert.equal(site.findAirport(data, ''), null);
  assert.equal(site.findAirport(data, null), null);
});

test('dates and FAA variation read plainly', () => {
  assert.equal(site.formatDataDate('2026-11-03'), 'November 3, 2026');
  assert.equal(site.formatDataDate('2026/10/29'), 'October 29, 2026');
  assert.equal(site.formatFaaVariation('16E 2020'), '16°E (2020)');
  assert.equal(site.formatFaaVariation('5W 2000'), '5°W (2000)');
  assert.equal(site.formatFaaVariation('2E'), '2°E');
});

// ── Data file
test('the data file records its sources and dates', () => {
  assert.equal(data.meta.model, 'WMM2025');
  assert.match(data.meta.variationDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(data.meta.nasrEffective, /\d{4}/);
  assert.equal(data.meta.airports, Object.keys(data.airports).length);
  assert.ok(data.meta.airports > 2000);
  assert.equal(data.airports.CYAM, undefined, 'FAA data also lists some Canadian airports');
  assert.equal(data.airports.CBBC, undefined);
  assert.ok(data.airports.TJSJ, 'Puerto Rico stays');
});

test('every airport has a sensible variation and paired runway ends', () => {
  for (const [id, a] of Object.entries(data.airports)) {
    assert.match(id, /^[A-Z0-9]{4}$/);
    assert.ok(a.n, `${id} name`);
    assert.ok(typeof a.v === 'number' && Math.abs(a.v) < 40, `${id} variation ${a.v}`);
    assert.ok(a.r.length > 0, `${id} runways`);
    for (const pair of a.r) {
      assert.equal(pair.length, 2, `${id} runway pair`);
      for (const [end, t] of pair) {
        assert.match(end, /^\d{2}[LRCSGUW]?$/, `${id} ${end}`);
        assert.ok(t === null || (t >= 0 && t <= 360), `${id} ${end} alignment ${t}`);
      }
    }
  }
});

test('east and west signs match known geography', () => {
  assert.ok(site.findAirport(data, 'KSEA').v > 0, 'Seattle is east');
  assert.ok(site.findAirport(data, 'PANC').v > 0, 'Anchorage is east');
  assert.ok(site.findAirport(data, 'KBOS').v < 0, 'Boston is west');
  assert.ok(site.findAirport(data, 'KDAB').v < 0, 'Daytona Beach is west');
});

// ── WMM against NOAA's published test values
test('WMM2025 matches all of NOAA\'s test values', () => {
  const model = load(path.join(ROOT, 'scripts/data/WMM.COF'));
  const lines = fs.readFileSync(path.join(__dirname, 'fixtures/WMM2025_TestValues.txt'), 'utf8')
    .split(/\r?\n/).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.trim().split(/\s+/).map(Number));
  assert.equal(lines.length, 100);
  for (const [year, alt, lat, lon, dec] of lines) {
    near(declination(model, lat, lon, alt, year), dec, 0.01, `${year} ${alt} ${lat} ${lon}`);
  }
});

test('decimal year counts from the start of the year', () => {
  assert.equal(decimalYear('2026-01-01'), 2026);
  near(decimalYear('2026-07-02'), 2026.5, 0.002);
});

// ── Page wiring
test('the crosswind page loads the shared math and no longer defines its own', () => {
  const page = fs.readFileSync(path.join(ROOT, 'pages/crosswind.html'), 'utf8');
  assert.match(page, /js\/wind-math\.js/);
  assert.doesNotMatch(page, /function calc\(/);
});

test('the decoder passes the station with the wind', () => {
  const decoder = fs.readFileSync(path.join(ROOT, 'js/metar-decoder.js'), 'utf8');
  assert.match(decoder, /&station=/);
});
