/* ============================================================
   CrosswindWx: taf-slider.js
   Steps through a TAF one hour at a time, using tafStateAt's logic.
   Relies on metar-decoder.js and taf-decoder.js being loaded first.
   ============================================================ */

const HOUR_MS = 3600000;
const CATEGORY_ORDER = ['VFR', 'MVFR', 'IFR', 'LIFR'];

// What each kind of possible group means. Same wording as the legend on the page.
function possibleMeaning(type) {
  const prob = type.match(/^PROB(\d)0/);
  const chance = prob ? `${prob[1]}0% chance of these conditions` : '';
  // FAA-H-8083-28 section 27.4.2.10.3: NWS TAFs use only PROB30. U.S. military and international TAFs may use PROB40.
  const note = type.startsWith('PROB40') ? " NWS TAFs don't use PROB40, but U.S. military and international TAFs may." : '';
  if (type.endsWith('TEMPO') && prob) return `${chance}, for less than half of this period, each time lasting less than 1 hour.${note}`;
  if (type === 'TEMPO') return 'Expected for less than half of this period, each time lasting less than 1 hour.';
  return prob ? `${chance} during this period.${note}` : '';
}

// ── Time ─────────────────────────────────────────────────────

function daysInMonthUTC(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// A TAF gives only day and hour, so the month is the one that puts the start nearest to now.
// Null means no month fits, so callers must not show a local time or claim where now falls.
function tafPeriodStart(parsed, base, now) {
  const from = parsed.validFrom;
  let best = null;
  for (let offset = -13; offset <= 13; offset++) {
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const year = first.getUTCFullYear(), month = first.getUTCMonth();
    const days = daysInMonthUTC(year, month);
    if (from.day > days || (base.monthLen && days !== base.monthLen)) continue;
    const start = Date.UTC(year, month, from.day, from.hour);
    if (best === null || Math.abs(start - now.getTime()) < Math.abs(best - now.getTime())) best = start;
  }
  return best === null ? null : new Date(best);
}

// The current hour if now is inside the valid period, otherwise the start of the period.
function tafDefaultStep(parsed, now) {
  const base = tafTimeBase(parsed);
  if (!base) return null;
  const start = tafPeriodStart(parsed, base, now);
  const hours = start ? (now.getTime() - start.getTime()) / HOUR_MS : -1;
  const inside = hours >= 0 && hours < base.dur;
  return { step: inside ? Math.floor(hours) : 0, inside, start };
}

function tafLocalLabel(date, locale, timeZone) {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone,
  }).format(date);
}

// ── What the slider shows at an hour ─────────────────────────

// Lowest category across the possible groups. An unknown one could be anything, so only a
// known LIFR, which nothing can be worse than, settles the answer without it.
function lowestCategory(states) {
  const cats = states.map(s => s.category);
  if (cats.includes('LIFR')) return 'LIFR';
  if (cats.includes(null)) return null;
  return cats.reduce((low, c) => (CATEGORY_ORDER.indexOf(c) > CATEGORY_ORDER.indexOf(low) ? c : low), 'VFR');
}

// FM groups that start between two slider hours, which an hourly slider can't land on.
function tafMidHourChanges(parsed, base) {
  return parsed.groups
    .filter(g => g.type === 'FM' && g.validFrom && g.validFrom.min)
    .map(g => ({ hours: base.toHours(g.validFrom), label: formatTafTime(g.validFrom) }))
    .filter(c => c.hours > 0 && c.hours < base.dur);
}

function tafSliderView(parsed, step, start, locale, timeZone) {
  const base = tafTimeBase(parsed);
  if (!base || step < 0 || step >= base.dur) return null;
  const state = tafStateAtHours(parsed, base, step);
  if (!state) return null;
  const change = o => ({
    type: o.type,
    label: (GROUP_META[o.type] && GROUP_META[o.type].label) || o.type,
    range: buildTimeStr(o.group),
    meaning: possibleMeaning(o.type),
    state: o.state,
  });
  const possible = state.overlays.map(change);
  return {
    timeZ: formatTafTime(base.timeAt(step)),
    timeLocal: start ? tafLocalLabel(new Date(start.getTime() + step * HOUR_MS), locale, timeZone) : null,
    base: state.prevailing,
    becoming: state.transitions.map(change),
    possible,
    possibleLowest: possible.length ? lowestCategory(possible.map(p => p.state)) : null,
    midHour: tafMidHourChanges(parsed, base).filter(c => c.hours > step && c.hours < step + 1),
  };
}

