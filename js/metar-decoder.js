/* ============================================================
   CrosswindWX — metar-decoder.js
   METAR parser, renderer, and wind/cloud SVG visualizer.
   Plain HTML/CSS/JS — no frameworks, no build step.
   ============================================================ */

// ── Lookup tables ────────────────────────────────────────────

const WX_DESCRIPTOR = {
  MI: 'shallow', PR: 'partial', BC: 'patches of',
  DR: 'low drifting', BL: 'blowing', SH: 'shower(s)',
  TS: 'thunderstorm', FZ: 'freezing'
};

const WX_TYPE = {
  DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains',
  IC: 'ice crystals', PL: 'ice pellets', GR: 'hail',
  GS: 'snow pellets / small hail', UP: 'unknown precipitation',
  BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash',
  DU: 'widespread dust', SA: 'sand', HZ: 'haze', PY: 'spray',
  PO: 'dust/sand whirls', SQ: 'squalls', FC: 'funnel cloud / tornado',
  SS: 'sandstorm', DS: 'duststorm',
  TSRA: 'thunderstorm with rain', TSSN: 'thunderstorm with snow',
  TSGR: 'thunderstorm with hail', TSGS: 'thunderstorm with small hail',
  FZRA: 'freezing rain', FZDZ: 'freezing drizzle', FZFG: 'freezing fog',
  BLSN: 'blowing snow', BLDU: 'blowing dust', DRSN: 'low drifting snow'
};

const COVER_LABEL = {
  FEW: 'Few — 1 to 2 oktas (⅛–¼ sky covered)',
  SCT: 'Scattered — 3 to 4 oktas (⅜–½ sky covered)',
  BKN: 'Broken — 5 to 7 oktas (⅝–⅞ sky covered) · ceiling',
  OVC: 'Overcast — 8 oktas (sky fully covered) · ceiling',
  VV: 'Vertical visibility · sky obscured · ceiling',
  SKC: 'Sky clear — no clouds',
  CLR: 'Clear — no clouds below 12,000 ft AGL',
  NSC: 'No significant cloud (WMO)',
  NCD: 'No cloud detected — automated sensor found no clouds'
};

// ── Main METAR parser ────────────────────────────────────────

// Greek / Cyrillic capitals that look identical to Latin A–Z. Some sources
// (and some fonts/keyboards) substitute these, which would otherwise make a
// perfectly good METAR fail to parse — e.g. a station "KΑΡΑ" with a Greek
// Alpha/Rho. Fold them back to Latin before tokenizing.
const HOMOGLYPHS = {
  'Α':'A','Β':'B','Ε':'E','Ζ':'Z','Η':'H','Ι':'I','Κ':'K','Μ':'M','Ν':'N',
  'Ο':'O','Ρ':'P','Τ':'T','Υ':'Y','Χ':'X',            // Greek
  'А':'A','В':'B','Е':'E','К':'K','М':'M','Н':'H','О':'O','Р':'P','С':'C',
  'Т':'T','У':'Y','Х':'X'                              // Cyrillic
};

