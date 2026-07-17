/* ============================================================
   CrosswindWX — taf-decoder.js
   TAF parser and timeline renderer.
   Relies on metar-decoder.js being loaded first for:
   decodeWeather(), parseFraction(), deriveFlightCategory(),
   escHtml(), COVER_LABEL, WX_TYPE, WX_DESCRIPTOR
   ============================================================ */

// ── TAF group type metadata ───────────────────────────────────

const GROUP_META = {
  'BASE':       { label: 'Base forecast',    indent: false },
  'FM':         { label: 'From',             indent: false },
  'TEMPO':      { label: 'Temporarily',      indent: true  },
  'BECMG':      { label: 'Becoming',         indent: true  },
  'PROB30':     { label: '30% probability',  indent: true  },
  'PROB40':     { label: '40% probability',  indent: true  },
  'PROB30 TEMPO': { label: '30% prob · temporary', indent: true },
  'PROB40 TEMPO': { label: '40% prob · temporary', indent: true },
  'INTER':      { label: 'Intermittent',     indent: true  },
};

// ── Main TAF parser ──────────────────────────────────────────

function parseTaf(rawInput) {
  let raw = rawInput.trim().toUpperCase().replace(/\s+/g, ' ').replace(/=\s*$/, '');

  const tokens = raw.split(' ');

  // Merge two-token fractional vis: ["1", "1/2SM"] → ["1 1/2SM"]
  for (let j = 0; j < tokens.length - 1; j++) {
    if (/^\d+$/.test(tokens[j]) && /^\d+\/\d+SM$/.test(tokens[j + 1])) {
      tokens.splice(j, 2, tokens[j] + ' ' + tokens[j + 1]);
      break;
    }
  }

  const result = {
    raw,
    type: 'TAF',
    station: null,
    issueTime: null,
    validFrom: null,
    validTo: null,
    groups: []
  };

  let i = 0;

  // 1 ── Type: TAF [AMD|COR]
  if (tokens[i] === 'TAF') {
    i++;
    if (tokens[i] === 'AMD') { result.type = 'TAF AMD'; i++; }
    else if (tokens[i] === 'COR') { result.type = 'TAF COR'; i++; }
  }

  // 2 ── Station
  if (i < tokens.length && /^[A-Z]{4}$/.test(tokens[i])) {
    result.station = tokens[i++];
  }

  // 3 ── Issue time DDHHMMz
  if (i < tokens.length && /^\d{6}Z$/.test(tokens[i])) {
    const t = tokens[i++];
    result.issueTime = { raw: t, day: +t.slice(0,2), hour: +t.slice(2,4), min: +t.slice(4,6) };
  }

  // 4 ── Valid period DDHH/DDHH
  if (i < tokens.length && /^\d{4}\/\d{4}$/.test(tokens[i])) {
    const [f, t] = tokens[i++].split('/');
    result.validFrom = { day: +f.slice(0,2), hour: +f.slice(2,4) };
    result.validTo   = { day: +t.slice(0,2), hour: +t.slice(2,4) };
  }

  // 5 ── Find group boundaries then slice
  const BOUNDARY = /^(TEMPO|BECMG|PROB\d{2}|INTER|FM\d{6})$/;
  const starts = [i];
  for (let j = i + 1; j < tokens.length; j++) {
    if (BOUNDARY.test(tokens[j])) {
      // PROB can be followed by TEMPO — keep them together
      if (/^PROB\d{2}$/.test(tokens[j]) && tokens[j+1] === 'TEMPO') {
        starts.push(j);
        j++; // skip TEMPO — it will be consumed inside parseGroup
      } else {
        starts.push(j);
      }
    }
  }
  starts.push(tokens.length);

  for (let g = 0; g < starts.length - 1; g++) {
    const group = parseGroup(tokens.slice(starts[g], starts[g + 1]), g === 0);
    result.groups.push(group);
  }

  // 6 ── Fill in implied validTo for BASE and FM groups
  for (let g = 0; g < result.groups.length; g++) {
    const grp = result.groups[g];
    if (grp.type === 'BASE' || grp.type === 'FM') {
      // validTo = next FM's validFrom, or TAF validTo
      let next = result.validTo;
      for (let h = g + 1; h < result.groups.length; h++) {
        if (result.groups[h].type === 'FM') { next = result.groups[h].validFrom; break; }
      }
      grp.validTo = next;
    }
    if (grp.type === 'BASE') {
      grp.validFrom = result.validFrom;
    }
  }

  return result;
}

