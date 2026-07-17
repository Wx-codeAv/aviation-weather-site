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

## Future project — citation migration off AC 00-6B / AC 00-45H

From the 2026-07 audit fix pass (Batch 2, item 2): FAA's own advisory circular
index now marks both **AC 00-6B** and **AC 00-45H** "(Cancelled)" — both
consolidated into **FAA-H-8083-28 (Aviation Weather Handbook)**. AC 00-45H is
one of the five canonical primary sources in project-principles.md and is
cited extensively across the site (fronts-pressure-systems.html,
wind-shear-mountain-wave.html, winds-aloft-jet-stream.html use AC 00-6B;
weather-charts.html, weather-product-ladder.html, fog-formation.html,
airmets-sigmets.html, icing.html, and more use AC 00-45H).

Decision (2026-07-17): standardize on FAA-H-8083-28 sitewide. Scope for when
this is picked up:

- [ ] Map each old AC section reference to its FAA-H-8083-28 chapter/section
      by hand — no find-replace, since the handbook's numbering doesn't map
      1:1 to the old ACs and a wrong section number is worse than an
      old-but-correct AC citation
- [ ] Update project-principles.md's primary-source list to name
      FAA-H-8083-28 in place of AC 00-6B and AC 00-45H
- [ ] Sweep every page citing AC 00-6B or AC 00-45H (see list above) and
      re-cite against the mapped sections

Also fold in (found during Batch 3 of the same audit fix pass): project-principles.md
states the Private/Instrument/Commercial ACS documents are all "April 2024
versions, effective May 31, 2024." Pulled the actual FAA-S-ACS-6C (Private)
PDF directly — its own cover page and revision history say **November 2023**,
with no April 2024 edition anywhere in that history (the only 2024 dates
belong to the companion *guide*, FAA-G-ACS-2, not the ACS itself). Fixed the
one confirmed instance (navlog.html's footer citation) directly since it was
a single low-risk date swap, but the Instrument and Commercial ACS dates
haven't been checked, and other pages (acs.html especially) may repeat the
same "April 2024" claim project-principles.md asserts.

- [ ] Verify actual publication dates for FAA-S-ACS-7 (Instrument) and
      FAA-S-ACS-8 (Commercial) the same way — pull the real PDFs, don't
      trust project-principles.md's date
- [ ] Update project-principles.md's "April 2024, effective May 31, 2024"
      claim to whatever the verified dates actually are
- [ ] Sweep acs.html and any other page asserting ACS dates for the same
      stale "April 2024" claim

## Stretch goals — long-term, not committed

- Interactive skew-T tool with live sounding data (foundation in tools/ — Python 3.11 + SHARPpy venv)
- Weather Briefing Builder
- "Would You Fly?" scenario randomizer (cross-page)
- DPE-style oral question mode
- Trend comparison features (METAR over time, TAF timeline visualizer)
- Density altitude / crosswind / freezing level calculators
- PIREP trainer
