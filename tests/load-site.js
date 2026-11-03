// Loads the real, unmodified browser scripts into a sandbox so Node can test them.
// Nothing here is deployed logic: the tests exercise the same files the site serves.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

function loadDecoders() {
  const context = {
    console,
    URLSearchParams,
    location: { search: '' },
    window: {},
    document: {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };
  vm.createContext(context);
  for (const file of ['js/metar-decoder.js', 'js/taf-decoder.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  }
  return context;
}

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

module.exports = { loadDecoders, readRepoFile };
