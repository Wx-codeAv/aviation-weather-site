// Every page links its CSS and JS with the same ?v= value, so a deploy reaches returning
// visitors as a matched set instead of new scripts running against a cached stylesheet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VERSION_FORMAT = /^\d{4}-\d{2}-\d{2}[a-z]?$/;
const ASSET_LINK = /(?:href|src)=["']([^"']+\.(?:css|js)(?:\?[^"']*)?)["']/g;

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const pages = [path.join(ROOT, 'index.html'), ...htmlFiles(path.join(ROOT, 'pages'))];

// Each local CSS or JS link, as { page, file, version }. External URLs are not ours to version.
const links = pages.flatMap((page) => {
  const html = fs.readFileSync(page, 'utf8');
  return [...html.matchAll(ASSET_LINK)]
    .map((match) => match[1])
    .filter((url) => !/^(https?:)?\/\//.test(url))
    .map((url) => {
      const [file, query] = url.split('?');
      const version = new URLSearchParams(query || '').get('v');
      return { page: path.relative(ROOT, page), file, version };
    });
});

test('every page has CSS and JS links to check', () => {
  for (const page of pages) {
    const name = path.relative(ROOT, page);
    const own = links.filter((link) => link.page === name);
    assert.ok(own.some((link) => link.file.endsWith('main.css')), `${name} has no main.css link`);
    assert.ok(own.some((link) => link.file.endsWith('main.js')), `${name} has no main.js link`);
  }
});

test('every CSS and JS link has a version', () => {
  const missing = links.filter((link) => !link.version);
  assert.deepEqual(missing, []);
});

test('all pages use one version', () => {
  const versions = {};
  for (const link of links) {
    (versions[link.version] ??= []).push(`${link.page}: ${link.file}`);
  }
  assert.equal(Object.keys(versions).length, 1, `more than one version in use: ${JSON.stringify(versions, null, 2)}`);
});

test('the version is a date, with a letter for further changes that day', () => {
  for (const link of links.filter((l) => l.version)) {
    assert.match(link.version, VERSION_FORMAT, `${link.page}: ${link.file}`);
  }
});

test('every versioned link points at a file that exists', () => {
  for (const link of links) {
    const target = path.resolve(ROOT, link.page, '..', link.file);
    assert.ok(fs.existsSync(target), `${link.page} links to a missing file: ${link.file}`);
  }
});
