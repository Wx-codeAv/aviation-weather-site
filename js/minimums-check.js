/* ============================================================
   CrosswindWx: minimums-check.js
   Compares a decoded METAR with the limits saved in the Personal
   Minimums builder. It states facts about the numbers. It supports
   the pilot's decision and doesn't make it, so nothing here says
   "go" or marks a clean result as approved.

   Relies on metar-decoder.js and wind-math.js being loaded first.
   ============================================================ */

const MINIMUMS_KEY = 'crosswindwx_minimums_v2';

// Reads the builder's saved profile. Never fills in a default: a limit nobody
// saved is null, and the check reports it as not checked.
function readMinimums(storage) {
  let raw;
  try {
    raw = storage.getItem(MINIMUMS_KEY);
  } catch (e) {
    return { status: 'unavailable' };
  }
  if (raw === null || raw === undefined) return { status: 'none' };
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch (e) {
    return { status: 'invalid' };
  }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return { status: 'invalid' };

  const number = key => {
    const value = saved[key];
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const gustSpreadOn = saved['gust-spread-on'] === true;
  return {
    status: 'ok',
    limits: {
      ceiling: number('ceiling'),
      visibility: number('visibility'),
      crosswind: number('crosswind'),
      wind: number('wind'),
      gusts: number('gusts'),
      gustSpreadOn,
      gustSpread: gustSpreadOn ? number('gust-spread') : null,
    },
  };
}

// Tenths match what the page shows, and keep 20 x sin(30) from reading as just over 10.
function roundTenth(value) {
  return Math.round(value * 10) / 10;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatKnots(value) {
  return `${formatNumber(roundTenth(value))} kt`;
}

function compareToLimit(name, value, limit) {
  const v = roundTenth(value);
  if (limit === null || limit === undefined) {
    return { status: 'notChecked', text: `${name} ${formatKnots(v)} wasn't checked because no limit is saved.`,
      incomplete: `no limit is saved for ${name.toLowerCase()}, so it wasn't checked` };
  }
  const plural = name === 'Gusts';
  if (v > limit) return { status: 'exceeds', text: `${name} ${formatKnots(v)} ${plural ? 'exceed' : 'exceeds'} your ${limit} kt limit.` };
  if (v === limit) return { status: 'at', text: `${name} ${formatKnots(v)} ${plural ? 'are' : 'is'} at your ${limit} kt limit.` };
  return { status: 'within', text: `${name} ${formatKnots(v)} ${plural ? 'are' : 'is'} within your ${limit} kt limit.` };
}

// A variable wind has no direction, so the whole wind could be crosswind on any runway. The
// number is the full speed or gust, compared with the saved crosswind limit. The wording says
// so, because "Total wind" read like the sustained wind line.
function compareVariableCrosswind(name, value, limit) {
  const result = compareToLimit(name, value, limit);
  if (limit === null || limit === undefined) return result;
  const v = roundTenth(value);
  const relation = v > limit ? 'above' : v === limit ? 'at' : 'within';
  return { ...result, text: `${name} could be the full ${formatKnots(v)} (variable wind), ${relation} your ${limit} kt limit.` };
}

// The largest crosswind share of the wind anywhere in a variable sector, which runs
// clockwise from fromM to toM. It peaks where the wind is square to the runway.
function worstCrosswindFactor(fromM, toM, reportedM, runwayHdg) {
  const sweep = ((toM - fromM) % 360 + 360) % 360;
  const inSector = deg => ((deg - fromM) % 360 + 360) % 360 <= sweep;
  const factor = deg => Math.abs(Math.sin((deg - runwayHdg) * Math.PI / 180));
  let worst = Math.max(factor(fromM), factor(toM), factor(reportedM));
  for (const square of [runwayHdg + 90, runwayHdg - 90]) {
    if (inSector(square)) worst = 1;
  }
  return worst;
}

function checkCeiling(parsed, limit, out) {
  const cavok = !!(parsed.visibility && parsed.visibility.cavok);
  const confirmed = cavok || (parsed.sky.length > 0
    && !parsed.sky.some(skyLayerUnknown) && !parsed.unreadable.length);
  const ceiling = getCeiling(parsed.sky);
  if (limit === null) {
    out.push({ status: 'notChecked', text: 'Ceiling wasn\'t checked because no minimum is saved.',
      incomplete: 'no ceiling minimum is saved, so ceiling wasn\'t checked' });
    return;
  }
  const min = `your ${limit.toLocaleString()} ft minimum`;
  if (ceiling !== null && ceiling < limit) {
    out.push({ status: 'exceeds', text: `Ceiling ${ceiling.toLocaleString()} ft is below ${min}.` });
  } else if (!confirmed) {
    out.push({ status: 'notChecked', text: 'Ceiling wasn\'t checked because sky condition is missing or unreadable in this report.',
      incomplete: 'sky condition is missing or unreadable, so ceiling wasn\'t checked' });
  } else if (ceiling === null) {
    out.push({ status: 'within', text: `No ceiling reported. ${min.charAt(0).toUpperCase()}${min.slice(1)} isn't affected.` });
  } else if (ceiling === limit) {
    out.push({ status: 'at', text: `Ceiling ${ceiling.toLocaleString()} ft is at ${min}.` });
  } else {
    out.push({ status: 'within', text: `Ceiling ${ceiling.toLocaleString()} ft is above ${min}.` });
  }
}

// Limits are compared with the exact distance, so 6000 m is 3.7 SM here. Flight category
// keeps the reportable table (metersToSM), where 6000 m is 4 SM.
const METERS_PER_STATUTE_MILE = 1609.344;

// One decimal, or more only if rounding would make the value look equal to the limit.
// Otherwise "4800 m (3.0 SM) is below your 3 SM minimum" would read as a mistake.
function formatExactSM(sm, limit) {
  for (let decimals = 1; decimals < 5; decimals++) {
    const text = sm.toFixed(decimals);
    if (Number(text) !== limit) return text;
  }
  return sm.toFixed(5);
}

function checkVisibility(parsed, limit, out) {
  const vis = parsed.visibility;
  const sm = visibilityInSM(vis);
  if (limit === null) {
    out.push({ status: 'notChecked', text: 'Visibility wasn\'t checked because no minimum is saved.',
      incomplete: 'no visibility minimum is saved, so visibility wasn\'t checked' });
    return;
  }
  if (sm === null) {
    out.push({ status: 'notChecked', text: 'Visibility wasn\'t checked because it\'s missing or unreadable in this report.',
      incomplete: 'visibility is missing or unreadable, so visibility wasn\'t checked' });
    return;
  }
  const min = `your ${limit} SM minimum`;
  // These say "at least", so a limit above them can't be confirmed either way.
  const metricFloor = vis.cavok || (vis.unit === 'm' && vis.value >= 9999);
  if (vis.plus || metricFloor) {
    const floor = vis.plus ? vis.value : 6;
    const said = vis.plus ? `${vis.raw}, better than ${vis.value} SM` : `${vis.raw}, 10 km or more (about 6 SM)`;
    if (limit <= floor) {
      out.push({ status: 'within', text: `Visibility ${said} meets ${min}.` });
    } else {
      out.push({ status: 'notChecked', text: `Visibility ${said} can't be confirmed against ${min}.`,
        incomplete: `visibility ${vis.raw} can't be confirmed against ${min}, so it wasn't checked` });
    }
    return;
  }
  const compared = vis.unit === 'm' ? vis.value / METERS_PER_STATUTE_MILE : sm;
  const said = vis.unit === 'm' ? `${vis.raw} m (${formatExactSM(compared, limit)} SM)` : vis.raw.replace(/SM$/, ' SM');
  if (compared < limit) out.push({ status: 'exceeds', text: `Visibility ${said} is below ${min}.` });
  else if (compared === limit) out.push({ status: 'at', text: `Visibility ${said} is at ${min}.` });
  else out.push({ status: 'within', text: `Visibility ${said} is above ${min}.` });
}

function checkWind(parsed, limits, runway, noRunwayReason, out) {
  const w = parsed.wind;
  // A wind token was present but we couldn't read it. Never compare, even if another wind
  // token was readable, because we can't tell which one the report meant.
  if (parsed.windUnreadable || parsed.windDoubt) {
    out.push({ status: 'notChecked', text: 'Wind couldn\'t be read, so wind and crosswind limits weren\'t checked.',
      incomplete: 'wind couldn\'t be read, so wind and crosswind weren\'t checked' });
    return;
  }
  if (!w) {
    out.push({ status: 'notChecked', text: 'Wind isn\'t reported, so wind limits weren\'t checked.',
      incomplete: 'wind isn\'t reported, so wind and crosswind weren\'t checked' });
    return;
  }
  if (w.unit !== 'KT') {
    out.push({ status: 'notChecked', text: `Wind is reported in ${w.unit} and your limits are in knots, so wind limits weren't checked.`,
      incomplete: `wind is reported in ${w.unit} and your limits are in knots, so wind and crosswind weren't checked` });
    return;
  }
  if (w.speed === 0) {
    out.push({ status: 'info', text: 'Calm wind. No wind limit is involved.' });
    return;
  }

  out.push(compareToLimit('Sustained wind', w.speed, limits.wind));
  if (w.gust) {
    out.push(compareToLimit('Gusts', w.gust, limits.gusts));
    if (limits.gustSpreadOn) out.push(compareToLimit('Gust spread', w.gust - w.speed, limits.gustSpread));
  }

  if (w.dir === 'VRB') {
    out.push({ status: 'info', explains: 'crosswind', text: 'Variable wind has no fixed direction, so crosswind for a runway can\'t be calculated. Any of it could be crosswind, so the full wind and gust are compared with your crosswind limit.' });
    out.push({ ...compareVariableCrosswind('Crosswind', w.speed, limits.crosswind), group: 'crosswind' });
    if (w.gust) out.push({ ...compareVariableCrosswind('Gust crosswind', w.gust, limits.crosswind), group: 'crosswind' });
    return;
  }

  if (!runway) {
    out.push({ status: 'notChecked', text: `${noRunwayReason || 'No runway selected.'} Crosswind wasn't checked. Total wind and gusts were.`,
      incomplete: `${(noRunwayReason || 'No runway selected.').replace(/\.$/, '').replace(/^./, c => c.toLowerCase())}, so crosswind wasn't checked` });
    return;
  }

  // METAR wind is true, so both ends of the comparison become magnetic.
  const windM = windToMagnetic(w.dir, 'true', runway.variation);
  const hdg = runwayMagnetic({ id: runway.id, t: runway.t }, runway.variation);
  if (hdg.approximate) {
    out.push({ status: 'info', text: `FAA lists no alignment for RWY ${runway.id}, so its painted number was used and crosswind is approximate.` });
  }

  const v = parsed.windVariable;
  if (v) {
    const factor = worstCrosswindFactor(
      windToMagnetic(v.from, 'true', runway.variation),
      windToMagnetic(v.to, 'true', runway.variation),
      windM, hdg.heading);
    out.push({ status: 'info', explains: 'crosswind', text: `Wind varies from ${formatHeading(v.from, 0)}° to ${formatHeading(v.to, 0)}° true. These crosswind numbers are the worst case across that range for RWY ${runway.id}.` });
    out.push({ ...compareToLimit('Worst-case crosswind', w.speed * factor, limits.crosswind), group: 'crosswind' });
    if (w.gust) out.push({ ...compareToLimit('Worst-case gust crosswind', w.gust * factor, limits.crosswind), group: 'crosswind' });
    return;
  }

  const steady = calc(windM, w.speed, 0, paintedNumber(runway.id), hdg.heading);
  out.push({ status: 'info', text: `RWY ${runway.id}: wind ${conversionStep(w.dir, runway.variation)}, runway ${formatHeading(hdg.heading, hdg.approximate ? 0 : 1)}°M, ${Math.abs(steady.ad).toFixed(1)}° apart.` });
  out.push(compareToLimit('Crosswind', steady.cwAbs, limits.crosswind));
  if (w.gust) {
    const gusting = calc(windM, w.gust, 0, paintedNumber(runway.id), hdg.heading);
    out.push(compareToLimit('Gust crosswind', gusting.cwAbs, limits.crosswind));
  }
}

// runway is null, or { id, t, variation }. Null means none was chosen, and it stays that way.
function checkMetarAgainstMinimums(parsed, limits, runway, noRunwayReason) {
  const lines = [];
  checkCeiling(parsed, limits.ceiling, lines);
  checkVisibility(parsed, limits.visibility, lines);
  checkWind(parsed, limits, runway, noRunwayReason, lines);
  return lines;
}

// ── Page ─────────────────────────────────────────────────────

const MINIMUMS_STATUS_LABEL = { exceeds: 'Outside limit', at: 'At limit', within: 'Within', notChecked: 'Not checked', info: 'Note' };

// Most urgent first. A note that explains other lines goes directly above the first of them.
function orderMinimumsLines(lines) {
  const order = { exceeds: 0, at: 1, notChecked: 2, within: 3, info: 4 };
  const sorted = lines.filter(l => !l.explains).sort((a, b) => order[a.status] - order[b.status]);
  for (const note of lines.filter(l => l.explains)) {
    const first = sorted.findIndex(l => l.group === note.explains);
    sorted.splice(first === -1 ? sorted.length : first, 0, note);
  }
  return sorted;
}

// The line at the top when any element couldn't be checked. It names what wasn't checked and
// never says "pass". Null when everything was checked.
function incompleteSummary(lines) {
  const reasons = lines.filter(l => l.status === 'notChecked' && l.incomplete).map(l => l.incomplete);
  return reasons.length ? `${reasons.join('; ')}.` : null;
}

function buildMinimumsLines(lines) {
  return orderMinimumsLines(lines)
    .map(l => `<li class="mins-line mins-line--${l.status}"><span class="mins-tag">${MINIMUMS_STATUS_LABEL[l.status]}</span><span>${escHtml(l.text)}</span></li>`)
    .join('');
}

const MINIMUMS_NOTE = 'This compares the report with the limits you saved. It supports your decision and doesn\'t make it. Not checked here: IFR add-ons, which depend on approach minimums, night VFR, storm distance, and proficiency.';

let minimumsAirportLoad = null;
function loadMinimumsAirports() {
  if (!minimumsAirportLoad) {
    minimumsAirportLoad = fetch('../assets/data/airports-us.json?v=2026-11-07c')
      .then(res => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
  }
  return minimumsAirportLoad;
}

function renderMinimumsCheck(parsed) {
  const el = document.getElementById('minimums-check');
  if (!el) return;
  let saved;
  try {
    saved = readMinimums(window.localStorage);
  } catch (e) {
    saved = { status: 'unavailable' };
  }

  if (saved.status !== 'ok') {
    const message = {
      none: 'No saved minimums yet. Set them in the <a href="minimums.html">Personal Minimums builder</a> to compare this report with your limits.',
      invalid: 'Your saved minimums couldn\'t be read, so nothing was compared. Open the <a href="minimums.html">Personal Minimums builder</a> and check them.',
      unavailable: 'This browser is blocking saved data, so your minimums couldn\'t be read and nothing was compared.',
    }[saved.status];
    el.innerHTML = `<p class="decoder-section-label">Your minimums</p><p class="mins-empty">${message}</p>`;
    el.hidden = false;
    return;
  }

  el.innerHTML = `
    <p class="decoder-section-label">Your minimums</p>
    <div id="mins-runway-row" class="mins-runway" hidden>
      <label for="mins-runway">Runway at ${escHtml(parsed.station)}</label>
      <select id="mins-runway" class="mins-select"><option value="">Choose a runway</option></select>
    </div>
    <p id="mins-incomplete" class="mins-incomplete" hidden></p>
    <ul id="mins-lines" class="mins-lines"></ul>
    <p class="mins-note">${escHtml(MINIMUMS_NOTE)}</p>`;
  el.hidden = false;

  const draw = (runway, reason) => {
    const lines = checkMetarAgainstMinimums(parsed, saved.limits, runway, reason);
    document.getElementById('mins-lines').innerHTML = buildMinimumsLines(lines);
    const incomplete = incompleteSummary(lines);
    const banner = document.getElementById('mins-incomplete');
    banner.innerHTML = incomplete ? `<strong>Incomplete:</strong> ${escHtml(incomplete)}` : '';
    banner.hidden = !incomplete;
  };
  draw(null, 'Loading runway data.');

  loadMinimumsAirports().then(data => {
    if (!document.getElementById('mins-lines')) return;
    const airport = findAirport(data, parsed.station);
    if (!airport) {
      draw(null, `No runway data for ${parsed.station}, because only US airports with an ICAO ID are included.`);
      return;
    }
    const ends = airport.r.flat();
    const select = document.getElementById('mins-runway');
    select.innerHTML = '<option value="">Choose a runway</option>'
      + ends.map((end, i) => `<option value="${i}">${escHtml(end[0])}</option>`).join('');
    document.getElementById('mins-runway-row').hidden = false;
    const update = () => {
      const end = select.value === '' ? null : ends[+select.value];
      draw(end ? { id: end[0], t: end[1], variation: airport.v } : null);
    };
    select.addEventListener('change', update);
    update();
  }).catch(() => {
    if (document.getElementById('mins-lines')) draw(null, 'Runway data couldn\'t load.');
  });
}
