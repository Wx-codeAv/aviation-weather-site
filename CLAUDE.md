# CrosswindWx: standing rules

Static HTML, CSS, and JS on GitHub Pages. No build step. Site standards live in `reference/project-principles.md`, including the tab title format under "Branding standard".

## Process

1. **Fetch first.** Run `git fetch origin` before making any claim about repo state.
2. **Diagnose before fixing.** Do a read-only diagnostic before any fix, and report what it found.
3. **Use feature branches.** Don't work directly on `main`.
4. **Verify before merging.** Run the tests and check the change in a browser. If a check could not be run, say so.
5. **No em dashes in new user-facing text.**
6. **Fail loudly, not silently.** When data is missing or can't be parsed, show that plainly. Never fall back to a value that looks valid. For example, an unknown flight category must not display as VFR.
7. **Only stop processes you started, by their PID.** Never kill processes by name (no `pkill python`, `taskkill /IM python.exe`, or similar).
8. **Bump the asset version on any change to a CSS, JS, or data file.** Run `git fetch origin`, then `node scripts/bump-assets.js`. It sets one `?v=` value on every CSS, JS, and data link (the date of the change, plus a letter if that date is already deployed, like `2026-11-04b`) and updates each file's hash in `tests/asset-manifest.json`. Commit the manifest with the change. `node --test` fails if any hash changed but the version didn't.

## Project plan

The plan lives in the private repo `Wx-codeAv/crosswindwx-plan`, in `PROJECT_PLAN.md`. The local copy is at `../crosswindwx-plan`. **Read it at the start of each session.** If that folder is missing, clone the repo. Never copy the plan into this repo.

## Tests

Run `node --test` from the repo root. It needs Node and no install. Tests are in `tests/` and load the same files the site serves.

## Keep in mind

- This repo is public, and the files in it are served on the live site. Don't commit or push anything that shouldn't be public.
- Excluded from the live site by `_config.yml`, but still public on GitHub: this file, `README.md`, `ROADMAP.md`, `reference/`, `scripts/`, and `tests/`.
