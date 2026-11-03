/* ============================================================
   CrosswindWx: wind-math.js
   Wind component and magnetic variation math. No page access,
   so tests and other tools can use the same calculation.

   Variation is signed: East is positive, West is negative.
   Magnetic = True - East, or True + West ("east is least, west is best").
   ============================================================ */

// Headings run 001 to 360. North is 360, not 000.
function normalizeHeading(deg) {
  const d = ((deg % 360) + 360) % 360;
  return d === 0 ? 360 : d;
}

function toMagnetic(trueDeg, variationEast) {
  return normalizeHeading(trueDeg - variationEast);
}

// METAR and TAF wind is true. ATIS, ASOS, and AWOS voice wind is already magnetic,
// so converting it would apply variation twice. An unknown source must never guess.
function windToMagnetic(dir, source, variationEast) {
  if (source === 'true') return toMagnetic(dir, variationEast);
  if (source === 'magnetic') return normalizeHeading(dir);
  throw new Error('Wind source must be "true" or "magnetic".');
}

function paintedNumber(runwayEndId) {
  return parseInt(runwayEndId, 10);
}

// end is { id: '16L', t: 180 }, where t is the FAA true alignment or null if FAA lists none.
function runwayMagnetic(end, variationEast) {
  if (end.t === null || end.t === undefined) {
    return { heading: paintedNumber(end.id) * 10, approximate: true };
  }
  return { heading: toMagnetic(end.t, variationEast), approximate: false };
}

function formatHeading(deg, decimals) {
  const text = deg.toFixed(decimals);
  const whole = text.split('.')[0].padStart(3, '0');
  return decimals ? `${whole}.${text.split('.')[1]}` : whole;
}

function formatVariation(variationEast) {
  return `${Math.abs(variationEast).toFixed(1)}°${variationEast < 0 ? 'W' : 'E'}`;
}

// "200°T − 14.8°E = 185.2°M" or "100°T + 7.2°W = 107.2°M"
function conversionStep(trueDeg, variationEast) {
  const sign = variationEast < 0 ? '+' : '−';
  const magnetic = formatHeading(toMagnetic(trueDeg, variationEast), 1);
  return `${formatHeading(normalizeHeading(trueDeg), 0)}°T ${sign} ${formatVariation(variationEast)} = ${magnetic}°M`;
}

// Component math. rwyHdg is the runway's magnetic heading. Without one, the painted
// number stands in for it, which is what manual mode does.
function calc(windDir, speed, gusts, rwyNum, rwyHdgOverride) {
  const hasOverride = rwyHdgOverride !== undefined && rwyHdgOverride !== null;
  const rwyHdg = hasOverride ? rwyHdgOverride : (rwyNum === 36 ? 360 : rwyNum * 10);
  let ad = rwyHdg - windDir;
  while (ad >  180) ad -= 360;
  while (ad < -180) ad += 360;
  const rad = ad * Math.PI / 180;
  const hw  = speed * Math.cos(rad);   // + = headwind, − = tailwind
  // cw sign here is sin(rwyHdg − windDir): negative when the wind is FROM the
  // right of the runway heading, positive when from the left. The side label
  // below maps it to the physical from-direction.
  const cw  = speed * Math.sin(rad);

  let gHw = null, gCw = null;
  if (gusts > 0) {
    gHw = gusts * Math.cos(rad);
    gCw = gusts * Math.sin(rad);
  }
  return {
    rwyNum, rwyHdg, ad, rad, hw, cw,
    hwAbs: Math.abs(hw), cwAbs: Math.abs(cw),
    side: cw < -0.05 ? 'RIGHT' : cw > 0.05 ? 'LEFT' : 'DIRECT',
    tail: hw < -0.05,
    gHw, gCw,
    gHwAbs: gHw !== null ? Math.abs(gHw) : null,
    gCwAbs: gCw !== null ? Math.abs(gCw) : null,
    gTail: gHw !== null ? gHw < -0.05 : false,
  };
}

// "2026-11-03" or "2026/10/29" to "November 3, 2026". Read as plain text so a time zone can't shift the day.
function formatDataDate(text) {
  const m = String(text).match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/);
  if (!m) return String(text);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

// "16E 2020" to "16°E (2020)", and "2E" to "2°E"
function formatFaaVariation(text) {
  const m = String(text).match(/^(\d+)([EW])(?: (\d{4}))?$/);
  if (!m) return String(text);
  return `${m[1]}°${m[2]}${m[3] ? ` (${m[3]})` : ''}`;
}

// Airport IDs: KSEA and PANC as typed, and SEA as a convenience for KSEA.
function findAirport(data, typed) {
  const id = String(typed || '').trim().toUpperCase();
  if (!id) return null;
  const key = data.airports[id] ? id : (id.length === 3 && data.airports['K' + id] ? 'K' + id : null);
  return key ? Object.assign({ id: key }, data.airports[key]) : null;
}