// ── Parse a single group's conditions ────────────────────────

function parseGroup(tokens, isBase) {
  const group = {
    type: isBase ? 'BASE' : '?',
    validFrom: null,
    validTo: null,
    wind: null,
    visibility: null,
    weather: [],
    sky: [],
    windShear: null,
    nsw: false,
    flightCategory: null
  };

  let i = 0;
  const tok0 = tokens[0];

  if (isBase) {
    group.type = 'BASE';
    // validFrom/validTo set by caller
  } else if (/^FM\d{6}$/.test(tok0)) {
    group.type = 'FM';
    const t = tok0.slice(2);
    group.validFrom = { day: +t.slice(0,2), hour: +t.slice(2,4), min: +t.slice(4,6) };
    i++;
  } else if (tok0 === 'TEMPO') {
    group.type = 'TEMPO';
    i++;
    if (/^\d{4}\/\d{4}$/.test(tokens[i])) {
      const [f, t] = tokens[i++].split('/');
      group.validFrom = { day: +f.slice(0,2), hour: +f.slice(2,4) };
      group.validTo   = { day: +t.slice(0,2), hour: +t.slice(2,4) };
    }
  } else if (tok0 === 'BECMG') {
    group.type = 'BECMG';
    i++;
    if (/^\d{4}\/\d{4}$/.test(tokens[i])) {
      const [f, t] = tokens[i++].split('/');
      group.validFrom = { day: +f.slice(0,2), hour: +f.slice(2,4) };
      group.validTo   = { day: +t.slice(0,2), hour: +t.slice(2,4) };
    }
  } else if (/^PROB(\d{2})$/.test(tok0)) {
    const prob = tok0.match(/^PROB(\d{2})$/)[1];
    i++;
    if (tokens[i] === 'TEMPO') {
      group.type = `PROB${prob} TEMPO`;
      i++;
    } else {
      group.type = `PROB${prob}`;
    }
    if (/^\d{4}\/\d{4}$/.test(tokens[i])) {
      const [f, t] = tokens[i++].split('/');
      group.validFrom = { day: +f.slice(0,2), hour: +f.slice(2,4) };
      group.validTo   = { day: +t.slice(0,2), hour: +t.slice(2,4) };
    }
  } else if (tok0 === 'INTER') {
    group.type = 'INTER';
    i++;
    if (/^\d{4}\/\d{4}$/.test(tokens[i])) {
      const [f, t] = tokens[i++].split('/');
      group.validFrom = { day: +f.slice(0,2), hour: +f.slice(2,4) };
      group.validTo   = { day: +t.slice(0,2), hour: +t.slice(2,4) };
    }
  }

  // ── Wind
  if (i < tokens.length) {
    const wm = tokens[i].match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
    if (wm) {
      group.wind = {
        raw: tokens[i],
        dir: wm[1] === 'VRB' ? 'VRB' : +wm[1],
        speed: +wm[2],
        gust: wm[3] ? +wm[3] : null,
        unit: wm[4]
      };
      i++;
      if (i < tokens.length && /^\d{3}V\d{3}$/.test(tokens[i])) i++;
    }
  }

  // ── Visibility (P6SM is TAF-only; also standard SM / metric)
  if (i < tokens.length) {
    const tok = tokens[i];
    if (tok === 'CAVOK') {
      group.visibility = { raw: tok, value: 10, unit: 'km', cavok: true };
      i++;
    } else if (/^P\d+SM$/.test(tok)) {
      const val = parseFloat(tok.slice(1).replace('SM',''));
      group.visibility = { raw: tok, value: val, unit: 'SM', plus: true };
      i++;
    } else if (/^M?\d+SM$/.test(tok) || /^\d+\/\d+SM$/.test(tok) || /^M\d+\/\d+SM$/.test(tok) || /^\d+ \d+\/\d+SM$/.test(tok)) {
      const lessThan = tok.startsWith('M');
      const numPart = tok.replace(/^M/, '').replace('SM', '').trim();
      group.visibility = { raw: tok, value: parseFraction(numPart), unit: 'SM', lessThan };
      i++;
    } else if (/^\d{4}$/.test(tok)) {
      group.visibility = { raw: tok, value: +tok, unit: 'm' };
      i++;
    }
  }

  // ── Present weather (NSW = No Significant Weather)
  while (i < tokens.length) {
    if (tokens[i] === 'NSW') { group.nsw = true; i++; continue; }
    const decoded = decodeWeather(tokens[i]);
    if (decoded === null) break;
    group.weather.push({ raw: tokens[i], decoded });
    i++;
  }

  // ── Sky condition
  while (i < tokens.length) {
    const tok = tokens[i];
    if (/^(SKC|CLR|NSC|NCD)$/.test(tok)) {
      group.sky.push({ raw: tok, cover: tok, height: null, cb: null });
      i++;
    } else {
      const sm = tok.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      if (!sm) break;
      group.sky.push({ raw: tok, cover: sm[1], height: +sm[2] * 100, cb: sm[3] || null });
      i++;
    }
  }

  // ── Wind shear: WS###/dddssKT (anywhere in remaining tokens)
  for (let j = i; j < tokens.length; j++) {
    const wsm = tokens[j].match(/^WS(\d{3})\/(\d{3})(\d{2,3})(KT|MPS)$/);
    if (wsm) {
      group.windShear = {
        raw: tokens[j],
        altitude: +wsm[1] * 100,
        dir: +wsm[2],
        speed: +wsm[3],
        unit: wsm[4]
      };
    }
  }

  group.flightCategory = deriveFlightCategory(group);
  return group;
}

