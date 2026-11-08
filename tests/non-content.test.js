// Non-content fixes: accessibility, a stray label, a misused term, and an unresolved comment.
// The stale-output fix is in stale-output.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { readRepoFile, loadDecoders } = require('./load-site');
const site = loadDecoders();
for (const f of ['js/wind-math.js', 'js/minimums-check.js']) vm.runInContext(readRepoFile(f), site, { filename: f });

const ROOT = path.join(__dirname, '..');
const pageFiles = [
  'index.html',
  ...fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => f.endsWith('.html')).map((f) => 'pages/' + f),
  ...fs.readdirSync(path.join(ROOT, 'pages/learn')).filter((f) => f.endsWith('.html')).map((f) => 'pages/learn/' + f),
];
const text = (name) => readRepoFile(name).replace(/\r\n/g, '\n');

test('every <label for> points at an element that exists on its page', () => {
  for (const file of pageFiles) {
    const html = text(file);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/<label[^>]*\bfor="([^"]+)"/g)) assert.ok(ids.has(m[1]), `${file}: label for="${m[1]}" has no element`);
  }
});

test('the two Nav Log field elevation labels name their inputs', () => {
  const n = text('pages/navlog.html');
  assert.match(n, /<label for="pf-depelev"[^>]*>Field Elev \(ft\)<\/label>/);
  assert.match(n, /<label for="pf-destelev"[^>]*>Field Elev \(ft\)<\/label>/);
});

test('altimetry: the ACS comment is resolved, with what was checked and no [VERIFY] left', () => {
  const a = text('pages/learn/altimetry.html');
  assert.doesNotMatch(a, /\[VERIFY\]/);
  assert.match(a, /Checked 2026-11-08 against FAA-S-ACS-6C, FAA-S-ACS-8C, and FAA-S-ACS-7B/);
  assert.match(a, /<strong>ACS:<\/strong> PA\.I\.C\.K3a · IR\.I\.B\.K3a · CA\.I\.C\.K3a/);
});

test('fronts page: a high\'s center is not called a col', () => {
  const f = text('pages/learn/fronts-pressure-systems.html');
  assert.doesNotMatch(f, /\(col\)/);
  assert.match(f, /Light and variable near the center; stronger toward edges/);
});

test('every range slider on the minimums page has an accessible name from its visible label', () => {
  const m = text('pages/minimums.html');
  const inputs = [...m.matchAll(/<input type="range"[^>]*>/g)].map((x) => x[0]);
  assert.equal(inputs.length, 12);
  for (const tag of inputs) assert.match(tag, /aria-label="[^"]+"/, tag);
  assert.doesNotMatch(inputs.join('\n'), /—/);
});

