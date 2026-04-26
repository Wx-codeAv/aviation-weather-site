# CrosswindWX

An aviation weather site that translates the dense, cryptic weather products pilots are required to interpret into clear, visual explanations. Built by a CFI-track student and meteorology tutor for the people who sit across the table during ACS oral exams and freeze when asked what a TAF actually says.

## Why this exists

This site has two goals:

1. Help pilots prepare for the weather knowledge and risk-management portions of the FAA ACS / checkride.
2. Make aviation weather easier to understand and more interesting, so pilots actually develop appreciation for meteorology rather than just memorizing definitions.

Most pilots — including ones already certificated — struggle with the weather portions of the ACS. The official products (METARs, TAFs, prog charts, AIRMETs, SIGMETs, area forecasts, icing/turbulence/PIREP data) are not the problem. They're free, accessible, and authoritative. The problem is that they were designed in the 1970s for teletype machines and have never been re-translated for visual learners.

CrosswindWX does that translation, and tries to make the underlying meteorology genuinely interesting along the way.

## Who's building this

Built by a private pilot with an instrument rating, currently working toward commercial, with a minor in meteorology and experience tutoring weather lab at university. End goal: fly for NOAA.

## Planned sections

1. **Learn** — Weather concepts mapped to ACS task elements. Pressure systems, fronts, stability, turbulence sources, icing, fog formation, thunderstorm life cycle. Each concept gets a short explanation, a visual, and "what the examiner wants to hear."
2. **Decoder** — Paste a METAR or TAF, get a plain-English breakdown plus a visual representation (cloud layers at altitude, wind arrows over a runway, visibility cone, etc.).
3. **Nav Log Helper** — Walk students through filling out a VFR/IFR navigation log. Pulls winds aloft, computes ground speed, fuel burn, and ETE per leg. Aimed at the early-XC-planning phase where students drown in the math.
4. **ACS Reference** — Quick lookup of the weather-related ACS tasks for Private, Instrument, and Commercial. What the standard says, what knowledge it requires, and links to the relevant sections of Learn.

## Project structure

```
aviation-weather-site/
├── README.md         ← you are here
├── ROADMAP.md        ← multi-month build plan
├── index.html        ← landing page
├── pages/
│   ├── learn.html
│   ├── decoder.html
│   ├── navlog.html
│   └── acs.html
├── css/
│   └── main.css      ← all styles
├── js/
│   └── main.js       ← interactivity
└── assets/           ← images, icons (empty for now)
```

## Running it locally

The site is plain HTML/CSS/JS — no build step, no frameworks. To view it:

1. Open the project folder.
2. Double-click `index.html`. It opens in your browser. That's it.

For a slightly nicer dev experience, install the **Live Server** extension in VS Code. Right-click `index.html` and pick "Open with Live Server" — the page will auto-reload as you save changes.

## Saving your work between sessions

I (Claude) lose access to these files between conversations. To keep working on this:

- **Easiest:** Download the project zip after each session, keep it on your computer, and upload it back next time.
- **Better (recommended):** Set up a free GitHub account and push this folder as a repo. Then you can `git clone` it anywhere, deploy it free via GitHub Pages, and have a real version history. We'll do this together early in the roadmap.

## Tech stack

- **HTML/CSS/JS** — vanilla, no frameworks. You'll learn the actual web platform before any abstractions.
- **Data sources** — NOAA Aviation Weather Center (aviationweather.gov) provides free APIs for METARs, TAFs, PIREPs, winds aloft, and more. No API keys required for most endpoints.
- **Hosting (eventually)** — GitHub Pages or Netlify, both free.
