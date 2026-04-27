# Roadmap

A rough multi-month build plan. Phases are flexible — we'll adjust as we learn what's working.

## Phase 1 — Foundations (Weeks 1–2)

Goal: get comfortable with HTML/CSS/JS and have a working landing page deployed somewhere a friend can visit.

- [x] Project scaffolded
- [ ] Walk through the index.html together — every line explained
- [ ] Set up GitHub account + push this folder as your first repo
- [ ] Deploy to GitHub Pages so the site has a real URL
- [ ] Add an "About" section and a couple of static pages so you practice editing HTML/CSS

## Phase 2 — Learn section (Weeks 3–5)

Goal: build out the educational content. This is where tutoring experience matters most.

- [x] Outline every ACS weather task element (Private + Instrument)
- [x] Pick the 6–8 concepts students struggle with most
- [x] Build a template page for a single concept: explanation, sidebar TOC, hazard cards, comparison table, Q&A accordion, decision scenario, takeaway
- [x] Build out AIRMETs & SIGMETs as the first complete concept page
- [x] Build the Learn index page listing all concepts (available + coming soon)
- [x] Build SVG diagram patterns for visual concept pages
- [x] Add Stability & Lapse Rates page (parcel-vs-env, lapse rates, conditional instability, ELR worked examples, skew-T overview with LCL/LFC/EL/CAPE, altimeter section with three worked examples and the indicated-vs-true direction trap)
- [ ] Add Fog Formation page
- [ ] Add remaining concepts (thunderstorms, icing, turbulence, fronts)
- [ ] Add cross-links between related concepts

## Phase 3 — METAR/TAF Decoder (Weeks 6–8)

Goal: a working tool that takes a METAR and produces a visual + plain-English breakdown.

- [ ] Learn how to parse METAR strings in JavaScript
- [ ] Build the input + output UI
- [ ] Add the visual layer: wind arrow, cloud layers, visibility ring
- [ ] Pull live METARs from aviationweather.gov by ICAO code
- [ ] Repeat for TAFs (harder — they have time periods)
- [ ] Stretch: pull live AIRMETs/SIGMETs by route from aviationweather.gov

## Phase 4 — Nav Log Helper (Weeks 9–11)

Goal: a guided nav log builder for student pilots planning their first cross-countries.

- [ ] Define the data model: legs, waypoints, altitudes, winds
- [ ] Build the leg-entry form
- [ ] Pull winds aloft from NOAA
- [ ] Compute true course → magnetic course → wind correction angle → ground speed → ETE → fuel burn
- [ ] Print/PDF export so students can bring it on the flight

## Phase 5 — ACS Reference + polish (Week 12+)

- [ ] ACS lookup with cross-links into Learn
- [ ] Mobile responsiveness pass (a lot of this will be used on phones in the FBO)
- [ ] Performance + accessibility audit
- [ ] Soft launch to your tutoring students for feedback

## Stretch goals (post-launch)

- Dedicated **skew-T page** with live sounding data (Tropical Tidbits-style), parcel-path generator from user-entered surface T/Td, and built-in calculators for Lifted Index, K-Index, Showalter Index, Total Totals
- PIREP map (filtered by altitude, severity, time window)
- Density altitude calculator with takeoff/landing performance
- "Should I fly today?" personal-minimums checker
- Hurricane/tropical weather tracker (a Florida-specific feature would be a nice nod to your Daytona time)
- User accounts so students can save nav logs and study progress
