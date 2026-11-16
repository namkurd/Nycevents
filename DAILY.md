# Refresh runbook

Listings refresh twice a week, Mondays and Thursdays, in two steps.

## 1. GitHub Actions collects (free, no Claude)

`.github/workflows/refresh.yml` runs at 10:40 UTC, which is 5:40am New York in winter and 6:40am in summer. You can also start it by hand from the Actions tab ("Run workflow").

- It runs the tests, installs a headless browser for this job only, then runs `npm run pipeline` with no `NYC_HOME_*` set, so the output has no transit or distance fields.
- It refuses to publish if `homeKm` or `transit` shows up in `dist/`.
- It force-pushes the week files as a single commit to the `data` branch.
- The newsletter inbox (the ~5% of entries the rules can't read) is skipped in this mode.

## 2. A short Claude run publishes (scheduled task "City Docket refresh")

1. Attach `namkurd/Nycevents` with `add_repo`, then clone only the `data` branch: `git clone --depth 1 --branch data <clone url> data`.
2. Read `data/index.json`.
   - If `generatedAt` is more than 20 hours old, the Actions run has not finished or failed. Report that and stop without publishing.
3. Publish with the Artifact tool to `https://claude.ai/artifact/7Gux5vJioAx6CaepNhEP9z`:
   - `file_path`: `app/index.html`. Fetch it from the working branch with `git show origin/claude/loving-lamport-sz2e25:app/index.html > index.html`, or clone that branch too.
   - `files`: `index.json` plus every `file` and `hiddenFile` listed in `index.json`, each mapped to its path under `data/`.
   - Leave out `capabilities` so the stored ones are kept.
4. Report one line: `generatedAt`, the count per source, and any failed source from `index.json`.

## Where home lives

Home coordinates, home routes and their stops live only in the page's private database (`home/config`, writable by the owner only). The page computes transit badges, the "Direct from home" filter and the proximity nudge itself. To change home, update that document (ask Claude to). Never put it in the repo.