function parseMetar(rawInput) {
  // Normalize whitespace, then fold look-alike Greek/Cyrillic letters to Latin
  let raw = rawInput.trim().toUpperCase().replace(/\s+/g, ' ')
    .replace(/[^\x00-\x7F]/g, ch => HOMOGLYPHS[ch] || ch);

  const tokens = raw.split(' ');

  // Merge two-token fractional SM visibility: ["1", "1/2SM"] → ["1 1/2SM"]
  for (let j = 0; j < tokens.length - 1; j++) {
    if (/^\d+$/.test(tokens[j]) && /^\d+\/\d+SM$/.test(tokens[j + 1])) {
      tokens.splice(j, 2, tokens[j] + ' ' + tokens[j + 1]);
      break;
    }
  }

  const result = {
    raw,
    type: null, station: null, time: null,
    auto: false, cor: false,
    wind: null, windVariable: null,
    visibility: null,
    weather: [], sky: [],
    temp: null, dewpoint: null,
    altimeter: null,
    remarks: null,
    flightCategory: null,
    unrecognized: [],
    fields: []
  };

  function push(token, type, label, explanation) {
    result.fields.push({ token, type, label, explanation });
  }

  // A group we can't place. Flag it so it stays visible, but DON'T let it halt
  // the parse — the caller advances past it and keeps decoding later groups.
  function pushUnrecognized(token) {
    result.unrecognized.push(token);
    push(token, 'unknown', 'Unrecognized group',
      'Not recognized — skipped so the rest of the report could still decode. ' +
      'May be a coded element this decoder does not support yet, or a garbled group.');
  }

  let i = 0;

  // 1 ── Report type (METAR / SPECI) — optional
  if (/^(METAR|SPECI)$/.test(tokens[i])) {
    result.type = tokens[i];
    push(tokens[i], 'type', 'Report type',
      tokens[i] === 'METAR'
        ? 'Routine hourly aviation weather observation'
        : 'Special observation — significant weather change since last report');
    i++;
  } else {
    result.type = 'METAR';
  }

  // 2 ── Station ICAO (4 letters)
  if (i < tokens.length && /^[A-Z]{4}$/.test(tokens[i])) {
    result.station = tokens[i];
    push(tokens[i], 'station', 'Station ID', `ICAO airport identifier: ${tokens[i]}`);
    i++;
  }

  // 3 ── Date/time: DDHHMMz
  if (i < tokens.length && /^\d{6}Z$/.test(tokens[i])) {
    const t = tokens[i];
    const day = t.slice(0, 2), hr = t.slice(2, 4), mn = t.slice(4, 6);
    result.time = { raw: t, day: +day, hour: +hr, min: +mn };
    push(t, 'time', 'Observation time', `Day ${+day}, ${hr}:${mn} UTC (Zulu)`);
    i++;
  }

  // 4 ── Modifier: AUTO / COR
  while (i < tokens.length && /^(AUTO|COR)$/.test(tokens[i])) {
    if (tokens[i] === 'AUTO') {
      result.auto = true;
      push('AUTO', 'modifier', 'Automated station',
        'Report from automated sensors — no human observer');
    } else {
      result.cor = true;
      push('COR', 'modifier', 'Corrected report',
        'Correction to a previously issued observation');
    }
    i++;
  }

  // 5 ── Wind: dddssKT, dddssGggKT, VRBssKT, 00000KT
  if (i < tokens.length) {
    const wm = tokens[i].match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
    if (wm) {
      const dir = wm[1] === 'VRB' ? 'VRB' : +wm[1];
      const speed = +wm[2];
      const gust = wm[3] ? +wm[3] : null;
      const unit = wm[4];

      result.wind = { raw: tokens[i], dir, speed, gust, unit };

      let desc;
      if (dir === 0 && speed === 0) {
        desc = 'Calm — winds less than 3 knots';
      } else if (dir === 'VRB') {
        desc = `Variable direction at ${speed} ${unit}`;
        if (gust) desc += `, gusting ${gust} ${unit}`;
      } else {
        desc = `From ${String(dir).padStart(3, '0')}° at ${speed} ${unit}`;
        if (gust) desc += `, gusting ${gust} ${unit}`;
      }

      push(tokens[i], 'wind', 'Wind', desc);
      i++;

      // Variable sector: dddVddd
      if (i < tokens.length && /^\d{3}V\d{3}$/.test(tokens[i])) {
        const [from, to] = tokens[i].split('V').map(Number);
        result.windVariable = { from, to };
        push(tokens[i], 'wind-var', 'Wind variable between',
          `Direction varying ${from}° to ${to}°`);
        i++;
      }
    } else if (/^[\d/]{5,6}(KT|MPS|KMH)$/.test(tokens[i]) && tokens[i].includes('/')) {
      // Wind sensor unavailable: direction and/or speed reported as slashes (/////KT)
      push(tokens[i], 'wind', 'Wind',
        'Not available — wind not reported by the automated sensor');
      i++;
    }
  }

  // 6 ── Visibility (US SM or metric metres or CAVOK)
  if (i < tokens.length) {
    const tok = tokens[i];
    if (tok === 'CAVOK') {
      result.visibility = { raw: tok, value: 10, unit: 'km', cavok: true };
      push(tok, 'visibility', 'CAVOK',
        'Ceiling and Visibility OK: vis ≥ 10 km, no cloud below 5,000 ft, no CB/TCU, no sig wx');
      i++;
    } else if (/^(M?\d[\d/ ]*SM|M?1\/\dSM)$/.test(tok) || /^M?\d+SM$/.test(tok) || /^\d+\/\d+SM$/.test(tok) || /^M\d+\/\d+SM$/.test(tok)) {
      const lessThan = tok.startsWith('M');
      const numPart = tok.replace(/^M/, '').replace('SM', '').trim();
      const vis = parseFraction(numPart);
      result.visibility = { raw: tok, value: vis, unit: 'SM', lessThan };
      push(tok, 'visibility', 'Visibility',
        lessThan ? `Less than ${numPart} statute mile(s)` : `${numPart} statute mile${vis !== 1 ? 's' : ''}`);
      i++;
    } else if (/^\d{4}$/.test(tok)) {
      const vis = +tok;
      result.visibility = { raw: tok, value: vis, unit: 'm' };
      push(tok, 'visibility', 'Visibility',
        vis >= 9999 ? '10 km or more — visibility unrestricted' : `${vis} metres`);
      i++;
    } else if (/^\/{2,4}SM$/.test(tok) || tok === '////') {
      // Visibility sensor unavailable: ////SM (US) or //// (metric)
      push(tok, 'visibility', 'Visibility',
        'Not available — visibility not reported by the automated sensor');
      i++;
    }
  }

  // 7 ── RVR — consume but summarize only
  while (i < tokens.length && /^R\d{2}[LRC]?\//.test(tokens[i])) {
    push(tokens[i], 'rvr', 'Runway visual range', 'Runway-specific visibility — relevant for precision approaches');
    i++;
  }

  // 8 ── Present weather: [+-|VC]?[descriptor]?[type(s)]
  while (i < tokens.length) {
    const decoded = decodeWeather(tokens[i]);
    if (decoded === null) break;
    result.weather.push({ raw: tokens[i], decoded });
    push(tokens[i], 'weather', 'Present weather', decoded);
    i++;
  }

  // 9 ── Sky condition
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^(SKC|CLR|NSC|NCD)$/.test(tok)) {
      result.sky.push({ raw: tok, cover: tok, height: null, cb: null });
      push(tok, 'sky', 'Sky condition', COVER_LABEL[tok] || tok);
      i++;
      continue;
    }

    // Automated slash group: cover and/or height not measured by the sensor.
    // Forms: //////TCU, //////CB, ////// (bare), ///### (amount n/a),
    // BKN/// (height n/a). At least one component must be slashes. A station
    // can name a significant cloud (CB/TCU) without an amount or height.
    const slash = tok.match(/^(\/{3}|FEW|SCT|BKN|OVC|VV)(\/{3}|\d{3})(CB|TCU|\/{2,3})?$/);
    if (slash && (slash[1] === '///' || slash[2] === '///' || (slash[3] && slash[3].includes('/')))) {
      const cover  = slash[1] === '///' ? null : slash[1];
      const height = slash[2] === '///' ? null : +slash[2] * 100;
      const cb     = slash[3] && !slash[3].includes('/') ? slash[3] : null;
      result.sky.push({ raw: tok, cover, height, cb });

      let desc;
      if (cb === 'TCU')     desc = 'Towering cumulus present';
      else if (cb === 'CB') desc = 'Cumulonimbus (thunderstorm cloud) present';
      else if (cover)       desc = COVER_LABEL[cover] || cover;
      else                  desc = null;

      const missing = [];
      if (!cover) missing.push('amount');
      if (height === null) missing.push('height');
      const naPhrase = missing.join(' and ') + ' not reported by the automated sensor';
      if (desc === null) desc = 'Cloud ' + naPhrase;        // bare //////
      else if (missing.length) desc += (cb ? '; ' : ' — ') + naPhrase;
      if (height !== null) desc += ` (height ${height.toLocaleString()} ft AGL)`;

      push(tok, 'sky', 'Sky condition', desc);
      i++;
      continue;
    }

    const sm = tok.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
    if (!sm) break;
    const cover = sm[1], height = +sm[2] * 100, cb = sm[3] || null;
    result.sky.push({ raw: tok, cover, height, cb });
    let desc = `${COVER_LABEL[cover] || cover} at ${height.toLocaleString()} ft AGL`;
    if (cb === 'CB') desc += ' · cumulonimbus — thunderstorm';
    else if (cb === 'TCU') desc += ' · towering cumulus — developing storm';
    push(tok, 'sky', 'Sky condition', desc);
    i++;
  }

  // 10–12 ── Temperature/dewpoint, altimeter, remarks — and graceful recovery.
  // From here on, a token we can't place must NOT abort the parse: we flag it
  // as unrecognized and keep walking, so a stray or garbled group can never
  // hide the temp, altimeter, or remarks that follow it. Temp/altimeter stay
  // guarded by their result fields so each is only filled once.
  while (i < tokens.length) {
    const tok = tokens[i];

    // Remarks header — consumes everything after it.
    if (tok === 'RMK') {
      const remarkTokens = tokens.slice(i + 1);
      result.remarks = remarkTokens.join(' ');
      push('RMK', 'remarks-header', 'Remarks', 'Supplemental information appended by the observing station');
      parseRemarks(remarkTokens, push);
      break;
    }

    // Temperature / Dewpoint: TT/DD
    if (result.temp === null && /^M?\d+\/M?\d+$/.test(tok)) {
      const parts = tok.split('/');
      result.temp = parseTemp(parts[0]);
      result.dewpoint = parseTemp(parts[1]);
      const spread = result.temp - result.dewpoint;
      let desc = `Temp ${result.temp}°C, dewpoint ${result.dewpoint}°C — T/D spread ${spread}°C`;
      if (spread <= 2) desc += ' · fog or low visibility likely as spread closes';
      else if (spread <= 5) desc += ' · watch for increasing moisture';
      push(tok, 'temp', 'Temperature / Dewpoint', desc);
      i++; continue;
    }
    // Temperature / dewpoint sensor unavailable: //// or M//// or //M// etc.
    if (result.temp === null && result.altimeter === null && /^\/{4,5}$/.test(tok)) {
      push(tok, 'temp', 'Temperature / Dewpoint',
        'Not available — temperature/dewpoint not reported by the automated sensor');
      i++; continue;
    }

    // Altimeter: Adddd (inHg) or Qdddd (hPa)
    if (result.altimeter === null && /^[AQ]\d{4}$/.test(tok)) {
      if (tok[0] === 'A') {
        const val = +tok.slice(1) / 100;
        result.altimeter = { raw: tok, value: val, unit: 'inHg' };
        const diff = (val - 29.92).toFixed(2);
        let desc = `${val.toFixed(2)} inHg`;
        if (val < 29.92) desc += ` (${diff} below standard 29.92 — low pressure area)`;
        else if (val > 29.92) desc += ` (+${diff} above standard 29.92 — high pressure area)`;
        else desc += ' — standard atmosphere pressure';
        push(tok, 'altimeter', 'Altimeter setting', desc);
      } else {
        const val = +tok.slice(1);
        result.altimeter = { raw: tok, value: val, unit: 'hPa' };
        push(tok, 'altimeter', 'Altimeter setting (QNH)', `${val} hPa`);
      }
      i++; continue;
    }
    // Altimeter sensor unavailable: A//// or Q////
    if (result.altimeter === null && /^[AQ]\/{4}$/.test(tok)) {
      push(tok, 'altimeter', 'Altimeter setting',
        'Not available — pressure not reported by the automated sensor');
      i++; continue;
    }

    // A group of only slashes in a slot we didn't anchor: sensor data missing.
    if (/^\/+$/.test(tok)) {
      push(tok, 'unknown', 'Data not available',
        'Reported as all slashes — the automated sensor had no value for this group');
      i++; continue;
    }

    // Anything else: flag it and move on so the rest of the report still decodes.
    pushUnrecognized(tok);
    i++;
  }

  result.flightCategory = deriveFlightCategory(result);
  return result;
}

