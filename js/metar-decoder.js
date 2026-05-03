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
  NSC: 'No significant cloud (WMO)'
};

// ── Main METAR parser ────────────────────────────────────────

function parseMetar(rawInput) {
  // Normalize whitespace
  let raw = rawInput.trim().toUpperCase().replace(/\s+/g, ' ');

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
    fields: []
  };

  function push(token, type, label, explanation) {
    result.fields.push({ token, type, label, explanation });
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
    } else {
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
  }

  // 10 ── Temperature / Dewpoint: TT/DD
  if (i < tokens.length && /^M?\d+\/M?\d+$/.test(tokens[i])) {
    const parts = tokens[i].split('/');
    result.temp = parseTemp(parts[0]);
    result.dewpoint = parseTemp(parts[1]);
    const spread = result.temp - result.dewpoint;
    let desc = `Temp ${result.temp}°C, dewpoint ${result.dewpoint}°C`;
    desc += ` — T/D spread ${spread}°C`;
    if (spread <= 2) desc += ' · fog or low visibility likely as spread closes';
    else if (spread <= 5) desc += ' · watch for increasing moisture';
    push(tokens[i], 'temp', 'Temperature / Dewpoint', desc);
    i++;
  }

  // 11 ── Altimeter: Adddd (inHg) or Qdddd (hPa)
  if (i < tokens.length && /^[AQ]\d{4}$/.test(tokens[i])) {
    const tok = tokens[i];
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
    i++;
  }

  // 12 ── Remarks
  if (i < tokens.length && tokens[i] === 'RMK') {
    const remarkTokens = tokens.slice(i + 1);
    result.remarks = remarkTokens.join(' ');
    push('RMK', 'remarks-header', 'Remarks', 'Supplemental information (US domestic only)');
    parseRemarks(remarkTokens, push);
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

  // Check compound codes first
  for (const code of Object.keys(WX_TYPE)) {
    if (s === code) { parts.push(WX_TYPE[code]); return parts.join(' '); }
  }

  // Descriptor
  for (const [code, label] of Object.entries(WX_DESCRIPTOR)) {
    if (s.startsWith(code) && WX_TYPE[s.slice(code.length)] !== undefined) {
      parts.push(label); s = s.slice(code.length); break;
    }
  }

  // Weather type(s)
  let matched = false;
  while (s.length >= 2) {
    const code = s.slice(0, 2);
    if (WX_TYPE[code]) { parts.push(WX_TYPE[code]); s = s.slice(2); matched = true; }
    else break;
  }

  return matched || parts.length > 0 ? parts.join(' ') : null;
}

