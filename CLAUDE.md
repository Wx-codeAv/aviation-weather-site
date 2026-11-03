# CrosswindWx: standing rules

Static HTML, CSS, and JS on GitHub Pages. No build step. Site standards live in `reference/project-principles.md`, including the tab title format under "Branding standard".

## Process

1. **Fetch first.** Run `git fetch origin` before making any claim about repo state.
2. **Diagnose before fixing.** Do a read-only diagnostic before any fix, and report what it found.
3. **Use feature branches.** Don't work directly on `main`.
4. **Verify before merging.** Run the tests and check the change in a browser. If a check could not be run, say so.
5. **No em dashes in new user-facing text.**
6. **Fail loudly, not silently.** When data is missing or can't be parsed, show that plainly. Never fall back to a value that looks valid. For example, an unknown flight category must not display as VFR.

## Tests

Run `node --test` from the repo root. It needs Node and no install. Tests are in `tests/` and load the same files the site serves.

## Keep in mind

- This repo is public, and the files in it are served on the live site. Don't commit or push anything that shouldn't be public.
- `PROJECT_PLAN.md` is local only. Don't commit it or push it.