// ── TAF Renderer ─────────────────────────────────────────────

function renderTaf(parsed) {
  const output = document.getElementById('taf-output');
  if (!output) return;

  // Header
  const stationEl = document.getElementById('taf-station');
  const typeEl    = document.getElementById('taf-type-badge');
  const validEl   = document.getElementById('taf-valid');
  const issuedEl  = document.getElementById('taf-issued');

  if (stationEl) stationEl.textContent = parsed.station || '—';
  if (typeEl)    typeEl.textContent    = parsed.type || 'TAF';
  if (validEl && parsed.validFrom && parsed.validTo) {
    validEl.textContent = `Valid ${formatTafTime(parsed.validFrom)} – ${formatTafTime(parsed.validTo)}`;
  }
  if (issuedEl && parsed.issueTime) {
    issuedEl.textContent = `Issued D${String(parsed.issueTime.day).padStart(2,'0')} ${String(parsed.issueTime.hour).padStart(2,'0')}:${String(parsed.issueTime.min).padStart(2,'0')}Z`;
  }

  // Raw TAF display
  const rawEl = document.getElementById('taf-raw');
  if (rawEl) rawEl.textContent = parsed.raw;

  // Visual overview band
  const overviewEl = document.getElementById('taf-overview');
  if (overviewEl) overviewEl.innerHTML = buildTafOverview(parsed);

  // Timeline (detailed cards)
  const timelineEl = document.getElementById('taf-timeline');
  if (timelineEl) {
    timelineEl.innerHTML = parsed.groups.map(g => buildGroupCard(g)).join('');
  }

  output.hidden = false;
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Visual overview: prevailing band + change-group overlays ──

function buildTafOverview(parsed) {
  if (!parsed.validFrom || !parsed.validTo) return '';
  const absH = t => t.day * 24 + t.hour + (t.min ? t.min / 60 : 0);
  let startAbs = absH(parsed.validFrom), endAbs = absH(parsed.validTo);
  if (endAbs <= startAbs) endAbs += 31 * 24;           // month-rollover guard
  const dur = endAbs - startAbs;
  if (dur <= 0) return '';
  const off = t => { let a = absH(t); if (a < startAbs) a += 31 * 24; return Math.max(0, Math.min(dur, a - startAbs)); };
  const pct = h => (h / dur * 100);

  const CAT = { VFR: '#3a7d44', MVFR: '#1a5ba6', IFR: '#b53d1f', LIFR: '#7b2d8b' };

  // Prevailing band — BASE + FM groups tile the whole period
  const band = parsed.groups
    .filter(g => g.type === 'BASE' || g.type === 'FM')
    .map(g => {
      const s = off(g.validFrom || parsed.validFrom), e = off(g.validTo || parsed.validTo);
      const w = pct(e - s);
      if (w <= 0.2) return '';
      const cat = g.flightCategory || 'VFR';
      return `<div class="tl-seg" style="left:${pct(s).toFixed(2)}%;width:${w.toFixed(2)}%;background:${CAT[cat]}" title="${cat} ${buildTimeStr(g)}"><span>${w > 6 ? cat : ''}</span></div>`;
    }).join('');

  // Change groups — each on its own row so overlapping spans never collide
  const overlays = parsed.groups
    .filter(g => ['TEMPO', 'BECMG', 'INTER'].includes(g.type) || g.type.startsWith('PROB'))
    .map(g => {
      if (!g.validFrom || !g.validTo) return '';
      const s = off(g.validFrom), e = off(g.validTo);
      const w = pct(e - s);
      if (w <= 0.2) return '';
      const cat = (g.flightCategory || 'VFR').toLowerCase();
      const label = (GROUP_META[g.type] && GROUP_META[g.type].label) || g.type;
      return `<div class="tl-ovrow"><div class="tl-ov tl-ov-${cat}" style="left:${pct(s).toFixed(2)}%;width:${w.toFixed(2)}%" title="${label} · ${buildTimeStr(g)}"><span>${w > 10 ? escHtml(label) : '•'}</span></div></div>`;
    }).join('');

  // Hour axis every 6 h
  let ticks = '';
  for (let h = 0; h <= dur + 0.01; h += 6) {
    const hr = Math.round((parsed.validFrom.hour + h)) % 24;
    ticks += `<div class="tl-tick" style="left:${pct(Math.min(h, dur)).toFixed(2)}%"><span>${String(hr).padStart(2, '0')}Z</span></div>`;
  }

  return `<div class="tl-band">${band}</div>${overlays ? overlays : ''}<div class="tl-axis">${ticks}</div>`;
}

function buildGroupCard(group) {
  const meta = GROUP_META[group.type] || { label: group.type, indent: false };
  const cat  = (group.flightCategory || 'VFR').toLowerCase();
  const indentClass = meta.indent ? ' taf-group--indent' : '';
  const typeKey = group.type.split(' ')[0].toLowerCase();

  const timeStr = buildTimeStr(group);
  const condStr = buildConditionsStr(group);
  const windStr = buildWindStr(group.wind);
  const visStr  = buildVisStr(group.visibility);
  const wxStr   = group.nsw ? 'No sig wx' : group.weather.map(w => w.raw).join(' ');
  const skyStr  = buildSkyStr(group.sky);
  const wsStr   = group.windShear
    ? `WS ${group.windShear.altitude.toLocaleString()} ft: ${group.windShear.dir}° / ${group.windShear.speed} ${group.windShear.unit}`
    : '';

  const chips = [
    windStr  && `<span class="taf-chip taf-chip-wind">${escHtml(windStr)}</span>`,
    visStr   && `<span class="taf-chip taf-chip-vis">${escHtml(visStr)}</span>`,
    wxStr    && `<span class="taf-chip taf-chip-wx">${escHtml(wxStr)}</span>`,
    skyStr   && `<span class="taf-chip taf-chip-sky">${escHtml(skyStr)}</span>`,
    wsStr    && `<span class="taf-chip taf-chip-ws">${escHtml(wsStr)}</span>`,
  ].filter(Boolean).join('');

  return `<div class="taf-group taf-group--${cat}${indentClass}">
  <div class="taf-group-header">
    <span class="taf-type-label taf-type-${typeKey}">${escHtml(meta.label)}</span>
    <span class="taf-time-range">${escHtml(timeStr)}</span>
    <span class="cat-badge cat-${cat}">${group.flightCategory || '—'}</span>
  </div>
  <div class="taf-group-chips">${chips || '<span class="taf-chip-empty">No condition changes</span>'}</div>
</div>`;
}

// ── Time / condition helpers ─────────────────────────────────

function formatTafTime(t) {
  if (!t) return '?';
  const hr = String(t.hour).padStart(2,'0');
  const min = t.min !== undefined ? String(t.min).padStart(2,'0') : '00';
  return `D${String(t.day).padStart(2,'0')} ${hr}:${min}Z`;
}

function buildTimeStr(group) {
  if (group.type === 'FM') {
    const from = formatTafTime(group.validFrom);
    const to   = group.validTo ? formatTafTime(group.validTo) : 'end of TAF';
    return `${from} → ${to}`;
  }
  if (group.type === 'BASE') {
    const from = formatTafTime(group.validFrom);
    const to   = group.validTo ? formatTafTime(group.validTo) : 'first change';
    return `${from} → ${to}`;
  }
  if (group.validFrom && group.validTo) {
    return `${formatTafTime(group.validFrom)} → ${formatTafTime(group.validTo)}`;
  }
  return '';
}

function buildWindStr(wind) {
  if (!wind) return '';
  if (wind.dir === 0 && wind.speed === 0) return 'Calm';
  const dir = wind.dir === 'VRB' ? 'VRB' : String(wind.dir).padStart(3,'0') + '°';
  let s = `${dir} / ${wind.speed} ${wind.unit}`;
  if (wind.gust) s += ` G${wind.gust}`;
  return s;
}

function buildVisStr(vis) {
  if (!vis) return '';
  if (vis.cavok) return 'CAVOK';
  if (vis.plus)  return `>${vis.value} SM`;
  if (vis.raw)   return vis.raw;
  return `${vis.value} ${vis.unit}`;
}

function buildSkyStr(sky) {
  if (!sky || sky.length === 0) return '';
  return sky.map(l => {
    if (l.height === null) return l.cover;
    const ht = (l.height / 100).toString().padStart(3,'0');
    return l.cover + ht + (l.cb ? l.cb : '');
  }).join(' ');
}

function buildConditionsStr(group) {
  const parts = [];
  if (group.wind) parts.push(buildWindStr(group.wind));
  if (group.visibility) parts.push(buildVisStr(group.visibility));
  group.weather.forEach(w => parts.push(w.raw));
  parts.push(buildSkyStr(group.sky));
  return parts.filter(Boolean).join('  ·  ');
}

// ── ICAO TAF fetch ────────────────────────────────────────────

async function fetchTaf(icao) {
  if (window.location.protocol === 'file:') throw new Error('file-protocol');
  const url = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=raw`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Server returned HTTP ${resp.status}`);
  const text = (await resp.text()).trim();
  if (!text) throw new Error(`No TAF found for ${icao} — verify the ICAO identifier`);
  return text;
}

