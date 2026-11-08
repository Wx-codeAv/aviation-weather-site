/* ============================================================
   CrosswindWx: taf-minimums.js
   The personal minimums check on the hour-by-hour TAF slider.

   For the hour on the slider it checks every condition that could apply: the forecast in effect,
   each Temporarily, Intermittent, or probability group covering the hour, and both the before and
   after states of a Becoming group in its window. Each result says which group it comes from.
   It states facts about the numbers. It supports the pilot's decision and doesn't make it, so
   nothing here says "go", nothing is green, and there is no overall verdict.

   Relies on metar-decoder.js, taf-decoder.js, taf-slider.js, wind-math.js, and minimums-check.js
   being loaded first.
   ============================================================ */

// What the shared checks read. They were written for a decoded METAR, so a forecast state is shown to
// them as the same kind of object. An element that an unreadable token might be is never trusted.
function tafCheckView(state) {
  const covers = state.unreadableCovers || [];
  const hides = el => covers.includes(el);
  return {
    sky: state.sky,
    visibility: state.visibility,
    unreadable: hides('sky') ? [state.unreadable || 'unreadable'] : [],
    visibilityDoubt: hides('visibility'),
    wind: state.wind,
    windVariable: null,
    windUnreadable: state.windUnreadable || null,
    windDoubt: !state.windUnreadable && hides('wind') ? (state.unreadable || 'unreadable') : null,
    gridWind: state.gridWind || null,
  };
}

// The elements a group itself says something about. A Temporarily group that gives only a visibility
// shows only a visibility result. Its ceiling and wind are the ones in effect, and they are already
// shown under the forecast they come from, so nothing is hidden by leaving them out.
function tafStatedElements(group) {
  if (group.type === 'BASE' || group.type === 'FM') return null;
  const covers = group.unreadableCovers || [];
  const cavok = !!(group.visibility && group.visibility.cavok);
  return {
    ceiling: group.sky.length > 0 || cavok || covers.includes('sky'),
    visibility: !!group.visibility || covers.includes('visibility'),
    wind: !!group.wind || !!group.gridWind || !!group.windUnreadable || covers.includes('wind'),
  };
}

function tafSourceName(type) {
  const prob = type.match(/^PROB(\d)0( TEMPO)?$/);
  if (prob) return `${prob[1]}0% probability${prob[2] ? ', temporary' : ''}`;
  return (GROUP_META[type] && GROUP_META[type].label) || type;
}

// Which group the prevailing state comes from, and any Becoming group that has already finished.
function tafPrevailingLabel(parsed, base, T) {
  let source = null, finished = [];
  for (const g of parsed.groups) {
    if (g.type === 'BASE') { source = g; finished = []; }
    else if (g.type === 'FM' && g.validFrom && base.toHours(g.validFrom) <= T) { source = g; finished = []; }
    else if (g.type === 'BECMG' && g.validFrom && g.validTo && base.toHours(g.validTo) <= T) finished.push(g);
  }
  const name = !source || source.type === 'BASE' ? 'Base forecast' : `From ${formatTafTime(source.validFrom)}`;
  return finished.length ? `${name}, after Becoming ${finished.map(buildTimeStr).join(' and ')}` : name;
}

// Groups that no hour's check can include, because their time can't be placed inside the valid
// period. They are listed once, above the hour, so they can't quietly drop out of every hour.
function tafUnplacedGroups(parsed) {
  const base = tafTimeBase(parsed);
  if (!base) return [];
  const out = [];
  for (const g of parsed.groups) {
    if (g.type === 'BASE') continue;
    const name = tafSourceName(g.type);
    if (g.type === 'FM') {
      if (base.toHours(g.validFrom) >= base.dur) out.push(`${name} at ${formatTafTime(g.validFrom)} (starts after the valid period ends)`);
      continue;
    }
    if (!g.validFrom || !g.validTo) { out.push(`${name} (no readable valid time)`); continue; }
    const s = base.toHours(g.validFrom), e = base.toHours(g.validTo);
    if (e <= s) out.push(`${name} ${buildTimeStr(g)} (ends before it starts)`);
    else if (s >= base.dur || e <= 0) out.push(`${name} ${buildTimeStr(g)} (outside the valid period)`);
  }
  return out;
}

const TAF_ELEMENT_NAME = { ceiling: 'ceiling', visibility: 'visibility', wind: 'wind' };

function tafCheckState(state, elements, limits, runway, noRunwayReason) {
  const lines = [];
  for (const el of ['ceiling', 'visibility', 'wind']) {
    if (elements && !elements[el]) continue;
    const one = { ceiling: false, visibility: false, wind: false };
    one[el] = true;
    for (const line of checkAgainstMinimums(tafCheckView(state), limits, runway, noRunwayReason, FORECAST_WORDS, one)) {
      lines.push(Object.assign({ element: el }, line));
    }
  }
  return lines;
}

