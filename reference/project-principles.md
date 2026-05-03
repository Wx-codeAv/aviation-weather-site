# CrosswindWX Project Principles

This document captures the design philosophy and prioritization rules for the project. Future sessions should read this before proposing new features or pages.

## Core philosophy

The site is a checkride preparation tool, not a meteorology textbook. Every page should help a student pilot make a safe go/no-go decision, not just memorize facts.

When in doubt, ask: "Does this help a student make a real go/no-go decision?" If yes, prioritize. If no, defer.

## Restraint is a feature

A focused, well-finished site with 12 pages is dramatically better than a sprawling site with 30 half-built features. We will not chase every feature idea. We will finish what we start before adding new ambitions.

When the project author shares an external brainstorm or feature wishlist, treat it as a source of inspiration, not a roadmap. Cherry-pick the highest-value items. Defer or skip the rest. Push back if a request would expand scope dramatically.

## Standard Learn page format

Every concept page in pages/learn/ should follow the same six-section structure:

1. What it is — plain-English definition
2. Why pilots care — the operational stakes
3. Products that show it — which weather products surface this hazard
4. Red flags — specific signs to watch for
5. Checkride oral questions — 5–8 questions a DPE might ask, in click-to-expand <details class="qa"> elements
6. Would-You-Fly scenario — a decision scenario with 3–4 choices, framed as educational only

Existing pages may not yet match this format perfectly. When working on an existing page, opportunistically improve it toward this structure, but do not rewrite a page wholesale just to enforce the format.

## Source citation rule

For any factual claim — validity periods, criteria, definitions, ACS codes, regulations — cite a primary source. Never cite from memory.

Primary sources:
- AC 00-45H — weather products
- FAA-H-8083-28 — Aviation Weather Handbook
- AIM Chapter 7 — operational
- 14 CFR Part 91 — regulations
- Current ACS documents (Private PA, Instrument IR, Commercial CA — all April 2024 versions, effective May 31, 2024)

If unsure, leave a `[VERIFY]` marker in the file for the project author to check, rather than guessing.

## Aesthetic

- Sectional aeronautical chart inspired
- Cream `#f4ecd6`, navy `#0c2541`, aviation red `#b53d1f`, sage `#5d6f3c`, sun yellow `#d9a521`
- Anton (display), Manrope (body), JetBrains Mono (code)
- All defined as CSS variables in css/main.css
- Inline SVG diagrams for visual content
- No frameworks, no build step, plain HTML/CSS/JS

## Disclaimer pattern

All pages include the footer: "Educational use only · Not for navigation or flight planning · Always consult official FAA/NWS sources."

Decision scenarios are labeled "Educational example only" with explicit framing about teaching the questions a pilot should ask, not making the decision for them.

## Workflow preferences

- Project author drives product/content decisions in plain English
- Claude Code writes the code, narrates at high level, doesn't go line-by-line
- Author does spot-checks, not deep walkthroughs
- Commit often via VS Code Source Control GUI
- Author is a coding beginner — handle implementation while explaining decisions in plain language

## What to push back on

Push back, don't just agree, if a request would:
- Add a new dependency (Python package, JS library, framework)
- Require a backend or server-side processing
- Take more than ~2 sessions to build well
- Add a Learn topic not currently on the prioritized roadmap
- Pull the site away from its current static, no-build architecture

"I think we should defer that — here's why" is a valid response. The author has explicitly asked for honest critique over reflexive agreement.