// ── Helpers ──────────────────────────────────────────────────

function parseTemp(s) {
  return s.startsWith('M') ? -parseInt(s.slice(1)) : parseInt(s);
}

function parseFraction(s) {
  s = s.trim();
  if (!s.includes('/')) return parseFloat(s) || 0;
  const parts = s.split(' ');
  if (parts.length === 2) {
    const [n, d] = parts[1].split('/').map(Number);
    return parseFloat(parts[0]) + n / d;
  }
  const [n, d] = parts[0].split('/').map(Number);
  return n / d;
}

function decodeWeather(tok) {
  if (!tok || tok === 'RMK') return null;
  let s = tok;
  const parts = [];

  if (s.startsWith('-')) { parts.push('Light'); s = s.slice(1); }
  else if (s.startsWith('+')) { parts.push('Heavy'); s = s.slice(1); }
  else if (s.startsWith('VC')) { parts.push('In the vicinity:'); s = s.slice(2); }

  // Exact compound code (TSRA, FZRA…) gets its nicer pre-written phrasing
  if (WX_TYPE[s]) { parts.push(WX_TYPE[s]); return parts.join(' '); }

  // Optional descriptor (TS, SH, FZ, BL…), then one or more 2-letter types
  let desc = null;
  for (const [code, label] of Object.entries(WX_DESCRIPTOR)) {
    if (s.startsWith(code)) { desc = label; s = s.slice(code.length); break; }
  }

  const types = [];
  while (s.length >= 2 && WX_TYPE[s.slice(0, 2)]) { types.push(WX_TYPE[s.slice(0, 2)]); s = s.slice(2); }

  // Leftover characters mean this token isn't really weather — don't half-decode it
  if (s.length > 0) return null;

  if (desc) {
    parts.push(types.length
      ? desc + (desc === 'thunderstorm' ? ' with ' : ' ') + types.join(', ')
      : desc);
  } else if (types.length) {
    parts.push(types.join(', '));
  } else {
    return null;
  }

  return parts.join(' ');
}

// Directions / locations used throughout the remarks
const RMK_DIR = {
  N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south',
  SW: 'southwest', W: 'west', NW: 'northwest',
  ALQDS: 'all quadrants', OHD: 'overhead', DSNT: 'distant', VC: 'vicinity'
};
const isRmkDir = t => /^(N|NE|E|SE|S|SW|W|NW|ALQDS|OHD|DSNT|VC)$/.test(t);
const rmkDir = t => RMK_DIR[t] || t;
const hhmm = t => t.length === 4 ? `${t.slice(0,2)}:${t.slice(2)}` : `:${t}`;

// Decode a begin/end timing group. Handles a single event (RAB07), a begin
// and end (TSB1230E1300), and several phenomena packed in one token
// (RAB36GRB53 = rain began :36; hail began :53).
function decodeBeginEnd(tok) {
  const re = /([+\-]?[A-Z]{2,6}?)((?:[BE]\d{2,4})+)/g;
  const out = [];
  let m, end = 0;
  while ((m = re.exec(tok))) {
    if (m.index !== end) return null;   // a gap means this isn't a clean B/E token
    end = re.lastIndex;
    const wxName = m[1] === 'TS' ? 'thunderstorm' : (decodeWeather(m[1]) || m[1]);
    const events = [...m[2].matchAll(/([BE])(\d{2,4})/g)]
      .map(e => `${e[1] === 'B' ? 'began' : 'ended'} ${hhmm(e[2])}`);
    out.push(`${wxName} ${events.join(', ')}`);
  }
  if (!out.length || end !== tok.length) return null;
  return out.join('; ') + ' UTC';
}

