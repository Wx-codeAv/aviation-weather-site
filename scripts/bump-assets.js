// Run after any change to a CSS, JS, or data file: node scripts/bump-assets.js
//
// Sets one new ?v= value on every CSS, JS, and data link, then records it with each file's
// hash in tests/asset-manifest.json. The new version is compared with what is on origin/main,
// so run `git fetch origin` first. Running it again on the same branch gives the same version.
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MANIFEST = 'tests/asset-manifest.json';
const ASSET_DIRS = [['css', '.css'], ['js', '.js'], ['assets/data', '.json']];

// The two kinds of link, each with any version it already has.
const PAGE_LINK = /((?:href|src)=")((?:\.\.\/)*(?:css|js)\/[\w-]+\.(?:css|js))(?:\?v=[^"]*)?(")/g;
const DATA_LINK = /(assets\/data\/[\w-]+\.json)(?:\?v=[^'"`]*)?/g;

const toRepoPath = (file) => path.relative(ROOT, file).split(path.sep).join('/');

function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith('.html') ? [full] : [];
  });
}

const sitePages = () => [path.join(ROOT, 'index.html'), ...htmlFiles(path.join(ROOT, 'pages'))];

function assetFiles() {
  return ASSET_DIRS.flatMap(([dir, ext]) => fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith(ext))
    .map((name) => `${dir}/${name}`));
}

// Git may store a file with different line endings than this machine, so hash it with one kind.
function hashFile(repoPath) {
  const text = fs.readFileSync(path.join(ROOT, repoPath), 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

const currentHashes = () => Object.fromEntries(assetFiles().map((file) => [file, hashFile(file)]));

function fromGit(ref, repoPath) {
  return execFileSync('git', ['show', `${ref}:${repoPath}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function nextVersion(deployed, today) {
  if (!deployed || !deployed.startsWith(today)) return today;
  const letter = deployed.slice(today.length);
  if (!letter) return `${today}b`;
  if (letter === 'z') throw new Error(`No letters left after ${deployed}.`);
  return today + String.fromCharCode(letter.charCodeAt(0) + 1);
}

// What's wrong with a manifest compared with the deployed one, or null if nothing is.
function versionProblem(deployed, current) {
  const files = new Set([...Object.keys(deployed.files), ...Object.keys(current.files)]);
  const changed = [...files].filter((file) => deployed.files[file] !== current.files[file]);
  if (!changed.length || deployed.version !== current.version) return null;
  return `Still on version ${current.version}, but these changed: ${changed.join(', ')}`;
}

function localDate(now) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function bump(now = new Date()) {
  const deployedPage = fromGit('origin/main', 'index.html');
  const match = deployedPage.match(/css\/main\.css\?v=([^"]+)"/);
  if (!match) throw new Error('Could not read the version on origin/main.');
  const version = nextVersion(match[1], localDate(now));

  for (const page of sitePages()) {
    const raw = fs.readFileSync(page, 'utf8');
    const out = raw
      .replace(PAGE_LINK, (m, open, url, close) => `${open}${url}?v=${version}${close}`)
      .replace(DATA_LINK, (m, url) => `${url}?v=${version}`);
    if (out !== raw) fs.writeFileSync(page, out);
  }
  for (const file of assetFiles().filter((name) => name.startsWith('js/'))) {
    const full = path.join(ROOT, file);
    const raw = fs.readFileSync(full, 'utf8');
    const out = raw.replace(DATA_LINK, (m, url) => `${url}?v=${version}`);
    if (out !== raw) fs.writeFileSync(full, out);
  }

  const manifest = { version, files: currentHashes() };
  fs.writeFileSync(path.join(ROOT, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const { version, files } = bump();
  console.log(`Version ${version}, with ${Object.keys(files).length} files in ${MANIFEST}.`);
}

module.exports = { MANIFEST, ROOT, assetFiles, currentHashes, fromGit, nextVersion, sitePages, toRepoPath, versionProblem };