test('crosswind: Runway 2 entered as Runway 1 or its reciprocal is shown once, and says so', () => {
  const c = text('pages/crosswind.html');
  assert.match(c, /const rwy2Same = rwy2 !== null && \(rwy2 === rwy1 \|\| rwy2 === rwy1r\);/);
  assert.match(c, /if \(rwy2 !== null && !rwy2Same\) \{/);
  assert.match(c, /const samePair = !!pair2 && pair2 === pair1;/);
  assert.match(c, /if \(pair2 && !samePair\) \{/);
  assert.equal((c.match(/Runway 2 is the same runway, so it is shown once/g) || []).length, 1);
  assert.equal((c.match(/Runway 2 has the same number or its reciprocal, so it is shown once/g) || []).length, 1);
});

test('headings: no page skips a level, and the fixes use a visually hidden h2', () => {
  for (const file of pageFiles) {
    const html = text(file).replace(/<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '');
    let prev = 0;
    for (const m of html.matchAll(/<h([1-6])\b[^>]*>/g)) {
      const level = +m[1];
      assert.ok(!prev || level <= prev + 1, `${file}: h${prev} then h${level}`);
      prev = level;
    }
  }
  assert.match(text('css/main.css'), /\.sr-only \{[^}]*clip: rect\(0, 0, 0, 0\);/);
  assert.equal((text('pages/crosswind.html').match(/<h2 class="sr-only">/g) || []).length, 3);
  assert.equal((text('pages/learn.html').match(/<h2 class="sr-only">/g) || []).length, 1);
});

test('decoder tabs: roles, controls, and labels are in the markup', () => {
  const d = text('pages/decoder.html');
  assert.match(d, /<div class="product-selector" role="tablist" aria-label="Product to decode">/);
  assert.match(d, /id="tab-metar" role="tab" aria-selected="true" aria-controls="metar-section"/);
  assert.match(d, /id="tab-taf" role="tab" aria-selected="false" aria-controls="taf-section" tabindex="-1"/);
  assert.match(d, /id="metar-section" class="product-section" role="tabpanel" aria-labelledby="tab-metar"/);
  assert.match(d, /id="taf-section" class="product-section" role="tabpanel" aria-labelledby="tab-taf" hidden/);
});

test('decoder tabs: aria-selected and tabindex follow the active tab, and arrow keys move between tabs', () => {
  const d = text('pages/decoder.html');
  const script = d.match(/<script>\s*\/\/ Product tab switching[\s\S]*?<\/script>/)[0].replace(/^<script>|<\/script>$/g, '');
  const mk = (id, product, selected) => {
    const attrs = { 'aria-selected': String(selected) };
    const listeners = {};
    return {
      id, dataset: { product }, tabIndex: selected ? 0 : -1, hidden: false, attrs, classes: new Set(selected ? ['active'] : []), focused: false, listeners,
      classList: { toggle(c, on) { on ? this.owner.classes.add(c) : this.owner.classes.delete(c); }, remove() {}, add() {} },
      setAttribute(k, v) { attrs[k] = v; }, addEventListener(t, fn) { listeners[t] = fn; }, focus() { this.focused = true; },
    };
  };
  const tabs = [mk('tab-metar', 'metar', true), mk('tab-taf', 'taf', false)];
  tabs.forEach((t) => { t.classList.owner = t; });
  const panels = { 'metar-section': { hidden: false }, 'taf-section': { hidden: true }, 'decoder-output': { hidden: false }, 'taf-output': { hidden: false } };
  const document = { querySelectorAll: (sel) => (sel === '.product-tab' ? tabs : []), getElementById: (id) => panels[id] };
  vm.runInNewContext(script, { document, String });

  tabs[1].listeners.click();
  assert.equal(tabs[1].attrs['aria-selected'], 'true');
  assert.equal(tabs[0].attrs['aria-selected'], 'false');
  assert.equal(tabs[1].tabIndex, 0);
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(panels['taf-section'].hidden, false);
  assert.equal(panels['metar-section'].hidden, true);
  assert.equal(panels['decoder-output'].hidden, true, 'switching clears the old result');

  let prevented = false;
  tabs[1].listeners.keydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(tabs[0].attrs['aria-selected'], 'true');
  assert.equal(tabs[0].focused, true);
  tabs[0].listeners.keydown({ key: 'End', preventDefault() {} });
  assert.equal(tabs[1].attrs['aria-selected'], 'true');
});

test('crosswind airport mode: every runway pair is reciprocal with matching L/C/R suffixes, so same-pair and different-pair choices are unambiguous', () => {
  const data = JSON.parse(text('assets/data/airports-us.json'));
  const swap = { L: 'R', R: 'L', C: 'C', '': '' };
  for (const [id, a] of Object.entries(data.airports)) {
    const seen = new Set();
    for (const [[p], [q]] of a.r) {
      const [pn, ps] = [parseInt(p, 10), p.replace(/^\d+/, '')];
      const [qn, qs] = [parseInt(q, 10), q.replace(/^\d+/, '')];
      if (!(ps in swap) || !(qs in swap)) continue;   // unusual designators are not asserted here
      assert.equal(((pn + 17) % 36) + 1, qn, `${id} ${p}/${q}`);
      assert.equal(swap[ps], qs, `${id} ${p}/${q}`);
      assert.ok(!seen.has(p) && !seen.has(q), `${id}: ${p} or ${q} listed twice`);
      seen.add(p); seen.add(q);
    }
  }
  const c = text('pages/crosswind.html');
  assert.match(c, /const samePair = !!pair2 && pair2 === pair1;/);   // identity of the chosen pair, never a bare number
});

test('a METAR of just THIS shows no flight category and nothing is passed or failed', () => {
  const p = site.parseMetar('THIS');
  assert.equal(p.flightCategory, null);
  const lines = [...site.checkMetarAgainstMinimums(p, { ceiling: 2500, visibility: 5, crosswind: 10, wind: 15, gusts: 20, gustSpreadOn: false, gustSpread: null }, null, 'x')];
  assert.ok(lines.length > 0);
  assert.ok(lines.every((l) => l.status === 'notChecked'), lines.map((l) => l.status).join());
});