// Full remarks decoder — walks the RMK tokens (ASOS / FMH-1 decode key)
function parseRemarks(tokens, push) {
  const SENSOR = {
    RVRNO: 'Runway visual range not available',
    PWINO: 'Precipitation-type sensor not available',
    PNO: 'Precipitation-accumulation sensor not available',
    FZRANO: 'Freezing-rain sensor not available',
    TSNO: 'Thunderstorm sensor not available',
    VISNO: 'Secondary visibility sensor not available',
    CHINO: 'Secondary ceiling sensor not available'
  };
  const CLOUD = {
    ACC: 'altocumulus castellanus', ACSL: 'altocumulus standing lenticular',
    CCSL: 'cirrocumulus standing lenticular', SCSL: 'stratocumulus standing lenticular',
    CBMAM: 'cumulonimbus mammatus', CB: 'cumulonimbus', TCU: 'towering cumulus'
  };
  // Cloud genera used in Canadian (NAV CANADA) layer-amount remarks
  const CTYPE = {
    CI: 'cirrus', CC: 'cirrocumulus', CS: 'cirrostratus', AC: 'altocumulus',
    AS: 'altostratus', NS: 'nimbostratus', SC: 'stratocumulus', ST: 'stratus',
    CU: 'cumulus', CB: 'cumulonimbus', TCU: 'towering cumulus'
  };
  const LTG_TYPE = { IC: 'in-cloud', CC: 'cloud-to-cloud', CG: 'cloud-to-ground', CA: 'cloud-to-air' };
  const FREQ = { OCNL: 'occasional', FRQ: 'frequent', CONS: 'continuous' };
  const TENDENCY = [
    'higher — rising then falling', 'higher — rising then steady', 'higher — rising',
    'higher — falling/steady then rising', 'steady', 'lower — falling then rising',
    'lower — falling then steady', 'lower — falling', 'lower — steady/rising then falling'
  ];

  const n = tokens.length;
  let i = 0;
  const peek = (k = 0) => tokens[i + k] || '';

  while (i < n) {
    const t = tokens[i];
    let m;

    if (t === 'AO1') { push('AO1', 'remarks', 'Automated station', 'No precipitation-type discriminator'); i++; continue; }
    if (t === 'AO2') { push('AO2', 'remarks', 'Automated station', 'Has a precipitation-type discriminator'); i++; continue; }

    // Peak wind: PK WND dddff(f)/(hh)mm
    if (t === 'PK' && peek(1) === 'WND' && (m = peek(2).match(/^(\d{3})(\d{2,3})\/(\d{2,4})$/))) {
      push(`PK WND ${peek(2)}`, 'remarks', 'Peak wind', `${+m[2]} kt from ${+m[1]}° at ${hhmm(m[3])} UTC`);
      i += 3; continue;
    }
    // Wind shift: WSHFT (hh)mm [FROPA]
    if (t === 'WSHFT' && /^\d{2,4}$/.test(peek(1))) {
      const fropa = peek(2) === 'FROPA';
      push(`WSHFT ${peek(1)}${fropa ? ' FROPA' : ''}`, 'remarks', 'Wind shift',
        `Wind shift at ${hhmm(peek(1))} UTC${fropa ? ' — frontal passage' : ''}`);
      i += fropa ? 3 : 2; continue;
    }
    // Tower / surface visibility
    if ((t === 'TWR' || t === 'SFC') && peek(1) === 'VIS') {
      push(`${t} VIS ${peek(2)}`, 'remarks', t === 'TWR' ? 'Tower visibility' : 'Surface visibility',
        `${peek(2)} SM reported ${t === 'TWR' ? 'from the control tower' : 'by the ASOS sensor'}`);
      i += 3; continue;
    }
    // Variable prevailing visibility: VIS x(/x)V x(/x) — value may span two tokens (3/4V1 1/2)
    if (t === 'VIS' && /V/.test(peek(1))) {
      let spec = peek(1), consumed = 2;
      if (/^\d\/\d$/.test(peek(2)) && /V\d+$/.test(spec)) { spec += ' ' + peek(2); consumed = 3; }
      const [a, b] = spec.split('V');
      push(`VIS ${spec}`, 'remarks', 'Variable visibility', `Prevailing visibility varying ${a} to ${b} SM`);
      i += consumed; continue;
    }
    // Visibility at a second location: VIS vvvvv LOC
    if (t === 'VIS' && /^[\dM][\d/]*$/.test(peek(1)) && /^(RWY\d+[LRC]?|[A-Z]{2,})$/.test(peek(2))) {
      push(`VIS ${peek(1)} ${peek(2)}`, 'remarks', 'Visibility (2nd site)', `${peek(1)} SM at ${peek(2)}`);
      i += 3; continue;
    }
    // Lightning: [OCNL|FRQ|CONS] LTG[types] [locations]
    let freq = '';
    if (FREQ[t] && /^LTG/.test(peek(1))) { freq = t; i++; }
    if ((m = (tokens[i] || '').match(/^LTG([A-Z]*)$/))) {
      let raw = (freq ? freq + ' ' : '') + tokens[i];
      const types = [];
      for (let k = 0; k < m[1].length; k += 2) { const c = m[1].slice(k, k + 2); if (LTG_TYPE[c]) types.push(LTG_TYPE[c]); }
      i++;
      const locs = [];
      while (i < n && isRmkDir(tokens[i])) { locs.push(rmkDir(tokens[i])); raw += ' ' + tokens[i]; i++; }
      let exp = (freq ? FREQ[freq] + ' ' : '') + 'lightning';
      if (types.length) exp += ' (' + types.join(', ') + ')';
      if (locs.length) exp += ' — ' + locs.join(', ');
      push(raw, 'remarks', 'Lightning', exp);
      continue;
    }
    if (freq) { push(t, 'remarks', 'Remark', FREQ[freq]); i++; continue; }

    // Thunderstorm location + movement: TS [loc...] [MOV dir]
    if (t === 'TS') {
      let raw = 'TS'; const locs = []; i++;
      while (i < n && isRmkDir(tokens[i])) { locs.push(rmkDir(tokens[i])); raw += ' ' + tokens[i]; i++; }
      let mov = '';
      if (tokens[i] === 'MOV' && tokens[i + 1]) { mov = rmkDir(tokens[i + 1]); raw += ' MOV ' + tokens[i + 1]; i += 2; }
      let exp = 'Thunderstorm';
      if (locs.length) exp += ' ' + locs.join(', ');
      if (mov) exp += ', moving ' + mov;
      push(raw, 'remarks', 'Thunderstorm', exp);
      continue;
    }
    // Tornadic activity
    if (t === 'TORNADO' || t === 'WATERSPOUT' || (t === 'FUNNEL' && peek(1) === 'CLOUD')) {
      const label = t === 'TORNADO' ? 'Tornado' : t === 'WATERSPOUT' ? 'Waterspout' : 'Funnel cloud';
      let raw = t; if (t === 'FUNNEL') { raw = 'FUNNEL CLOUD'; i++; }
      i++;
      push(raw, 'remarks', 'Tornadic activity', `${label} reported — see raw remarks for time, location, and movement`);
      continue;
    }
    // Begin/end of precipitation or thunderstorms: RAB07, TSB1230E1300, ...
    if (/[BE]\d{2}/.test(t) && (m = decodeBeginEnd(t))) {
      push(t, 'remarks', 'Precip / TS timing', m); i++; continue;
    }
    // Variable ceiling: CIG hhhVhhh
    if (t === 'CIG' && (m = peek(1).match(/^(\d{3})V(\d{3})$/))) {
      push(`CIG ${peek(1)}`, 'remarks', 'Variable ceiling',
        `Ceiling varying ${(+m[1] * 100).toLocaleString()} to ${(+m[2] * 100).toLocaleString()} ft`);
      i += 2; continue;
    }
    // Ceiling at a second location: CIG hhh LOC
    if (t === 'CIG' && /^\d{3}$/.test(peek(1)) && /^(RWY\d+[LRC]?|[A-Z]{2,})$/.test(peek(2))) {
      push(`CIG ${peek(1)} ${peek(2)}`, 'remarks', 'Ceiling (2nd site)', `${(+peek(1) * 100).toLocaleString()} ft at ${peek(2)}`);
      i += 3; continue;
    }
    if (t === 'PRESRR') { push('PRESRR', 'remarks', 'Pressure', 'Rising rapidly'); i++; continue; }
    if (t === 'PRESFR') { push('PRESFR', 'remarks', 'Pressure', 'Falling rapidly'); i++; continue; }
    if (t === 'VIRGA') { push('VIRGA', 'remarks', 'Virga', 'Precipitation aloft not reaching the ground'); i++; continue; }
    if (t === 'FROPA') { push('FROPA', 'remarks', 'Frontal passage', 'A front passed the station'); i++; continue; }

    // Sea-level pressure
    if ((m = t.match(/^SLP(\d{3})$/))) {
      const v = +m[1], hpa = ((v >= 500 ? 900 : 1000) + v / 10).toFixed(1);
      push(t, 'remarks', 'Sea-level pressure', `${hpa} hPa`); i++; continue;
    }
    if (t === 'SLPNO') { push('SLPNO', 'remarks', 'Sea-level pressure', 'Not available'); i++; continue; }

    // Hourly / 3-6 hour / 24 hour precipitation
    if ((m = t.match(/^P(\d{4})$/))) {
      push(t, 'remarks', 'Hourly precipitation', +m[1] === 0 ? 'Trace since last report' : `${(+m[1] / 100).toFixed(2)} in since last report`); i++; continue;
    }
    if ((m = t.match(/^6(\d{4}|\/{4})$/))) {
      push(t, 'remarks', '3/6-hr precipitation', m[1] === '////' ? 'Not available' : (+m[1] === 0 ? 'Trace' : `${(+m[1] / 100).toFixed(2)} in`)); i++; continue;
    }
    if ((m = t.match(/^7(\d{4}|\/{4})$/))) {
      push(t, 'remarks', '24-hr precipitation', m[1] === '////' ? 'Not available' : `${(+m[1] / 100).toFixed(2)} in`); i++; continue;
    }
    // Hourly precise temperature / dewpoint
    if ((m = t.match(/^T([01])(\d{3})([01])(\d{3})$/))) {
      const tC = (m[1] === '1' ? -1 : 1) * +m[2] / 10, dC = (m[3] === '1' ? -1 : 1) * +m[4] / 10;
      push(t, 'remarks', 'Exact temp / dewpoint', `${tC.toFixed(1)}°C / ${dC.toFixed(1)}°C — to the nearest 0.1°C (the body group is rounded to whole degrees)`); i++; continue;
    }
    if ((m = t.match(/^1([01])(\d{3})$/))) {
      push(t, 'remarks', '6-hr max temp', `${((m[1] === '1' ? -1 : 1) * +m[2] / 10).toFixed(1)}°C`); i++; continue;
    }
    if ((m = t.match(/^2([01])(\d{3})$/))) {
      push(t, 'remarks', '6-hr min temp', `${((m[1] === '1' ? -1 : 1) * +m[2] / 10).toFixed(1)}°C`); i++; continue;
    }
    if ((m = t.match(/^4([01])(\d{3})([01])(\d{3})$/))) {
      const mx = (m[1] === '1' ? -1 : 1) * +m[2] / 10, mn = (m[3] === '1' ? -1 : 1) * +m[4] / 10;
      push(t, 'remarks', '24-hr max/min temp', `max ${mx.toFixed(1)}°C, min ${mn.toFixed(1)}°C`); i++; continue;
    }
    // 3-hour pressure tendency: 5appp
    if ((m = t.match(/^5([0-8])(\d{3})$/))) {
      push(t, 'remarks', '3-hr pressure tendency', `${(+m[2] / 10).toFixed(1)} hPa — ${TENDENCY[+m[1]]}`); i++; continue;
    }
    // Sensor status (some carry a location)
    if (SENSOR[t]) {
      let raw = t, exp = SENSOR[t];
      if ((t === 'VISNO' || t === 'CHINO') && /^(RWY\d+[LRC]?|[A-Z]{2,})$/.test(peek(1))) { raw += ' ' + peek(1); exp += ` (${peek(1)})`; i++; }
      push(raw, 'remarks', 'Sensor status', exp); i++; continue;
    }
    if (t === '$') { push('$', 'remarks', 'Maintenance', 'Maintenance check needed on the system'); i++; continue; }
    // Hailstone size: GR <size> (inches), size may span two tokens (1 3/4)
    if (t === 'GR' && /^\d+(\/\d+)?$/.test(peek(1))) {
      let size = peek(1), consumed = 2;
      if (/^\d\/\d$/.test(peek(2)) && /^\d+$/.test(peek(1))) { size += ' ' + peek(2); consumed = 3; }
      push(`GR ${size}`, 'remarks', 'Hailstone size', `Largest hailstones about ${size} inch in diameter`);
      i += consumed; continue;
    }
    if (CLOUD[t]) { push(t, 'remarks', 'Cloud type', CLOUD[t]); i++; continue; }

    // Density altitude (Canadian remark): DENSITY ALT 400FT
    if (t === 'DENSITY' && peek(1) === 'ALT') {
      let val = peek(2), consumed = 3, dm = val.match(/^(M?)(\d+)FT$/);
      if (!dm && /^\d+$/.test(peek(2)) && peek(3) === 'FT') { val = peek(2) + 'FT'; dm = val.match(/^(M?)(\d+)FT$/); consumed = 4; }
      if (dm) {
        const ft = (dm[1] ? '-' : '') + (+dm[2]).toLocaleString();
        push(`DENSITY ALT ${val}`, 'remarks', 'Density altitude',
          `${ft} ft — the standard-atmosphere altitude at which air density matches the current conditions`);
        i += consumed; continue;
      }
    }
    // Canadian layer amounts: CU1SC2SC2AC4 → cumulus 1/8, stratocumulus 2/8, …
    // (type then eighths; amounts can sum past 8/8 because layers overlap). TR = trace.
    if (/^(?:(?:TCU|CB|CU|CI|CC|CS|AC|AS|NS|SC|ST)(?:[0-8]|TR))+$/.test(t)) {
      const desc = [...t.matchAll(/(TCU|CB|CU|CI|CC|CS|AC|AS|NS|SC|ST)([0-8]|TR)/g)]
        .map(p => `${CTYPE[p[1]]} ${p[2] === 'TR' ? 'trace' : p[2] + '/8'}`).join(', ');
      push(t, 'remarks', 'Cloud types & amounts', desc); i++; continue;
    }

    // Anything else — keep it visible but undecoded
    push(t, 'remarks', 'Remark', 'Supplementary coded remark'); i++;
  }
}