// ── TAF init ─────────────────────────────────────────────────

function initTafDecoder() {
  const tafInput   = document.getElementById('taf-input');
  const btnDecodeTaf = document.getElementById('btn-decode-taf');
  const btnExampleTaf = document.getElementById('btn-example-taf');
  const btnFetchTaf   = document.getElementById('btn-fetch-taf');
  const icaoTafInput  = document.getElementById('icao-taf-input');
  const tafError      = document.getElementById('taf-error');

  function showTafError(msg) {
    if (tafError) { tafError.textContent = msg; tafError.hidden = false; }
  }
  function clearTafError() {
    if (tafError) { tafError.textContent = ''; tafError.hidden = true; }
  }
  function hideTafOutput() {
    const el = document.getElementById('taf-output');
    if (el) el.hidden = true;
  }

  if (btnDecodeTaf && tafInput) {
    btnDecodeTaf.addEventListener('click', () => {
      clearTafError();
      hideTafOutput();
      const raw = tafInput.value.trim();
      if (!raw) { showTafError('Paste a TAF to decode.'); return; }
      try {
        const parsed = parseTaf(raw);
        if (!parsed.station || !parsed.issueTime || !parsed.validFrom || !parsed.validTo) {
          showTafError('Could not parse — check that this is a valid TAF.');
          return;
        }
        renderTaf(parsed);
      } catch (e) {
        showTafError('Parse error: ' + e.message);
      }
    });
  }

  if (btnFetchTaf && icaoTafInput) {
    btnFetchTaf.addEventListener('click', async () => {
      clearTafError();
      hideTafOutput();
      const icao = icaoTafInput.value.trim().toUpperCase();
      if (!icao || !/^[A-Z]{3,4}$/.test(icao)) {
        showTafError('Enter a 3- or 4-letter ICAO airport identifier.');
        return;
      }
      btnFetchTaf.textContent = 'Fetching…';
      btnFetchTaf.disabled = true;
      try {
        const raw = await fetchTaf(icao);
        if (tafInput) tafInput.value = raw;
        const parsed = parseTaf(raw);
        renderTaf(parsed);
      } catch (e) {
        if (e.message === 'file-protocol') {
          showTafError('Live lookup is not available when the file is opened directly. Use the "Paste a TAF" tab.');
        } else {
          showTafError(`Could not fetch TAF for ${icao}: ${e.message}.`);
        }
      } finally {
        btnFetchTaf.textContent = 'Fetch TAF';
        btnFetchTaf.disabled = false;
      }
    });

    icaoTafInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnFetchTaf.click(); });
  }

  const TAF_EXAMPLES = [
    'TAF KORD 031730Z 0318/0424 32012KT P6SM BKN040 FM040000 36015G25KT P6SM SCT025 TEMPO 0400/0406 2SM +TSRA BKN008CB FM040600 35008KT 3SM BR OVC006 BECMG 0410/0412 VRB05KT P6SM SKC',
    'TAF KDFW 031730Z 0318/0424 23015KT P6SM SCT025 BKN060 FM040000 27015KT P6SM BKN030 TEMPO 0402/0406 5SM -RA BKN015 BECMG 0408/0410 VRB05KT P6SM SKC',
    'TAF KSFO 031730Z 0318/0424 28010KT P6SM FEW015 PROB30 0322/0402 1SM FG OVC002 FM040200 28008KT P6SM FEW020',
  ];
  let tafExIdx = 0;

  if (btnExampleTaf && tafInput) {
    btnExampleTaf.addEventListener('click', () => {
      tafInput.value = TAF_EXAMPLES[tafExIdx % TAF_EXAMPLES.length];
      tafExIdx++;
      clearTafError();
      hideTafOutput();
    });
  }

  // File-protocol notice for TAF ICAO panel
  if (window.location.protocol === 'file:') {
    const notice = document.getElementById('taf-icao-file-notice');
    if (notice) notice.hidden = false;
    if (btnFetchTaf) { btnFetchTaf.disabled = true; }
    if (icaoTafInput) icaoTafInput.disabled = true;
  }

  // TAF sub-tabs (look up / paste)
  document.querySelectorAll('.taf-subtab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.taf-subtab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.taf-subpanel').forEach(p => p.hidden = true);
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const target = document.getElementById(tab.dataset.panel);
      if (target) target.hidden = false;
      clearTafError();
      hideTafOutput();
    });
  });
}

document.addEventListener('DOMContentLoaded', initTafDecoder);
