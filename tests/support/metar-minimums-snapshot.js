// Builds one string describing what the METAR minimums check says for every real METAR in the
// fixture, under several saved-limit sets and runways. Used to prove a refactor leaves METAR output
// byte-identical: the SHA-256 of this string is pinned in tests/idea-c-taf.test.js.
const vm = require('node:vm');
const crypto = require('node:crypto');
const { loadDecoders, readRepoFile } = require('../load-site');

function build() {
  const site = loadDecoders();
  for (const f of ['js/wind-math.js', 'js/minimums-check.js']) vm.runInContext(readRepoFile(f), site, { filename: f });
  const reports = readRepoFile('tests/fixtures/metars-2026-11-03.txt').split(/\r?\n/).filter((l) => /^(METAR|SPECI) /.test(l));
  const limitSets = [
    { ceiling: 1000, visibility: 3, crosswind: 10, wind: 15, gusts: 18, gustSpreadOn: false, gustSpread: null },
    { ceiling: 2500, visibility: 7, crosswind: 5, wind: 10, gusts: 12, gustSpreadOn: true, gustSpread: 5 },
    { ceiling: null, visibility: null, crosswind: null, wind: null, gusts: null, gustSpreadOn: false, gustSpread: null },
  ];
  const runways = [
    [null, 'No runway selected.'],
    [{ id: '16L', t: 180, variation: 14.8 }, undefined],      // east variation
    [{ id: '04L', t: 20, variation: -13.9 }, undefined],      // west variation
    [{ id: '09', t: null, variation: 3 }, undefined],         // no FAA alignment
  ];
  const out = [];
  for (const raw of reports) {
    const parsed = site.parseMetar(raw);
    for (const limits of limitSets) {
      for (const [runway, reason] of runways) {
        const lines = [...site.checkMetarAgainstMinimums(parsed, limits, runway, reason)];
        out.push(JSON.stringify([raw, lines]));
      }
    }
  }
  return out.join('\n');
}

function hash() {
  return crypto.createHash('sha256').update(build()).digest('hex');
}

module.exports = { build, hash };
if (require.main === module) {
  const s = build();
  process.stdout.write(`${s.split('\n').length} cases\n${crypto.createHash('sha256').update(s).digest('hex')}\n`);
}