// ── Flight category ──────────────────────────────────────────

function deriveFlightCategory(parsed) {
  let ceiling = Infinity;
  for (const layer of parsed.sky) {
    if ((layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV') && layer.height !== null) {
      if (layer.height < ceiling) ceiling = layer.height;
    }
  }

  let visSM = Infinity;
  if (parsed.visibility) {
    if (parsed.visibility.unit === 'SM') {
      visSM = parsed.visibility.lessThan ? parsed.visibility.value - 0.01 : parsed.visibility.value;
    } else if (parsed.visibility.unit === 'm') {
      visSM = parsed.visibility.value / 1609.34;
    } else if (parsed.visibility.cavok) {
      visSM = 999;
    }
  }

  if (ceiling < 500 || visSM < 1) return 'LIFR';
  if (ceiling < 1000 || visSM < 3) return 'IFR';
  if (ceiling <= 3000 || visSM <= 5) return 'MVFR';
  return 'VFR';
}

// ── Wind SVG ─────────────────────────────────────────────────

// Station-plot wind barb: shaft drawn FROM the centre toward where the wind is
// coming from; barbs count the speed (half = 5 kt, full = 10 kt, pennant = 50 kt).
function windBarb(dir, speed, cx, cy, color) {
  const s = dir * Math.PI / 180;
  const ux = Math.sin(s), uy = -Math.cos(s);            // unit vector toward the source
  const shaftLen = 58;
  const Ex = cx + ux * shaftLen, Ey = cy + uy * shaftLen;
  // Barbs sit on the right of the shaft (viewed from outside) and angle OUTWARD
  // toward the tip: rotate the shaft direction by an acute +68°.
  const a = 68 * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const bx = ux * ca - uy * sa, by = ux * sa + uy * ca;
  const barbLen = 16, halfLen = 9, step = 9;

  let kt = Math.round(speed / 5) * 5;
  const pennants = Math.floor(kt / 50); kt -= pennants * 50;
  const fulls    = Math.floor(kt / 10); kt -= fulls * 10;
  const halves   = Math.floor(kt / 5);

  let out = `<line x1="${cx}" y1="${cy}" x2="${Ex.toFixed(1)}" y2="${Ey.toFixed(1)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>`;
  let px = Ex, py = Ey;
  for (let i = 0; i < pennants; i++) {
    const ax = px, ay = py, tx = px + bx * barbLen, ty = py + by * barbLen;
    px -= ux * step; py -= uy * step;
    out += `<polygon points="${ax.toFixed(1)},${ay.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}" fill="${color}"/>`;
  }
  if (pennants) { px -= ux * 3; py -= uy * 3; }
  for (let i = 0; i < fulls; i++) {
    out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px + bx * barbLen).toFixed(1)}" y2="${(py + by * barbLen).toFixed(1)}" stroke="${color}" stroke-width="2"/>`;
    px -= ux * step; py -= uy * step;
  }
  if (halves) {
    if (pennants === 0 && fulls === 0) { px -= ux * step; py -= uy * step; }  // inset a lone half-barb
    out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px + bx * halfLen).toFixed(1)}" y2="${(py + by * halfLen).toFixed(1)}" stroke="${color}" stroke-width="2"/>`;
  }
  return out;
}

