// CrosswindWX — main.js
// Right now this is mostly a placeholder. As we build out the Decoder
// and Nav Log tools, the heavy lifting will live here (or in modules
// imported from here).

console.log('CrosswindWX loaded. Wind 240 at 14, gusting 22.');

// On the homepage, log which METAR tag was clicked. Useful later
// when we wire the same markup to a full decoder explanation panel.
document.querySelectorAll('.metar-raw .tag').forEach((tag) => {
  tag.addEventListener('click', () => {
    console.log('Tag clicked:', tag.textContent.trim(), '→', tag.dataset.tip);
  });
});
