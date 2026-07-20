# Roadmap

A rough multi-month build plan. Phases are flexible — we'll adjust as we learn what's working.

## Phase 1 — Foundations (Weeks 1–2)

Goal: get comfortable with HTML/CSS/JS and have a working landing page deployed somewhere a friend can visit.

- [x] Project scaffolded
- [ ] Walk through the index.html together — every line explained
- [ ] Set up GitHub account + push this folder as your first repo
- [ ] Deploy to GitHub Pages so the site has a real URL
- [ ] Add an "About" section and a couple of static pages so you practice editing HTML/CSS

## Phase 2 — Hazard Learn pages

- [x] AIRMETs and SIGMETs
- [x] Stability and Lapse Rates
- [x] Fog Formation
- [x] Thunderstorm Life Cycle
- [x] Aircraft Icing
- [x] Turbulence
- [x] Fronts and Pressure Systems
- [x] Winds Aloft and the Jet Stream
- [x] Density Altitude
- [x] Altimetry

## Phase 3 — Weather Products

- [x] Weather Charts
- [x] METAR Decoder
- [x] TAF Decoder
- [x] Weather Product Ladder
- [x] PIREPs section

## Phase 4 — Decision-making

- [x] Wind, Wind Shear, and Mountain Wave (Learn page)
- [x] Weather Decision-Making (Learn page — the "how to think" page)
- [x] ACS Checkride Mapping (interactive ACS section)

## Phase 5 — Tools

- [x] Personal Minimums Builder
- [x] Crosswind Calculator
- [x] Nav Log Helper (with weather integration — live FB winds aloft fetch, FD text parser, vector interpolation, per-leg apply)

## Content gaps — from the 2026-07 site audit

Honest coverage gaps in the ACS matrix (acs.html) that need real content before the
matrix rows can link anywhere meaningful:

- [ ] Frost — formation, why it must be removed, clean-aircraft concept (currently only a callout in icing.html; ACS K3k)
- [ ] Obstructions to visibility beyond fog — haze, smoke, blowing dust/snow (ACS K3l)
- [ ] K4 — interpreting digital/automated weather displays and their limitations
- [ ] stability-lapse-rates.html has zero inline citations — the audit's FAA-H-8083-28 Ch. 13 fix never landed or was lost. Needs a from-scratch sourcing pass, then the page's Sources line (every other Learn page has one; this is the last one missing it). Scoped from a 2026-07-20 review of Ch. 13 against the page:
  - Most of the page IS coverable: stability types (neutral / absolutely stable / absolutely unstable / conditionally unstable — Handbook uses slightly different naming, e.g. "Conditional Instability") plus CAPE and lifted index are all in Ch. 13. Verify each claim against the chapter and cite it — this is a real mapping job, not an unsourceable page.
  - The Skew-T/Log-P section is NOT in the Handbook and should NOT be force-cited to it. Skew-T analysis is beyond standard FAA pilot-training scope — it's meteorology-track material (e.g. ERAU WX 301). Present that section as established atmospheric science without an FAA cite, same treatment as the mountain-wave and dry-microburst items elsewhere on the site. Optionally note it goes beyond typical pilot training. Keep the section as-is otherwise — it's strong, well-done content and shouldn't be cut just because the Handbook doesn't cover it.

## Stretch goals — long-term, not committed

- Interactive skew-T tool with live sounding data (foundation in tools/ — Python 3.11 + SHARPpy venv)
- Weather Briefing Builder
- "Would You Fly?" scenario randomizer (cross-page)
- DPE-style oral question mode
- Trend comparison features (METAR over time, TAF timeline visualizer)
- Density altitude / crosswind / freezing level calculators
- PIREP trainer
