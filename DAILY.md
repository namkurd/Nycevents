# Daily refresh runbook

What the daily scheduled session does, in order. It runs in the **NYC Events** cloud environment.

1. **Get the repo.** If `namkurd/Nycevents` is not already in the session, attach it with `add_repo`, clone it, then check out the working branch.
2. **Install:** `npm ci`.
3. **Collect:** `npm run pipeline`. This takes about 5 minutes: fomo is ~130 files at 1 request per second, and Oh My Rockness loads 14 pages in a headless browser. Note the per-source counts it prints.
4. **Read the inbox.** For each file in `data/inbox/`, read the text and write the events it states to the cache path named in its header (`data/cache/extract/<hash>.json`), in the format documented at the top of `pipeline/inbox.ts`.
   - Fill in only fields the text states. If a block is an ad, a feature or holds no dated event, write `"events": []`.
   - Delete the inbox file after writing its cache file.
5. **Rebuild:** `NYC_USE_CACHE=1 npm run pipeline`. This reuses today's downloads and folds the extracted events in.
6. **Commit** only `data/cache/` (never `dist/`, which holds distances from home): `git add data/cache && git commit -m "Daily refresh <date>"`, then push the working branch.
7. **Publish** the data files to the existing page with the Artifact tool:
   - `url`: https://claude.ai/artifact/7Gux5vJioAx6CaepNhEP9z
   - `file_path`: `app/index.html`
   - `files`: `index.json` plus every `file` and `hiddenFile` listed in `dist/index.json`, each mapped to `dist/<name>`.
   - Map each week file that has dropped out of the window to `null`.
   - Leave out `capabilities` so the stored ones are kept.
8. **Report** one line: counts per source, how many inbox files were extracted, and any source that failed. A failed source is reported as failed, never filled in.

Never: commit home coordinates or `dist/`, defeat a bot check, or invent events.
