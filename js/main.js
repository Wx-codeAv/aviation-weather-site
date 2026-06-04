// CrosswindWX — main.js
// Right now this is mostly a placeholder. As we build out the Decoder
// and Nav Log tools, the heavy lifting will live here (or in modules
// imported from here).

console.log('CrosswindWX loaded. Wind 240 at 14, gusting 22.');

// ----- Mobile nav toggle -----
const navToggle = document.querySelector('.nav-toggle');
const primaryNav = document.getElementById('primary-nav');
if (navToggle && primaryNav) {
  const setNav = (open) => {
    navToggle.setAttribute('aria-expanded', String(open));
    navToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    primaryNav.classList.toggle('is-open', open);
  };
  navToggle.addEventListener('click', () => {
    setNav(navToggle.getAttribute('aria-expanded') !== 'true');
  });
  primaryNav.addEventListener('click', (e) => {        // close after picking a destination
    if (e.target.closest('a')) setNav(false);
  });
  document.addEventListener('keydown', (e) => {        // Esc closes
    if (e.key === 'Escape') setNav(false);
  });
}

// ----- Hero METAR teaser: tap or key to reveal a token's plain-English tip -----
const metarTags = document.querySelectorAll('.metar-raw .tag');
metarTags.forEach((tag) => {
  tag.addEventListener('click', () => {
    const wasOpen = tag.classList.contains('is-revealed');
    metarTags.forEach((t) => t.classList.remove('is-revealed'));
    if (!wasOpen) tag.classList.add('is-revealed');
  });
  tag.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tag.click(); }
  });
});
document.addEventListener('click', (e) => {            // tap elsewhere dismisses
  if (!e.target.closest('.metar-raw .tag')) {
    metarTags.forEach((t) => t.classList.remove('is-revealed'));
  }
});