function parseRemarks(tokens, push) {
  const joined = tokens.join(' ');

  if (tokens.includes('AO1'))
    push('AO1', 'remarks', 'Sensor', 'Automated station — no precipitation type discriminator');
  if (tokens.includes('AO2'))
    push('AO2', 'remarks', 'Sensor', 'Automated station — has precipitation type discriminator');

  const slpM = joined.match(/\bSLP(\d{3})\b/);
  if (slpM) {
    const v = +slpM[1];
    const hpa = ((v >= 550 ? 900 : 1000) + v / 10).toFixed(1);
    push(`SLP${slpM[1]}`, 'remarks', 'Sea-level pressure', `${hpa} hPa`);
  }

  const pkM = joined.match(/\bPK\s+WND\s+(\d{3})(\d{2,3})\/(\d{4})\b/);
  if (pkM)
    push(`PK WND ${pkM[1]}${pkM[2]}/${pkM[3]}`, 'remarks', 'Peak wind',
      `${pkM[2]} kt from ${pkM[1]}° at ${pkM[3].slice(0,2)}:${pkM[3].slice(2)} UTC`);

  if (/\bPRESRR\b/.test(joined)) push('PRESRR', 'remarks', 'Pressure', 'Rising rapidly');
  if (/\bPRESFR\b/.test(joined)) push('PRESFR', 'remarks', 'Pressure', 'Falling rapidly');
  if (tokens.includes('TSNO')) push('TSNO', 'remarks', 'Thunderstorm sensor', 'Not available at this station');
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

function buildWindSVG(wind) {
  if (!wind) return '<div class="vis-placeholder">No wind data</div>';

  const size = 200;
  const cx = 100, cy = 100, r = 70;

  const speed = wind.speed;
  let arrowColor = '#5d6f3c'; // sage — light
  if (speed >= 25) arrowColor = '#b53d1f';       // rust — strong
  else if (speed >= 15) arrowColor = '#d9a521';  // sun — moderate

  let arrowSVG = '';
  if (wind.dir === 'VRB') {
    // Variable: draw a circle of small arrows
    arrowSVG = `<circle cx="${cx}" cy="${cy}" r="12" fill="none" stroke="${arrowColor}" stroke-width="2" stroke-dasharray="4,3"/>
    <text x="${cx}" y="${cy+5}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="10" fill="${arrowColor}">VRB</text>`;
  } else if (wind.dir === 0 && speed === 0) {
    arrowSVG = `<circle cx="${cx}" cy="${cy}" r="8" fill="${arrowColor}" opacity="0.5"/>
    <text x="${cx}" y="${cy+30}" text-anchor="middle" font-family="Manrope,sans-serif" font-size="11" fill="#2d4360">Calm</text>`;
  } else {
    // Arrow points in the direction wind is blowing (away from origin).
    // Wind from 270° (west) → air flows east → arrow points east.
    const fromRad = ((wind.dir + 180) % 360) * Math.PI / 180;
    const arrowLen = r - 10;
    const tx = cx + Math.sin(fromRad) * arrowLen;
    const ty = cy - Math.cos(fromRad) * arrowLen;
    const tailX = cx - Math.sin(fromRad) * 20;
    const tailY = cy + Math.cos(fromRad) * 20;

    arrowSVG = `<line x1="${tailX.toFixed(1)}" y1="${tailY.toFixed(1)}" x2="${tx.toFixed(1)}" y2="${ty.toFixed(1)}"
      stroke="${arrowColor}" stroke-width="3" stroke-linecap="round"/>
    <polygon points="${tx.toFixed(1)},${ty.toFixed(1)} ${(tx - Math.sin(fromRad - 0.4) * 12).toFixed(1)},${(ty + Math.cos(fromRad - 0.4) * 12).toFixed(1)} ${(tx - Math.sin(fromRad + 0.4) * 12).toFixed(1)},${(ty + Math.cos(fromRad + 0.4) * 12).toFixed(1)}"
      fill="${arrowColor}"/>`;
  }

  const dirLabel = wind.dir === 'VRB' ? 'VRB' : String(wind.dir).padStart(3, '0') + '°';
  const speedLabel = wind.dir === 0 && wind.speed === 0 ? 'Calm' : `${wind.speed} ${wind.unit}`;
  const gustLabel = wind.gust ? `G${wind.gust}` : '';

  return `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:200px;display:block;margin:0 auto;">
  <!-- Compass ring -->
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="rgba(74,123,166,0.06)" stroke="#b9a87a" stroke-width="1"/>
  <!-- Cardinal ticks -->
  <g font-family="Anton,sans-serif" font-size="11" fill="#0c2541" text-anchor="middle">
    <text x="${cx}" y="${cy-r-6}">N</text>
    <text x="${cx}" y="${cy+r+15}">S</text>
    <text x="${cx+r+8}" y="${cy+4}">E</text>
    <text x="${cx-r-8}" y="${cy+4}">W</text>
  </g>
  <!-- Intercardinal ticks -->
  <g stroke="#b9a87a" stroke-width="0.8" opacity="0.6">
    <line x1="${(cx + r*0.707).toFixed(0)}" y1="${(cy - r*0.707).toFixed(0)}" x2="${(cx + (r+6)*0.707).toFixed(0)}" y2="${(cy - (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx - r*0.707).toFixed(0)}" y1="${(cy - r*0.707).toFixed(0)}" x2="${(cx - (r+6)*0.707).toFixed(0)}" y2="${(cy - (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx + r*0.707).toFixed(0)}" y1="${(cy + r*0.707).toFixed(0)}" x2="${(cx + (r+6)*0.707).toFixed(0)}" y2="${(cy + (r+6)*0.707).toFixed(0)}"/>
    <line x1="${(cx - r*0.707).toFixed(0)}" y1="${(cy + r*0.707).toFixed(0)}" x2="${(cx - (r+6)*0.707).toFixed(0)}" y2="${(cy + (r+6)*0.707).toFixed(0)}"/>
  </g>
  ${arrowSVG}
  <!-- Labels -->
  <text x="${cx}" y="175" text-anchor="middle" font-family="Anton,sans-serif" font-size="13" fill="#0c2541">${dirLabel}</text>
  <text x="${cx}" y="190" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="11" fill="${arrowColor}">${speedLabel}${gustLabel ? ' G'+wind.gust : ''}</text>
</svg>`;
}

// ── Cloud layer SVG ──────────────────────────────────────────

function buildCloudSVG(sky, ceiling) {
  if (!sky || sky.length === 0) return '<div class="vis-placeholder">No sky data</div>';

  const w = 180, h = 240;
  const maxAlt = 15000;
  const yTop = 20, yBot = 220;
  const chartH = yBot - yTop;
  const barW = 50, barX = 65;

  function altToY(alt) {
    return yBot - (alt / maxAlt) * chartH;
  }

  const COVER_FILL = {
    FEW: 'rgba(74,123,166,0.18)',
    SCT: 'rgba(74,123,166,0.35)',
    BKN: 'rgba(12,37,65,0.55)',
    OVC: 'rgba(12,37,65,0.80)',
    VV: 'rgba(181,61,31,0.4)'
  };

  let layers = '';
  let ceilLine = '';
  let labels = '';

  // Sort by height ascending
  const sorted = [...sky].filter(l => l.height !== null).sort((a, b) => a.height - b.height);

  for (const layer of sorted) {
    const y = altToY(layer.height);
    const fill = COVER_FILL[layer.cover] || 'rgba(74,123,166,0.3)';
    const bandH = Math.max(8, (layer.cover === 'OVC' || layer.cover === 'BKN' || layer.cover === 'VV') ? 12 : 6);
    layers += `<rect x="${barX}" y="${(y - bandH/2).toFixed(1)}" width="${barW}" height="${bandH}" fill="${fill}" rx="1"/>`;

    // Ceiling line
    if (layer.cover === 'BKN' || layer.cover === 'OVC' || layer.cover === 'VV') {
      if (layer.height === ceiling) {
        ceilLine = `<line x1="${barX - 6}" y1="${y.toFixed(1)}" x2="${barX + barW + 6}" y2="${y.toFixed(1)}" stroke="#b53d1f" stroke-width="1.5" stroke-dasharray="4,2"/>
        <text x="${barX + barW + 10}" y="${(y+4).toFixed(1)}" font-family="JetBrains Mono,monospace" font-size="8" fill="#b53d1f">CEIL</text>`;
      }
    }

    // Label
    const altLabel = layer.height >= 1000
      ? (layer.height / 1000).toFixed(1) + 'k'
      : layer.height + '';
    labels += `<text x="${barX - 8}" y="${(y+4).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="8" fill="#2d4360">${altLabel}</text>
    <text x="${barX + barW/2}" y="${(y+3).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="7" fill="#fff" font-weight="600">${layer.cover}</text>`;
  }

  // Handle clear sky conditions
  const hasData = sorted.length > 0;
  const clearCover = sky.find(l => l.cover === 'SKC' || l.cover === 'CLR' || l.cover === 'NSC');

  let clearLabel = '';
  if (!hasData && clearCover) {
    clearLabel = `<text x="${w/2}" y="${yBot - 40}" text-anchor="middle" font-family="Anton,sans-serif" font-size="14" fill="#5d6f3c">${clearCover.cover}</text>
    <text x="${w/2}" y="${yBot - 22}" text-anchor="middle" font-family="Manrope,sans-serif" font-size="10" fill="#5d6f3c">Sky clear</text>`;
  }

  // Y-axis altitude labels
  let yLabels = '';
  for (const alt of [3000, 6000, 9000, 12000, 15000]) {
    const y = altToY(alt);
    yLabels += `<line x1="${barX - 4}" y1="${y.toFixed(1)}" x2="${barX + barW + 4}" y2="${y.toFixed(1)}" stroke="#b9a87a" stroke-width="0.5" stroke-dasharray="2,3"/>
    <text x="${barX - 8}" y="${(y+3).toFixed(1)}" text-anchor="end" font-family="JetBrains Mono,monospace" font-size="8" fill="#b9a87a">${alt/1000}k</text>`;
  }

  return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:180px;display:block;margin:0 auto;">
  <!-- Sky column background -->
  <rect x="${barX}" y="${yTop}" width="${barW}" height="${chartH}" fill="rgba(74,123,166,0.06)" stroke="#b9a87a" stroke-width="0.8"/>
  <!-- Grid lines -->
  ${yLabels}
  <!-- Ground -->
  <rect x="${barX}" y="${yBot}" width="${barW}" height="6" fill="rgba(93,111,60,0.4)"/>
  <!-- Cloud layers -->
  ${layers}
  ${clearLabel}
  <!-- Ceiling line -->
  ${ceilLine}
  <!-- Title -->
  <text x="${w/2}" y="12" text-anchor="middle" font-family="Anton,sans-serif" font-size="9" fill="#0c2541" letter-spacing="0.08em">CLOUD LAYERS</text>
  <text x="${barX + barW/2}" y="${yBot + 14}" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="8" fill="#5d6f3c">GND</text>
</svg>`;
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
    windEl.innerHTML = buildWindSVG(parsed.wind);
    const windDesc = document.getElementById('wind-desc');
    if (windDesc && parsed.wind) {
      windDesc.textContent = parsed.wind.raw;
    }
  }

  // Cloud visual
  const cloudEl = document.getElementById('cloud-visual');
  if (cloudEl) {
    cloudEl.innerHTML = buildCloudSVG(parsed.sky, parsed.flightCategory !== 'VFR' ? getCeiling(parsed.sky) : null);
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
      'METAR KBOS 202253Z 03018KT 3SM BR OVC003 07/06 A2991 RMK AO2 SLP130'
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
      document.querySelectorAll('.decoder-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.decoder-panel').forEach(p => p.hidden = true);
      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.panel);
      if (target) target.hidden = false;
      clearError();
      hideOutput();
    });
  });
});
