// Every page links its CSS, JS, and data with the same ?v= value, so a deploy reaches returning
// visitors as a matched set. The manifest records each file's hash at that version, which is
// how these tests notice a file that changed without a bump.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  MANIFEST, ROOT, assetFiles, currentHashes, fromGit, nextVersion, sitePages, toRepoPath, versionProblem,
} = require('../scripts/bump-assets');

const FIX = 'Run `git fetch origin`, then `node scripts/bump-assets.js`.';
const VERSION_FORMAT = /^\d{4}-\d{2}-\d{2}[a-z]?$/;
const ASSET_LINK = /(?:href|src)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/g;
const DATA_LINK = /assets\/data\/[\w-]+\.json(?:\?[^'"`]*)?/g;

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, MANIFEST), 'utf8'));
const pages = sitePages();

const versionOf = (url) => new URLSearchParams(url.split('?')[1] || '').get('v');

// Each local CSS or JS link, as { page, file, version }. External URLs are not ours to version.
const links = pages.flatMap((page) => {
  const html = fs.readFileSync(page, 'utf8');
  return [...html.matchAll(ASSET_LINK)]
    .map((match) => match[1])
    .filter((url) => !/^(https?:)?\/\//.test(url))
    .map((url) => ({ page: toRepoPath(page), file: url.split('?')[0], version: versionOf(url) }));
});

// Each reference to a data file, from a page or a script.
const dataLinks = [...pages, ...fs.readdirSync(path.join(ROOT, 'js')).map((name) => path.join(ROOT, 'js', name))]
  .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(DATA_LINK)]
    .map((match) => ({ page: toRepoPath(file), file: match[0].split('?')[0], version: versionOf(match[0]) })));

test('every page has CSS and JS links to check', () => {
  for (const page of pages) {
    const name = toRepoPath(page);
    const own = links.filter((link) => link.page === name);
    assert.ok(own.some((link) => link.file.endsWith('main.css')), `${name} has no main.css link`);
    assert.ok(own.some((link) => link.file.endsWith('main.js')), `${name} has no main.js link`);
  }
});

test('data files are found and checked', () => {
  assert.ok(dataLinks.length >= 2, 'expected the crosswind page and the minimums check to fetch airport data');
  assert.ok(assetFiles().includes('assets/data/airports-us.json'));
});

test('every CSS, JS, and data link has a version', () => {
  const missing = [...links, ...dataLinks].filter((link) => !link.version);
  assert.deepEqual(missing, [], FIX);
});

test('all pages use one version, the one in the manifest', () => {
  const stray = [...links, ...dataLinks].filter((link) => link.version !== manifest.version);
  assert.deepEqual(stray, [], `The manifest says ${manifest.version}. ${FIX}`);
});

test('the version is a date, with a letter for further changes that day', () => {
  assert.match(manifest.version, VERSION_FORMAT);
});

test('every versioned link points at a file that exists', () => {
  for (const link of links) {
    const target = path.resolve(ROOT, link.page, '..', link.file);
    assert.ok(fs.existsSync(target), `${link.page} links to a missing file: ${link.file}`);
  }
  for (const link of dataLinks) {
    assert.ok(fs.existsSync(path.join(ROOT, link.file)), `${link.page} links to a missing file: ${link.file}`);
  }
});

test('no CSS, JS, or data file has changed since the manifest was written', () => {
  assert.deepEqual(currentHashes(), manifest.files, `A file changed without a bump. ${FIX}`);
});

// The manifest could be edited by hand, so also compare it with what is deployed.
test('a file that differs from origin/main comes with a new version', (t) => {
  const ref = process.env.ASSET_BASELINE_REF || 'origin/main';
  let deployed;
  try {
    deployed = JSON.parse(fromGit(ref, MANIFEST));
  } catch {
    t.skip(`${ref} has no manifest to compare with`);
    return;
  }
  assert.equal(versionProblem(deployed, manifest), null, FIX);
});

test('the comparison notices a changed, added, or removed file', () => {
  const was = { version: '2026-11-04', files: { 'css/main.css': 'aaa', 'js/main.js': 'bbb' } };
  const same = (files) => versionProblem(was, { version: '2026-11-04', files });
  assert.match(same({ 'css/main.css': 'ccc', 'js/main.js': 'bbb' }), /css\/main\.css/);
  assert.match(same({ 'css/main.css': 'aaa', 'js/main.js': 'bbb', 'js/new.js': 'ddd' }), /js\/new\.js/);
  assert.match(same({ 'css/main.css': 'aaa' }), /js\/main\.js/);
  assert.equal(same({ 'css/main.css': 'aaa', 'js/main.js': 'bbb' }), null, 'nothing changed');
  assert.equal(versionProblem(was, { version: '2026-11-04b', files: { 'css/main.css': 'ccc', 'js/main.js': 'bbb' } }), null, 'bumped');
});

for (const [deployed, today, expected] of [
  ['2026-11-03', '2026-11-04', '2026-11-04'],
  ['2026-11-04', '2026-11-04', '2026-11-04b'],
  ['2026-11-04b', '2026-11-04', '2026-11-04c'],
  ['2026-11-04y', '2026-11-04', '2026-11-04z'],
  ['2026-11-04c', '2026-11-05', '2026-11-05'],
]) {
  test(`after ${deployed} on ${today}, the next version is ${expected}`, () => {
    assert.equal(nextVersion(deployed, today), expected);
  });
}

test('running out of letters stops instead of reusing a version', () => {
  assert.throws(() => nextVersion('2026-11-04z', '2026-11-04'), /No letters left/);
});