function buildWindSVG(wind, windVar) {
  if (!wind) return '<div class="vis-placeholder">No wind data</div>';

  const size = 220, h = 246;
  const cx = 110, cy = 92, r = 72;

  const speed = wind.speed;
  let color = '#5d6f3c';                 // sage — light
  if (speed >= 25) color = '#b53d1f';     // rust — strong
  else if (speed >= 15) color = '#d9a521'; // sun — moderate

  const calm = wind.dir === 0 && speed === 0;

  // Faint sector for a variable-direction range (dddVddd)
  let varArc = '';
  if (windVar && wind.dir !== 'VRB') {
    const a0 = windVar.from * Math.PI / 180, a1 = windVar.to * Math.PI / 180;
    const p0x = cx + Math.sin(a0) * r, p0y = cy - Math.cos(a0) * r;
    const p1x = cx + Math.sin(a1) * r, p1y = cy - Math.cos(a1) * r;
    const span = (windVar.to - windVar.from + 360) % 360;
    const large = span > 180 ? 1 : 0;
    varArc = `<path d="M ${cx} ${cy} L ${p0x.toFixed(1)} ${p0y.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${p1x.toFixed(1)} ${p1y.toFixed(1)} Z" fill="${color}" opacity="0.12"/>`;
  }

  // Centre: a station-plot wind barb (or a VRB ring / calm circle)
  let center = '';
  if (wind.dir === 'VRB') {
    center = `<circle cx="${cx}" cy="${cy}" r="15" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="4,3"/>
    <text x="${cx}" y="${cy+4}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="11" font-weight="700" fill="${color}">VRB</text>`;
  } else if (calm) {
    center = `<circle cx="${cx}" cy="${cy}" r="10" fill="none" stroke="${color}" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="2.5" fill="${color}"/>`;
  } else {
    center = `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>` + windBarb(wind.dir, speed, cx, cy, color);
  }

  const dirLabel = wind.dir === 'VRB' ? 'Variable' : calm ? 'Calm' : String(wind.dir).padStart(3, '0') + '°';
  const speedLabel = calm ? '' : `${wind.speed} ${wind.unit}${wind.gust ? ' gust ' + wind.gust : ''}`;
  const varLabel = windVar ? `${String(windVar.from).padStart(3,'0')}°–${String(windVar.to).padStart(3,'0')}° variable` : '';

  return `<svg viewBox="0 0 ${size} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:220px;display:block;margin:0 auto;">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(74,123,166,0.06)" stroke="#b9a87a" stroke-width="1"/>
  ${varArc}
  <g stroke="#b9a87a" stroke-width="0.8" opacity="0.55">
    <line x1="${(cx + r*0.707).toFixed(0)}" y1="${(cy - r*0.707).toFixed(0)}" x2="${(cx + (r+6)*0.707).toFixed(0)}" y2="${(cy - (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx - r*0.707).toFixed(0)}" y1="${(cy - r*0.707).toFixed(0)}" x2="${(cx - (r+6)*0.707).toFixed(0)}" y2="${(cy - (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx + r*0.707).toFixed(0)}" y1="${(cy + r*0.707).toFixed(0)}" x2="${(cx + (r+6)*0.707).toFixed(0)}" y2="${(cy + (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx - r*0.707).toFixed(0)}" y1="${(cy + r*0.707).toFixed(0)}" x2="${(cx - (r+6)*0.707).toFixed(0)}" y2="${(cy + (r+6)*0.707).toFixed(0)}"/>
  </g>
  <g font-family="Anton,sans-serif" font-size="12" fill="#0c2541" text-anchor="middle">
    <text x="${cx}" y="${cy-r-7}">N</text>
    <text x="${cx}" y="${cy+r+17}">S</text>
    <text x="${cx+r+10}" y="${cy+4}">E</text>
    <text x="${cx-r-10}" y="${cy+4}">W</text>
  </g>
  ${center}
  <text x="${cx}" y="210" text-anchor="middle" font-family="Anton,sans-serif" font-size="15" fill="#0c2541">${dirLabel}</text>
  <text x="${cx}" y="227" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="11" fill="${color}">${speedLabel}</text>
  ${varLabel ? `<text x="${cx}" y="239" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="8" fill="#2d4360">${varLabel}</text>` : ''}
</svg>`;
}

// ── Cloud layer SVG ──────────────────────────────────────────