// What a screen reader says as the slider moves. It carries the same facts as the display.
function tafSliderSpoken(view) {
  const cat = c => c || 'no category';
  const baseText = view.becoming.length
    ? `Base forecast before the change ${cat(view.base.category)}. ${view.becoming.map(b => `After the change ${cat(b.state.category)}.`).join(' ')}`
    : `Base forecast ${cat(view.base.category)}.`;
  const possibleText = view.possible.length
    ? `Possible: ${view.possible.map(p => `${p.label} ${cat(p.state.category)}`).join(', ')}.`
    : 'Nothing possible listed.';
  return `${view.timeZ}. ${baseText} ${possibleText}`;
}

// ── HTML ─────────────────────────────────────────────────────

function categoryBadge(category) {
  return category
    ? `<span class="cat-badge cat-${category.toLowerCase()}">${category}</span>`
    : '<span class="cat-badge cat-unknown">No category</span>';
}

function stateChips(state) {
  const cavok = !!(state.visibility && state.visibility.cavok);
  const chip = (kind, text) => `<span class="taf-chip taf-chip-${kind}">${escHtml(text)}</span>`;
  // "Not stated" means the group leaves the element out. If a token we couldn't read may be
  // that element, say it couldn't be read instead.
  const unread = element => (state.unreadableCovers || []).includes(element);
  return [
    state.wind ? chip('wind', buildWindStr(state.wind))
      : chip('wind', windInDoubt(state) ? 'Wind couldn\'t be read' : 'Wind not stated'),
    state.visibility ? chip('vis', buildVisStr(state.visibility))
      : chip('vis', unread('visibility') ? 'Visibility couldn\'t be read' : 'Visibility not stated'),
    state.weather.length ? chip('wx', state.weather.map(w => w.raw).join(' '))
      : (unread('weather') ? chip('wx', 'Weather couldn\'t be read') : ''),
    state.sky.length ? chip('sky', buildSkyStr(state.sky)) : (cavok || state.skyKnown ? '' : chip('sky', unread('sky') ? 'Sky couldn\'t be read' : 'Sky not stated')),
    state.windShear ? chip('ws', buildWsStr(state.windShear)) : '',
  ].join('');
}

function unknownReason(state) {
  if (state.category) return '';
  const reason = state.unreadable
    ? `Part of this couldn't be read (${state.unreadable})`
    : 'The forecast doesn\'t say enough';
  return `<p class="taf-sl-why">${escHtml(reason)}, so no flight category is shown.</p>`;
}

function baseRow(title, state) {
  return `<div class="taf-sl-state">
    <div class="taf-sl-state-head"><span class="taf-sl-state-title">${title}</span>${categoryBadge(state.category)}</div>
    <div class="taf-group-chips">${stateChips(state)}</div>
    ${unknownReason(state)}
  </div>`;
}

function buildBaseLayer(view) {
  const rows = view.becoming.length
    ? baseRow('Before the change', view.base) + view.becoming.map(b => `
      <p class="taf-sl-note">Becoming, ${escHtml(b.range)}: a gradual change at an unspecified time in this period, so either could be in effect.</p>
      ${baseRow('After the change', b.state)}`).join('')
    : baseRow('In effect', view.base);
  return `<section class="taf-sl-layer" aria-label="Base forecast">
    <h3 class="taf-sl-layer-title">Base forecast</h3>${rows}
  </section>`;
}

