// Builds assets/data/airports-us.json from FAA NASR and NOAA WMM2025. The site makes no
// runtime calls for this data. Refresh it about once a year.
//
//   node scripts/build-airports.js <folder with APT_BASE.csv and APT_RWY_END.csv> [YYYY-MM-DD]
//
// NASR download: https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
const fs = require('node:fs');
const path = require('node:path');
const { load, declination, decimalYear } = require('./wmm');

const [nasrDir, dateArg] = process.argv.slice(2);
if (!nasrDir) {
  console.error('Usage: node scripts/build-airports.js <NASR csv folder> [YYYY-MM-DD]');
  process.exit(1);
}
const wmmDate = dateArg || new Date().toISOString().slice(0, 10);

function readCsv(file) {
  const text = fs.readFileSync(file, 'utf8');
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  const header = rows.shift();
  return rows.filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i]])));
}

const model = load(path.join(__dirname, 'data', 'WMM.COF'));
const year = decimalYear(wmmDate);
const base = readCsv(path.join(nasrDir, 'APT_BASE.csv'));
const ends = readCsv(path.join(nasrDir, 'APT_RWY_END.csv'));
if (!base.length || !ends.length) throw new Error('NASR files are empty or unreadable.');

const endsByAirport = new Map();
for (const e of ends) {
  if (!/^\d{1,2}[LRCSGUW]?$/.test(e.RWY_END_ID)) continue;   // skip helipads, water lanes like NE
  if (!endsByAirport.has(e.SITE_NO)) endsByAirport.set(e.SITE_NO, new Map());
  const runways = endsByAirport.get(e.SITE_NO);
  if (!runways.has(e.RWY_ID)) runways.set(e.RWY_ID, []);
  const t = e.TRUE_ALIGNMENT === '' ? null : Number(e.TRUE_ALIGNMENT);
  if (t !== null && !(t >= 0 && t <= 360)) throw new Error(`Bad alignment ${e.TRUE_ALIGNMENT} at ${e.ARPT_ID} ${e.RWY_END_ID}`);
  runways.get(e.RWY_ID).push({ id: e.RWY_END_ID.padStart(2, '0'), t });
}

const airports = {};
for (const b of base) {
  if (!b.ICAO_ID || b.ARPT_STATUS !== 'O') continue;
  if (b.COUNTRY_CODE !== 'US') continue;   // NASR also lists some foreign airports, often with no alignment
  const lat = Number(b.LAT_DECIMAL), lon = Number(b.LONG_DECIMAL);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Bad position at ${b.ICAO_ID}`);
  const runways = [...(endsByAirport.get(b.SITE_NO) || new Map()).values()]
    .filter((pair) => pair.length === 2)
    .map((pair) => pair.sort((x, y) => parseInt(x.id, 10) - parseInt(y.id, 10)).map((e) => [e.id, e.t]));
  if (!runways.length) continue;
  const entry = {
    n: b.ARPT_NAME,
    v: Math.round(declination(model, lat, lon, 0, year) * 10) / 10,
    r: runways,
  };
  // The published FAA value, kept only so the page can explain why a chart may differ.
  if (b.MAG_VARN !== '') entry.f = `${b.MAG_VARN}${b.MAG_HEMIS}${b.MAG_VARN_YEAR ? ' ' + b.MAG_VARN_YEAR : ''}`;
  airports[b.ICAO_ID] = entry;
}

const ids = Object.keys(airports).sort();
const meta = { model: 'WMM2025', variationDate: wmmDate, nasrEffective: base[0].EFF_DATE, airports: ids.length };
const lines = ids.map((id) => `${JSON.stringify(id)}:${JSON.stringify(airports[id])}`);
const out = `{"meta":${JSON.stringify(meta)},\n"airports":{\n${lines.join(',\n')}\n}}\n`;
const target = path.join(__dirname, '..', 'assets', 'data', 'airports-us.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, out);
console.log(`${ids.length} airports, ${(out.length / 1024).toFixed(0)} KB, NASR ${meta.nasrEffective}, variation for ${wmmDate}`);