function buildCloudSVG(sky, ceiling) {
  if (!sky || sky.length === 0) return '<div class="vis-placeholder">No sky data</div>';

  const w = 240, h = 252;
  const yTop = 28, yBot = 222;
  const chartH = yBot - yTop;
  const barW = 56, barX = 64;

  // Scale to the highest reported layer (with headroom) so high layers like
  // BKN250 are never clipped — the chart auto-zooms past 12k when clouds are
  // higher. The 12k floor just keeps typical low-cloud METARs from over-zooming.
  const layerAlts = sky.filter(l => l.height !== null).map(l => l.height);
  const highestAlt = layerAlts.length ? Math.max(...layerAlts) : 0;
  const maxAlt = Math.max(12000, Math.ceil((highestAlt * 1.15) / 5000) * 5000);
  const altToY = alt => yBot - (alt / maxAlt) * chartH;

  const COVER_FILL = {
    FEW: 'rgba(74,123,166,0.22)',
    SCT: 'rgba(74,123,166,0.48)',
    BKN: 'rgba(12,37,65,0.62)',
    OVC: 'rgba(12,37,65,0.85)',
    VV:  'rgba(181,61,31,0.5)'
  };
  const TEXT_ON = { FEW: '#2d4360', SCT: '#fff', BKN: '#fff', OVC: '#fff', VV: '#fff' };

  const sorted = [...sky].filter(l => l.height !== null).sort((a, b) => a.height - b.height);

  // Altitude grid
  let grid = '';
  for (let i = 1; i <= 4; i++) {
    const alt = (maxAlt / 4) * i, y = altToY(alt);
    grid += `<line x1="${barX}" y1="${y.toFixed(1)}" x2="${barX + barW}" y2="${y.toFixed(1)}" stroke="#b9a87a" stroke-width="0.5" stroke-dasharray="2,3" opacity="0.7"/>
    <text x="${barX - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="8" fill="#b9a87a">${alt / 1000}k</text>`;
  }

  // Coverage bands. Cover code sits inside the band; height (+CB, +ceiling tag)
  // labels to the right so nothing crosses any text. The ceiling layer gets a
  // red outline and a red label instead of a line through everything.
  let bands = '';
  for (const layer of sorted) {
    const y = altToY(layer.height);
    const fill = COVER_FILL[layer.cover] || 'rgba(74,123,166,0.3)';
    const bh = 17;
    const isCeil = ceiling != null && layer.height === ceiling &&
      (layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV');
    const outline = isCeil ? ' stroke="#b53d1f" stroke-width="2"' : '';
    let right = layer.height.toLocaleString() + ' ft';
    if (layer.cb)  right += ' ' + layer.cb;
    if (isCeil)    right += ' · CEIL';
    const rcolor  = isCeil ? '#b53d1f' : '#2d4360';
    const rweight = isCeil ? ' font-weight="700"' : '';
    bands += `<rect x="${barX}" y="${(y - bh/2).toFixed(1)}" width="${barW}" height="${bh}" fill="${fill}" rx="2"${outline}/>
    <text x="${barX + barW/2}" y="${(y + 3.5).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="9" font-weight="700" fill="${TEXT_ON[layer.cover] || '#fff'}">${layer.cover}</text>
    <text x="${barX + barW + 8}" y="${(y + 3.5).toFixed(1)}" font-family="JetBrains Mono,monospace" font-size="8.5" fill="${rcolor}"${rweight}>${right}</text>`;
  }

  // Clear-sky callout
  const clearCover = sky.find(l => ['SKC', 'CLR', 'NSC', 'NCD'].includes(l.cover));
  let clearLabel = '';
  if (sorted.length === 0 && clearCover) {
    const my = (yTop + yBot) / 2;
    clearLabel = `<text x="${barX + barW/2}" y="${my - 3}" text-anchor="middle" font-family="Anton,sans-serif" font-size="15" fill="#5d6f3c">${clearCover.cover}</text>
    <text x="${barX + barW/2}" y="${my + 14}" text-anchor="middle" font-family="Manrope,sans-serif" font-size="10" fill="#5d6f3c">Sky clear</text>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:230px;display:block;margin:0 auto;">
  <text x="${barX + barW/2}" y="16" text-anchor="middle" font-family="Anton,sans-serif" font-size="10" fill="#0c2541" letter-spacing="0.08em">CLOUD LAYERS</text>
  <rect x="${barX}" y="${yTop}" width="${barW}" height="${chartH}" fill="rgba(74,123,166,0.06)" stroke="#b9a87a" stroke-width="0.8"/>
  ${grid}
  <rect x="${barX}" y="${yBot}" width="${barW}" height="7" fill="rgba(93,111,60,0.45)"/>
  <text x="${barX + barW/2}" y="${yBot + 18}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="8" fill="#5d6f3c">GROUND</text>
  ${bands}
  ${clearLabel}
</svg>`;
}

// ── "Why this category" ceiling/visibility scale ─────────────

function buildCategoryScale(parsed) {
  const cats = ['LIFR', 'IFR', 'MVFR', 'VFR'];
  const ceiling = getCeiling(parsed.sky);

  let visSM = null, visTxt = '—';
  if (parsed.visibility) {
    if (parsed.visibility.unit === 'SM') {
      visSM = parsed.visibility.lessThan ? parsed.visibility.value - 0.01 : parsed.visibility.value;
      visTxt = parsed.visibility.raw;
    } else if (parsed.visibility.unit === 'm') {
      visSM = parsed.visibility.value / 1609.34;
      visTxt = parsed.visibility.raw + ' m';
    } else if (parsed.visibility.cavok) {
      visSM = 999; visTxt = 'CAVOK';
    }
  }

  const ceilIdx = ceiling == null ? 3 : ceiling < 500 ? 0 : ceiling < 1000 ? 1 : ceiling <= 3000 ? 2 : 3;
  const visIdx  = visSM   == null ? 3 : visSM   < 1   ? 0 : visSM   < 3    ? 1 : visSM   <= 5   ? 2 : 3;

  const ceilTxt = ceiling == null ? 'No ceiling' : ceiling.toLocaleString() + ' ft';
  const ceilRanges = ['< 500', '500–999', '1,000–3,000', '> 3,000'];
  const visRanges  = ['< 1', '1–2', '3–5', '> 5'];

  function row(label, idx, ranges, valTxt) {
    const segs = cats.map((c, i) =>
      `<span class="cat-seg seg-${c.toLowerCase()}${i === idx ? ' active' : ''}"><b>${c}</b><i>${ranges[i]}</i></span>`
    ).join('');
    return `<div class="cat-scale-row">
      <span class="cat-scale-label">${label}</span>
      <div class="cat-scale-bar">${segs}</div>
      <span class="cat-scale-val">${escHtml(valTxt)}</span>
    </div>`;
  }

  const tie = ceilIdx === visIdx;
  const driver = ceilIdx < visIdx ? 'ceiling' : 'visibility';
  const note = tie
    ? `Flight category is the <b>more restrictive</b> of ceiling and visibility — both land in <b>${cats[ceilIdx]}</b> here.`
    : `Flight category is the <b>more restrictive</b> of the two — set here by <b>${driver}</b>.`;

  return row('Ceiling', ceilIdx, ceilRanges, ceilTxt)
       + row('Visibility', visIdx, visRanges, visTxt)
       + `<p class="cat-scale-note">${note}</p>`;
}

// ── Renderer: update DOM with decoded METAR ──────────────────

function renderDecoder(parsed) {
  const output = document.getElementById('decoder-output');
  if (!output) return;

  // Flight category badge
  const catEl = document.getElementById('cat-badge');
  const catDesc = document.getElementById('cat-desc');
  if (catEl && catDesc) {
    catEl.textContent = parsed.flightCategory || '—';
    catEl.className = 'cat-badge cat-' + (parsed.flightCategory || 'vfr').toLowerCase();
    const catDescriptions = {
      VFR:  'Ceiling > 3,000 ft AGL and visibility > 5 sm',
      MVFR: 'Ceiling 1,000–3,000 ft AGL or visibility 3–5 sm',
      IFR:  'Ceiling 500–999 ft AGL or visibility 1–2 sm',
      LIFR: 'Ceiling < 500 ft AGL or visibility < 1 sm'
    };
    catDesc.textContent = catDescriptions[parsed.flightCategory] || '';
  }

  // "Why this category" scale
  const scaleEl = document.getElementById('cat-scale');
  if (scaleEl) scaleEl.innerHTML = buildCategoryScale(parsed);

  // Annotated raw METAR
  const rawEl = document.getElementById('decoded-raw');
  if (rawEl) {
    rawEl.innerHTML = parsed.fields
      .map(f => `<span class="tok tok-${f.type}" title="${escHtml(f.label + ': ' + f.explanation)}">${escHtml(f.token)}</span>`)
      .join(' ');
  }

  // Field breakdown table
  const tableEl = document.getElementById('decoded-fields');
  if (tableEl) {
    tableEl.innerHTML = parsed.fields
      .filter(f => f.type !== 'remarks-header')
      .map(f => `<div class="field-row">
        <span class="field-token tok tok-${f.type}">${escHtml(f.token)}</span>
        <span class="field-label">${escHtml(f.label)}</span>
        <span class="field-explanation">${escHtml(f.explanation)}</span>
      </div>`)
      .join('');
  }

  // Wind visual
  const windEl = document.getElementById('wind-visual');
  if (windEl) {
    windEl.innerHTML = buildWindSVG(parsed.wind, parsed.windVariable);
    const windDesc = document.getElementById('wind-desc');
    if (windDesc && parsed.wind) {
      const wd = parsed.wind;
      // Space the direction away from the speed, e.g. "33011KT" → "330 11KT"
      if (wd.dir === 0 && wd.speed === 0) {
        windDesc.textContent = wd.raw;
      } else {
        const dirStr = wd.dir === 'VRB' ? 'VRB' : String(wd.dir).padStart(3, '0');
        windDesc.textContent = `${dirStr} ${wd.speed}${wd.gust ? 'G' + wd.gust : ''}${wd.unit}`;
      }
    }
    // Cross-tool link: prefill the Crosswind calculator with this wind
    const xlink = document.getElementById('wind-xlink');
    if (xlink) {
      const wd = parsed.wind;
      if (wd && wd.dir !== 'VRB' && !(wd.dir === 0 && wd.speed === 0)) {
        const q = `dir=${wd.dir}&speed=${wd.speed}${wd.gust ? '&gust=' + wd.gust : ''}`;
        xlink.innerHTML = `<a href="crosswind.html?${q}">Send this wind to the Crosswind tool →</a>`;
        xlink.hidden = false;
      } else {
        xlink.hidden = true;
        xlink.innerHTML = '';
      }
    }
  }

  // Cloud visual
  const cloudEl = document.getElementById('cloud-visual');
  if (cloudEl) {
    cloudEl.innerHTML = buildCloudSVG(parsed.sky, getCeiling(parsed.sky));
  }

  // Remarks
  const remEl = document.getElementById('decoded-remarks');
  if (remEl) {
    if (parsed.remarks) {
      remEl.textContent = 'RMK ' + parsed.remarks;
      remEl.closest('.remarks-section').hidden = false;
    } else {
      const section = remEl.closest('.remarks-section');
      if (section) section.hidden = true;
    }
  }

  output.hidden = false;
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function getCeiling(sky) {
  let c = Infinity;
  for (const l of sky) {
    if ((l.cover === 'BKN' || l.cover === 'OVC' || l.cover === 'VV') && l.height !== null) {
      if (l.height < c) c = l.height;
    }
  }
  return c === Infinity ? null : c;
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── ICAO fetch ───────────────────────────────────────────────
// Uses the aviationweather.gov public API (no API key required).
// Live fetch requires the site to be served over HTTP — it will not work
// when the file is opened directly from the filesystem (file:// protocol)
// due to browser CORS restrictions. Deploy to GitHub Pages to enable it.
// [VERIFY] URL format against current aviationweather.gov API docs if fetch fails.

async function fetchMetar(icao) {
  if (window.location.protocol === 'file:') {
    throw new Error('file-protocol');
  }
  const url = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(icao)}&format=raw&taf=false`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Server returned HTTP ${resp.status} — check the identifier and try again`);
  const text = (await resp.text()).trim();
  if (!text) throw new Error(`No current METAR found for ${icao} — verify the ICAO identifier`);
  return text.split('\n')[0].trim();
}

// ── Init ─────────────────────────────────────────────────────

function showError(msg) {
  const el = document.getElementById('decoder-error');
  if (el) { el.textContent = msg; el.hidden = false; }
}

function clearError() {
  const el = document.getElementById('decoder-error');
  if (el) { el.textContent = ''; el.hidden = true; }
}

function hideOutput() {
  const el = document.getElementById('decoder-output');
  if (el) el.hidden = true;
}

document.addEventListener('DOMContentLoaded', () => {
  // ── Decode button (paste mode)
  const decodeBtn = document.getElementById('btn-decode');
  const metarInput = document.getElementById('metar-input');
  if (decodeBtn && metarInput) {
    decodeBtn.addEventListener('click', () => {
      clearError();
      const raw = metarInput.value.trim();
      if (!raw) { showError('Paste a METAR to decode.'); return; }
      try {
        const parsed = parseMetar(raw);
        if (!parsed.station) { showError('Could not parse — check that this is a valid METAR.'); return; }
        renderDecoder(parsed);
      } catch (e) {
        showError('Parse error: ' + e.message);
      }
    });
  }

  // ── Fetch button (ICAO lookup mode)
  const fetchBtn = document.getElementById('btn-fetch');
  const icaoInput = document.getElementById('icao-input');
  if (fetchBtn && icaoInput) {
    fetchBtn.addEventListener('click', async () => {
      clearError();
      hideOutput();
      const icao = icaoInput.value.trim().toUpperCase();
      if (!icao || !/^[A-Z]{3,4}$/.test(icao)) {
        showError('Enter a 3- or 4-letter ICAO airport identifier (e.g. KDFW or EGLL).');
        return;
      }
      fetchBtn.textContent = 'Fetching…';
      fetchBtn.disabled = true;
      try {
        const raw = await fetchMetar(icao);
        if (metarInput) metarInput.value = raw;
        const parsed = parseMetar(raw);
        renderDecoder(parsed);
      } catch (e) {
        if (e.message === 'file-protocol') {
          showError('Live lookup is not available when the file is opened directly. Use the "Paste a METAR" tab — copy any raw METAR from aviationweather.gov and paste it there.');
        } else {
          showError(`Could not fetch METAR for ${icao}: ${e.message}.`);
        }
      } finally {
        fetchBtn.textContent = 'Fetch METAR';
        fetchBtn.disabled = false;
      }
    });

    // Allow Enter key on ICAO input
    icaoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') fetchBtn.click();
    });
  }

  // ── Example METAR button
  const exampleBtn = document.getElementById('btn-example');
  if (exampleBtn && metarInput) {
    const examples = [
      'METAR KDFW 031753Z 23015G25KT 10SM -RA SCT018 BKN065 OVC090 24/19 A2987 RMK AO2 SLP117',
      'METAR KORD 121552Z AUTO 31008KT 1 1/4SM +TSRA BKN009 OVC020CB 18/16 A2979 RMK AO2 PRESRR',
      'METAR KDEN 151835Z 27020G35KT 7SM SKC 32/03 A2964 RMK AO2 SLP028',
      'METAR KSFO 080556Z 00000KT 10SM FEW015 13/11 A3007 RMK AO2 SLP184',
      'METAR KBOS 202253Z 03018KT 3SM BR OVC003 07/06 A2991 RMK AO2 SLP130',
      // Automated slash groups: amount/height not measured. Temp, altimeter and
      // remarks must still decode after the //////xx group.
      'METAR KMIA 211853Z AUTO 09012KT 10SM //////TCU 30/23 A3005 RMK AO2 SLP175',
      'METAR KTPA 211953Z AUTO 27015G22KT 9SM //////CB 31/24 A3002 RMK AO2 LTG DSNT W',
      'METAR KOKC 212053Z AUTO 18008KT 10SM ////// 28/19 A2995 RMK AO2'
    ];
    let exIdx = 0;
    exampleBtn.addEventListener('click', () => {
      metarInput.value = examples[exIdx % examples.length];
      exIdx++;
      clearError();
      hideOutput();
    });
  }

  // ── Show file-protocol notice in ICAO panel if needed
  if (window.location.protocol === 'file:') {
    const notice = document.getElementById('icao-file-notice');
    const fetchBtn2 = document.getElementById('btn-fetch');
    const icaoInput2 = document.getElementById('icao-input');
    if (notice) notice.hidden = false;
    if (fetchBtn2) { fetchBtn2.disabled = true; fetchBtn2.title = 'Requires HTTP server'; }
    if (icaoInput2) icaoInput2.disabled = true;
  }

  // ── Tab switching
  document.querySelectorAll('.decoder-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.decoder-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.decoder-panel').forEach(p => p.hidden = true);
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const target = document.getElementById(tab.dataset.panel);
      if (target) target.hidden = false;
      clearError();
      hideOutput();
    });
  });
});
