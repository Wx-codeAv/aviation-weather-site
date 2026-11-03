/* ============================================================
   CrosswindWx — taf-decoder.js
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

  // 7 ── Work out each group's category, including what it inherits
  resolveTafGroups(result);

  return result;
}

// ── Time base ────────────────────────────────────────────────
// A TAF has no month, but it can't exceed 30 hours. When the valid period crosses a
// month end, the month length is the longest one that keeps it within that limit.
// Returns null when the period can't be real, so callers must not guess.

function tafTimeBase(parsed) {
  const from = parsed.validFrom, to = parsed.validTo;
  if (!from || !to) return null;
  const rawHours = t => t.day * 24 + t.hour + (t.min || 0) / 60;
  const start = rawHours(from);
  let monthLen = 0;
  if (to.day < from.day) {
    for (let m = 31; m >= 28 && !monthLen; m--) {
      const hours = rawHours(to) + m * 24 - start;
      if (hours > 0 && hours <= 30) monthLen = m;
    }
    if (!monthLen) return null;
  }
  const toHours = t => rawHours(t) + (monthLen && t.day < from.day ? monthLen * 24 : 0) - start;
  const dur = toHours(to);
  if (dur <= 0 || dur > 30) return null;
  const timeAt = h => {
    const total = Math.round((start + h) * 60);
    let day = Math.floor(total / 1440);
    if (monthLen && day > monthLen) day -= monthLen;
    return { day, hour: Math.floor(total / 60) % 24, min: total % 60 };
  };
  return { dur, monthLen, toHours, timeAt };
}

// ── Forecast state ───────────────────────────────────────────
// FM replaces the whole forecast, so it inherits nothing (NWSI 10-813 B2.9.2).
// BECMG, TEMPO, INTER and PROB groups list only what changes, and any element they
// don't restate carries over (AIM 7-1-29, NWSI 10-813 B2.9.3).

function tafStateFromGroup(group) {
  const cavok = !!(group.visibility && group.visibility.cavok);
  return {
    wind: group.wind,
    visibility: group.visibility,
    weather: group.nsw ? [] : group.weather,
    sky: group.sky,
    skyKnown: group.sky.length > 0 || cavok
  };
}

function mergeTafGroup(state, group) {
  const cavok = !!(group.visibility && group.visibility.cavok);
  return {
    wind: group.wind || state.wind,
    visibility: group.visibility || state.visibility,
    weather: (group.nsw || cavok) ? [] : (group.weather.length ? group.weather : state.weather),
    sky: cavok ? [] : (group.sky.length ? group.sky : state.sky),
    skyKnown: group.sky.length > 0 || cavok || state.skyKnown
  };
}

function tafStateIncomplete(state) {
  return visibilityInSM(state.visibility) === null || !state.skyKnown || state.sky.some(skyLayerUnknown);
}

// Null means the forecast doesn't say enough. Never report that as VFR. As with a METAR,
// a known ceiling below 500 ft or visibility below 1 SM settles LIFR on its own.
function tafCategory(state) {
  const floor = knownCategoryFloor(state.sky, state.visibility);
  return !tafStateIncomplete(state) || floor === 'LIFR' ? floor : null;
}

function withCategory(state) {
  return Object.assign({}, state, { category: tafCategory(state) });
}

function tafStateAtHours(parsed, base, T) {
  if (T < 0 || T >= base.dur) return null;
  let current = null, transitions = [], overlays = [];
  for (const g of parsed.groups) {
    if (g.type === 'BASE') {
      current = tafStateFromGroup(g);
    } else if (g.type === 'FM') {
      if (g.validFrom && base.toHours(g.validFrom) <= T) {
        current = tafStateFromGroup(g);
        transitions = [];
        overlays = [];
      }
    } else if (g.validFrom && g.validTo) {
      const s = base.toHours(g.validFrom), e = base.toHours(g.validTo);
      if (g.type === 'BECMG') {
        if (e <= T) current = mergeTafGroup(current, g);
        else if (s <= T) transitions.push(g);
      } else if (s <= T && T < e) {
        overlays.push(g);
      }
    }
  }
  if (!current) return null;
  const change = g => ({ type: g.type, group: g, state: withCategory(mergeTafGroup(current, g)) });
  return {
    prevailing: withCategory(current),
    transitions: transitions.map(change),
    overlays: overlays.map(change)
  };
}

// What the TAF says at a moment: the prevailing forecast, any BECMG still in its window
// (both states apply, since the change happens at an unspecified time inside it), and
// any TEMPO, INTER or PROB overlays, each built from prevailing rather than from each other.
function tafStateAt(parsed, time) {
  const base = tafTimeBase(parsed);
  return base ? tafStateAtHours(parsed, base, base.toHours(time)) : null;
}

// What the readable parts alone say. Unknowns can only make this worse.
function floorNote(state) {
  const floor = knownCategoryFloor(state.sky, state.visibility);
  if (floor === 'LIFR') return ` LIFR is shown because the ${lifrElement(state.sky, state.visibility)} it does state alone sets it.`;
  return floor === 'VFR' ? '' : ` What it does state is already ${floor}.`;
}

// An unreadable token could be anything, so only a certain LIFR survives it.
function categoryWithUnreadable(group, state) {
  if (!group.unreadable) return tafCategory(state);
  return knownCategoryFloor(state.sky, state.visibility) === 'LIFR' ? 'LIFR' : null;
}

function unknownEnding(group, state) {
  return categoryWithUnreadable(group, state) === 'LIFR'
    ? floorNote(state)
    : ` No flight category is shown for it.${floorNote(state)}`;
}

function resolveTafGroups(parsed) {
  parsed.warnings = [];
  const base = tafTimeBase(parsed);
  if (!base) {
    parsed.warnings.push('The valid period is missing or longer than 30 hours, so the timeline and change-group categories can\'t be worked out.');
  }
  const name = g => (GROUP_META[g.type] && GROUP_META[g.type].label) || g.type;

  for (const g of parsed.groups) {
    if (g.type === 'BASE' || g.type === 'FM') {
      const own = tafStateFromGroup(g);
      g.flightCategory = categoryWithUnreadable(g, own);
      if (g.unreadable) {
        parsed.warnings.push(`Couldn't read ${g.unreadable} in the ${name(g)} group.${unknownEnding(g, own)}`);
      } else if (tafStateIncomplete(own)) {
        parsed.warnings.push(`The ${name(g)} group doesn't give a readable visibility and sky.${unknownEnding(g, own)}`);
      }
      if (base && g.type === 'FM') {
        const s = base.toHours(g.validFrom);
        if (s < 0 || s >= base.dur) parsed.warnings.push(`The ${name(g)} group at ${formatTafTime(g.validFrom)} is outside the valid period.`);
      }
      continue;
    }
    if (!base) continue;
    if (!g.validFrom || !g.validTo) {
      parsed.warnings.push(`A ${name(g)} group has no readable valid time, so no flight category is shown for it.`);
      continue;
    }
    const before = tafStateAtHours(parsed, base, base.toHours(g.validFrom));
    if (!before || base.toHours(g.validTo) > base.dur || base.toHours(g.validTo) <= base.toHours(g.validFrom)) {
      parsed.warnings.push(`The ${name(g)} group at ${formatTafTime(g.validFrom)} doesn't fit inside the valid period, so no flight category is shown for it.`);
      continue;
    }
    const merged = mergeTafGroup(before.prevailing, g);
    g.flightCategory = categoryWithUnreadable(g, merged);
    if (g.unreadable) {
      parsed.warnings.push(`Couldn't read ${g.unreadable} in the ${name(g)} group at ${formatTafTime(g.validFrom)}.${unknownEnding(g, merged)}`);
    } else if (tafStateIncomplete(merged)) {
      parsed.warnings.push(`The ${name(g)} group at ${formatTafTime(g.validFrom)} and the forecast before it don't give a readable visibility and sky.${unknownEnding(g, merged)}`);
    }
    const prior = before.prevailing;
    const cavok = !!(g.visibility && g.visibility.cavok);
    g.carriedOver = [
      !g.wind && prior.wind && prior.wind.raw,
      !g.visibility && prior.visibility && prior.visibility.raw,
      ...(!g.nsw && !cavok && !g.weather.length ? prior.weather.map(w => w.raw) : []),
      ...(!cavok && !g.sky.length ? prior.sky.map(l => l.raw) : []),
    ].filter(Boolean).join(' ');
  }
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
    flightCategory: null,   // set by resolveTafGroups, which knows what the group inherits
    carriedOver: '',
    unreadable: null
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
    } else if (tok === 'VV///') {
      group.sky.push({ raw: tok, cover: 'VV', height: null, cb: null });
      i++;
    } else {
      const sm = tok.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/);
      if (!sm) break;
      group.sky.push({ raw: tok, cover: sm[1], height: +sm[2] * 100, cb: sm[3] || null });
      i++;
    }
  }

  // A token shaped like sky or visibility that we couldn't read must not be skipped,
  // or the group would silently inherit the value it was trying to change.
  if (i < tokens.length && /^(FEW|SCT|BKN|OVC|VV)|SM$/.test(tokens[i])) group.unreadable = tokens[i];

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
  if (overviewEl) {
    const warnings = parsed.warnings.map(w => `<p class="decoder-error">${escHtml(w)}</p>`).join('');
    overviewEl.innerHTML = warnings + buildTafOverview(parsed);
  }

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
  const base = tafTimeBase(parsed);
  if (!base) return '';
  const dur = base.dur;
  const off = t => Math.max(0, Math.min(dur, base.toHours(t)));
  const pct = h => (h / dur * 100);

  const CAT = { VFR: '#3a7d44', MVFR: '#1a5ba6', IFR: '#b53d1f', LIFR: '#7b2d8b' };

  // Prevailing band. It can change at each FM, and when each BECMG window ends.
  const changes = [0];
  for (const g of parsed.groups) {
    const at = g.type === 'FM' ? g.validFrom : (g.type === 'BECMG' ? g.validTo : null);
    if (at && base.toHours(at) > 0 && base.toHours(at) < dur) changes.push(base.toHours(at));
  }
  const times = [...new Set(changes)].sort((a, b) => a - b);
  const segments = [];
  for (const t of times) {
    const state = tafStateAtHours(parsed, base, t);
    const cat = state ? state.prevailing.category : null;
    const last = segments[segments.length - 1];
    if (last && last.cat === cat) continue;   // same category, so keep extending that segment
    if (last) last.end = t;
    segments.push({ start: t, end: dur, cat });
  }
  const band = segments.map(seg => {
    const w = pct(seg.end - seg.start);
    if (w <= 0.2) return '';
    const span = `${formatTafTime(base.timeAt(seg.start))} → ${formatTafTime(base.timeAt(seg.end))}`;
    const position = `left:${pct(seg.start).toFixed(2)}%;width:${w.toFixed(2)}%`;
    if (!seg.cat) {
      return `<div class="tl-seg tl-seg--unknown" style="${position}" title="No category ${span}"><span>${w > 12 ? 'No category' : ''}</span></div>`;
    }
    return `<div class="tl-seg" style="${position};background:${CAT[seg.cat]}" title="${seg.cat} ${span}"><span>${w > 6 ? seg.cat : ''}</span></div>`;
  }).join('');

  // Change groups — each on its own row so overlapping spans never collide
  const overlays = parsed.groups
    .filter(g => ['TEMPO', 'BECMG', 'INTER'].includes(g.type) || g.type.startsWith('PROB'))
    .map(g => {
      if (!g.validFrom || !g.validTo) return '';
      const s = off(g.validFrom), e = off(g.validTo);
      const w = pct(e - s);
      if (w <= 0.2) return '';
      const cat = (g.flightCategory || 'unknown').toLowerCase();
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
  const cat  = (group.flightCategory || 'unknown').toLowerCase();
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
  ${group.carriedOver ? `<p class="taf-group-carried">Carried over: ${escHtml(group.carriedOver)}</p>` : ''}
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
    if (l.height === null) return l.raw || l.cover;
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

// Note: airport-code live fetch was removed (see decoder.html comment) —
// aviationweather.gov sends no CORS headers, so it can't succeed from a
// static site at all, hosted or not. Revisit if a host-locked proxy is built.

// ── TAF init ─────────────────────────────────────────────────

function initTafDecoder() {
  const tafInput   = document.getElementById('taf-input');
  const btnDecodeTaf = document.getElementById('btn-decode-taf');
  const btnExampleTaf = document.getElementById('btn-example-taf');
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
      const raw = tafInput.value.trim();
      if (!raw) { showTafError('Paste a TAF to decode.'); return; }
      try {
        const parsed = parseTaf(raw);
        if (!parsed.station) { showTafError('Could not parse — check that this is a valid TAF.'); return; }
        renderTaf(parsed);
      } catch (e) {
        showTafError('Parse error: ' + e.message);
      }
    });
  }

  const TAF_EXAMPLES = [
    // Real TAFs from aviationweather.gov, 2026-11-03. BECMG and PROB40 appear only in the
    // foreign one, because NWS TAFs don't use them (AIM 7-1-29).
    'TAF KDFW 030259Z 0303/0406 17016KT P6SM SCT040 BKN060 FM030400 18015G25KT P6SM VCTS SCT035CB BKN050 TEMPO 0305/0307 26025G40KT 2SM +TSRA BKN025CB FM030800 21012KT P6SM FEW025 SCT120 FM031100 30015G25KT P6SM SCT050',
    'TAF KBNA 022320Z 0300/0406 17010KT P6SM FEW050 BKN250 FM031500 17014G24KT P6SM BKN035 OVC050 FM040100 16004G23KT P6SM BKN025 OVC080 PROB30 0401/0406 -SHRA BKN009',
    'TAF EGKK 022308Z 0300/0406 01008KT 9999 SCT016 TEMPO 0300/0307 BKN014 PROB40 TEMPO 0310/0318 03015G25KT 5000 SHRA BKN012 BECMG 0321/0324 08010KT',
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

}

document.addEventListener('DOMContentLoaded', initTafDecoder);