// Every source that could apply at forecast hour t, each with its own result lines.
function tafSourceBlocks(parsed, base, t, later, limits, runway, noRunwayReason) {
  const at = tafStateAtHours(parsed, base, t);
  if (!at) return null;
  const blocks = [];
  const lead = later ? 'Later this hour: ' : '';
  const add = (label, range, state, group, kind) => {
    blocks.push({
      kind,
      label: lead + label,
      range,
      lines: tafCheckState(state, group ? tafStatedElements(group) : null, limits, runway, noRunwayReason),
    });
  };
  const prevailing = tafPrevailingLabel(parsed, base, t);
  add(at.transitions.length ? `${prevailing}, before the change` : prevailing, '', at.prevailing, null, 'prevailing');
  for (const tr of at.transitions) {
    add(`${tafSourceName(tr.type)}, after the change`, buildTimeStr(tr.group), tr.state, tr.group, 'becoming');
  }
  for (const ov of at.overlays) {
    add(tafSourceName(ov.type), buildTimeStr(ov.group), ov.state, ov.group, 'overlay');
    const plain = blocks[blocks.length - 1];
    // The change may already have happened inside its window, so the group applies on that side too.
    // It is listed again only when that side gives a different result.
    for (const tr of at.transitions) {
      const lines = tafCheckState(withCategory(mergeTafGroup(tr.state, ov.group)), tafStatedElements(ov.group), limits, runway, noRunwayReason);
      if (JSON.stringify(lines) === JSON.stringify(plain.lines)) continue;
      blocks.push({ kind: 'overlay', label: `${lead}${tafSourceName(ov.type)}, if the change has happened`, range: buildTimeStr(ov.group), lines });
    }
  }
  return blocks;
}

// The check for one slider step, which covers the whole hour: a From group that starts part way
// through it adds the forecast that follows it. Null when the hour is outside the valid period.
function tafMinimumsAtHour(parsed, step, limits, runway, noRunwayReason) {
  const base = tafTimeBase(parsed);
  if (!base || step < 0 || step >= base.dur) return null;
  const blocks = tafSourceBlocks(parsed, base, step, false, limits, runway, noRunwayReason);
  if (!blocks) return null;
  for (const c of tafMidHourChanges(parsed, base)) {
    if (c.hours > step && c.hours < step + 1) {
      blocks.push(...(tafSourceBlocks(parsed, base, c.hours, true, limits, runway, noRunwayReason) || []));
    }
  }
  const reasons = [];
  for (const b of blocks) {
    for (const l of b.lines) {
      if (l.status === 'notChecked' && l.incomplete) {
        const text = `${b.label}: ${l.incomplete}`;
        if (!reasons.includes(text)) reasons.push(text);
      }
    }
  }
  const hits = [];
  for (const b of blocks) {
    const names = [...new Set(b.lines.filter(l => l.status === 'exceeds' || l.status === 'at').map(l => TAF_ELEMENT_NAME[l.element]))];
    if (names.length) hits.push({ label: b.label, names, count: b.lines.filter(l => l.status === 'exceeds' || l.status === 'at').length });
  }
  return { timeZ: formatTafTime(base.timeAt(step)), blocks, incomplete: reasons.length ? `${reasons.join('; ')}.` : null, hits };
}

// The line above the sources. It counts what is at or outside a limit and says where it comes from.
// It never has an opposite: nothing says an hour is fine.
function tafMinimumsSummary(result) {
  const total = result.hits.reduce((n, h) => n + h.count, 0);
  if (!total) return null;
  const where = result.hits.map(h => `${h.label} (${h.names.join(', ')})`).join('; ');
  return `${total} result${total === 1 ? ' is' : 's are'} at or outside your limits at this hour: ${where}.`;
}

const TAF_MINIMUMS_NOTE = 'This compares each hour of the forecast with the limits you saved. It supports your decision and doesn\'t make it. A group that changes only some elements shows only those, and the rest come from the forecast it modifies. Not checked here: IFR add-ons, which depend on approach minimums, night VFR, storm distance, and proficiency.';

// ── Page ─────────────────────────────────────────────────────

let tafMinsPanel = null;

function buildTafMinimumsBlocks(result) {
  return result.blocks.map(b => `<section class="mins-source">
      <h4 class="mins-source-title">${escHtml(b.label)}${b.range ? ` <span class="mins-source-range">${escHtml(b.range)}</span>` : ''}</h4>
      ${b.lines.length
        ? `<ul class="mins-lines">${buildMinimumsLines(b.lines)}</ul>`
        : '<p class="mins-source-none">This group states no ceiling, visibility, or wind, so there is nothing new to check.</p>'}
    </section>`).join('');
}

