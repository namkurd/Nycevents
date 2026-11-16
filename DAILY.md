# Refresh runbook

Listings refresh twice a week, Mondays and Thursdays, in two steps.

## 1. GitHub Actions collects (free, no Claude)

`.github/workflows/refresh.yml` runs at 10:40 UTC, which is 5:40am New York in winter and 6:40am in summer. You can also start it by hand from the Actions tab ("Run workflow").

- It runs the tests, installs a headless browser for this job only, then runs `npm run pipeline` with no `NYC_HOME_*` set, so the output has no transit or distance fields.
- It refuses to publish if `homeKm` or `transit` shows up in `dist/`.
- It force-pushes the week files as a single commit to the `data` branch.
- The newsletter inbox (the ~5% of entries the rules can't read) is skipped in this mode.

## 2. A short Claude run adds the newsletters and publishes (scheduled task "City Docket refresh", 7:10am)

GitHub's servers cannot read the three Substack newsletters (Substack refuses them, and we don't work around that), but the NYC Events cloud environment can.

1. Attach `namkurd/Nycevents` with `add_repo`. Clone the `data` branch into `data/` and the working branch into `app/` (both `--depth 1`).
2. Read `data/index.json`. If `generatedAt` is more than 20 hours old, the Actions run did not produce new data: report that and stop.
3. Run `cd app && npm ci && npm run newsletters -- --data=../data`. This fetches field notes, City Happenings and Reading the City, adds picks to matching events, adds new ones, and rewrites the week files and `index.json` in `data/`.
4. Publish with the Artifact tool to `https://claude.ai/artifact/7Gux5vJioAx6CaepNhEP9z`:
   - `file_path`: `app/app/index.html`
   - `files`: `index.json` plus every `file` and `hiddenFile` listed in `data/index.json`, each mapped to `data/<name>`.
   - Leave out `capabilities` so the stored ones are kept.
5. Report one line: `generatedAt`, the count per source, the newsletter merge result, and any failed source.

The newsletter inbox (entries the rules can't read, about 5%) is not processed in this mode.

## Where home lives

Home coordinates, home routes and their stops live only in the page's private database (`home/config`, writable by the owner only). The page computes transit badges, the "Direct from home" filter and the proximity nudge itself. To change home, update that document (ask Claude to). Never put it in the repo.