function buildPossibleLayer(view) {
  const lowest = view.possible.length > 1
    ? `<span class="taf-sl-lowest">Lowest ${categoryBadge(view.possibleLowest)}</span>`
    : '';
  const items = view.possible.map(p => `<div class="taf-sl-state">
      <div class="taf-sl-state-head">
        <span class="taf-type-label taf-type-${p.type.split(' ')[0].toLowerCase()}">${escHtml(p.label)}</span>
        ${categoryBadge(p.state.category)}
      </div>
      <p class="taf-sl-range-text">${escHtml(p.range)}</p>
      <div class="taf-group-chips">${stateChips(p.state)}</div>
      ${unknownReason(p.state)}
      ${p.meaning ? `<p class="taf-sl-note">${escHtml(p.meaning)}</p>` : ''}
    </div>`).join('');
  return `<section class="taf-sl-layer taf-sl-layer--possible" aria-label="Possible conditions">
    <h3 class="taf-sl-layer-title">Possible, on top of the base forecast${lowest}</h3>
    ${items || '<p class="taf-sl-note">No Temporarily or probability group covers this hour.</p>'}
  </section>`;
}

function buildSliderReadout(view) {
  const midHour = view.midHour.map(c =>
    `<p class="taf-sl-midhour">The forecast changes at ${escHtml(c.label)}, partway through this hour. This shows it before the change.</p>`).join('');
  return `${midHour}<div class="taf-sl-layers">${buildBaseLayer(view)}${buildPossibleLayer(view)}</div>`;
}

function buildSliderAxis(parsed, base) {
  const last = base.dur - 1;
  const place = h => `left:calc(var(--taf-thumb) / 2 + (100% - var(--taf-thumb)) * ${(Math.min(h, last) / last).toFixed(4)})`;
  let ticks = '';
  for (let h = 0; h <= last; h += 6) {
    const t = base.timeAt(h);
    ticks += `<span class="taf-sl-tick" style="${place(h)}">${String(t.hour).padStart(2, '0')}Z</span>`;
  }
  const marks = tafMidHourChanges(parsed, base).map(c =>
    `<span class="taf-sl-mark" style="${place(c.hours)}" title="Forecast changes at ${escHtml(c.label)}"></span>`).join('');
  return `<div class="taf-sl-axis" aria-hidden="true">${marks}${ticks}</div>`;
}

// ── Render ───────────────────────────────────────────────────

function renderTafSlider(parsed, now = new Date()) {
  const el = document.getElementById('taf-slider');
  if (!el) return;
  const base = tafTimeBase(parsed);
  const label = '<p class="decoder-section-label">Hour by hour</p>';
  if (!base) {
    el.innerHTML = `${label}<p class="decoder-error">The hour-by-hour view isn't available because the valid period can't be read.</p>`;
    return;
  }
  const { step, inside, start } = tafDefaultStep(parsed, now);
  const outsideNote = inside
    ? ''
    : '<p class="taf-sl-note">The current time is outside this TAF\'s valid period, so this starts at the beginning of the period.</p>';
  const noLocal = start ? '' : ' Local time isn\'t shown because the month can\'t be worked out.';

  el.innerHTML = `${label}
    ${outsideNote}
    <div class="taf-sl-control">
      <div class="taf-sl-time">
        <span class="taf-sl-z" id="taf-sl-z"></span>
        <span class="taf-sl-local" id="taf-sl-local"></span>
      </div>
      <input type="range" class="taf-sl-input" id="taf-sl-input" aria-label="Forecast hour"
        min="0" max="${base.dur - 1}" step="1" value="${step}">
      ${buildSliderAxis(parsed, base)}
    </div>
    <div id="taf-sl-readout" aria-live="off"></div>
    <p class="taf-sl-note">This shows what the TAF says for each hour, not what will happen at that exact time.${noLocal}</p>`;

  const input = document.getElementById('taf-sl-input');
  const update = () => {
    const view = tafSliderView(parsed, Number(input.value), start);
    document.getElementById('taf-sl-z').textContent = view.timeZ;
    document.getElementById('taf-sl-local').textContent = view.timeLocal ? `${view.timeLocal} on your device` : '';
    document.getElementById('taf-sl-readout').innerHTML = buildSliderReadout(view);
    input.setAttribute('aria-valuetext', tafSliderSpoken(view));
  };
  input.addEventListener('input', update);
  update();
}
