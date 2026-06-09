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

// ----- Scroll reveal: gentle fade-and-rise as sections enter the viewport -----
// Progressive enhancement. Content is visible by default in CSS; the pre-hidden
// `.reveal` state only exists inside @media (prefers-reduced-motion: no-preference).
// So if scripts fail OR the user prefers reduced motion, everything stays visible.
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if ('IntersectionObserver' in window && !prefersReducedMotion) {
  // Each group reveals together (staggered) when its first element scrolls in.
  // The bento is one group of one element, so the whole panel settles as a unit.
  const revealGroups = [
    ['#features .section-label', '#features .section-title'],
    ['.features'],
    ['.about .section-label', '.about h2', '.about p'],
  ];

  revealGroups.forEach((selectors) => {
    const els = selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
    if (!els.length) return;
    els.forEach((el) => el.classList.add('reveal'));   // pre-hidden (no-preference only)

    const io = new IntersectionObserver((entries, obs) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      els.forEach((el, i) => {
        el.style.setProperty('--reveal-delay', i * 70 + 'ms');  // gentle line-by-line settle
        el.classList.add('is-visible');
      });
      obs.disconnect();   // reveal once; never re-hide on scroll-up
    }, { rootMargin: '0px 0px -12% 0px' });

    io.observe(els[0]);   // trigger on the group's first element
  });
}

// ----- Theme toggle (light / night-cockpit) -----
// The pre-paint <head> script sets the initial theme; here we wire the button
// and persist the user's explicit choice to localStorage.
const themeToggle = document.querySelector('.theme-toggle');
if (themeToggle) {
  const root = document.documentElement;
  const syncLabel = () => {
    const dark = root.getAttribute('data-theme') === 'dark';
    themeToggle.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  };
  syncLabel();
  themeToggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    if (next === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    try { localStorage.setItem('crosswindwx-theme', next); } catch (e) {}
    syncLabel();
  });
}