function tafMinimumsDraw() {
  const p = tafMinsPanel;
  if (!p) return;
  const result = tafMinimumsAtHour(p.parsed, p.step, p.limits, p.runway, p.reason);
  const label = document.getElementById('taf-mins-label');
  const blocks = document.getElementById('taf-mins-blocks');
  const incomplete = document.getElementById('taf-mins-incomplete');
  const summary = document.getElementById('taf-mins-summary');
  if (!blocks) return;
  if (!result) {
    label.textContent = 'Your minimums';
    blocks.innerHTML = '<p class="mins-empty">This hour is outside the forecast\'s valid period, so nothing is checked.</p>';
    incomplete.hidden = true;
    summary.hidden = true;
    return;
  }
  label.textContent = `Your minimums at ${result.timeZ}`;
  blocks.innerHTML = buildTafMinimumsBlocks(result);
  incomplete.innerHTML = result.incomplete ? `<strong>Incomplete at this hour:</strong> ${escHtml(result.incomplete)}` : '';
  incomplete.hidden = !result.incomplete;
  const text = tafMinimumsSummary(result);
  summary.textContent = text || '';
  summary.hidden = !text;
}

// Called once for each decoded TAF, before the slider's first update.
function tafMinimumsInit(parsed) {
  const el = document.getElementById('taf-mins');
  tafMinsPanel = null;
  if (!el) return;
  const base = tafTimeBase(parsed);
  if (!base) {
    el.innerHTML = '<p class="decoder-section-label">Your minimums</p><p class="mins-empty">No hourly check, because the valid period can\'t be read.</p>';
    el.hidden = false;
    return;
  }
  let saved;
  try {
    saved = readMinimums(window.localStorage);
  } catch (e) {
    saved = { status: 'unavailable' };
  }
  if (saved.status !== 'ok') {
    el.innerHTML = `<p class="decoder-section-label">Your minimums</p><p class="mins-empty">${minimumsEmptyMessage(saved.status, 'forecast')}</p>`;
    el.hidden = false;
    return;
  }
  const unplaced = tafUnplacedGroups(parsed);
  el.innerHTML = `
    <p class="decoder-section-label" id="taf-mins-label">Your minimums</p>
    <div id="taf-mins-runway-row" class="mins-runway" hidden>
      <label for="taf-mins-runway">Runway at ${escHtml(parsed.station || '')}</label>
      <select id="taf-mins-runway" class="mins-select"><option value="">Choose a runway</option></select>
    </div>
    ${unplaced.length ? `<p class="mins-unplaced"><strong>Not placed in time:</strong> ${escHtml(unplaced.join('; '))}. No hour's check includes these groups, because their time can't be placed inside the valid period.</p>` : ''}
    <p id="taf-mins-incomplete" class="mins-incomplete" hidden></p>
    <p id="taf-mins-summary" class="mins-summary" hidden></p>
    <div id="taf-mins-blocks"></div>
    <p class="mins-note">${escHtml(TAF_MINIMUMS_NOTE)}</p>`;
  el.hidden = false;
  const panel = { parsed, limits: saved.limits, runway: null, reason: 'Loading runway data.', step: 0 };
  tafMinsPanel = panel;

  loadMinimumsAirports().then(data => {
    if (tafMinsPanel !== panel) return;
    const airport = findAirport(data, parsed.station);
    if (!airport) {
      panel.reason = `No runway data for ${parsed.station || 'this station'}, because only US airports with an ICAO ID are included.`;
      tafMinimumsDraw();
      return;
    }
    const ends = airport.r.flat();
    const select = document.getElementById('taf-mins-runway');
    select.innerHTML = '<option value="">Choose a runway</option>'
      + ends.map((end, i) => `<option value="${i}">${escHtml(end[0])}</option>`).join('');
    document.getElementById('taf-mins-runway-row').hidden = false;
    const update = () => {
      const end = select.value === '' ? null : ends[+select.value];
      panel.runway = end ? { id: end[0], t: end[1], variation: airport.v } : null;
      panel.reason = 'No runway selected.';
      tafMinimumsDraw();
    };
    select.addEventListener('change', update);
    update();
  }).catch(() => {
    if (tafMinsPanel !== panel) return;
    panel.reason = 'Runway data couldn\'t load.';
    tafMinimumsDraw();
  });
}

// Called each time the slider moves.
function tafMinimumsUpdate(step) {
  if (!tafMinsPanel) return;
  tafMinsPanel.step = step;
  tafMinimumsDraw();
}
