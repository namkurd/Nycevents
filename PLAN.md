# NYC Events — execution plan

A private NYC events calendar that two people share on claude.ai. This file is the full build plan. The research behind it (what each source looks like, why fomo.nyc is the backbone) and the same plan live in the owner's shared doc. Read that doc with the Claude Docs tools if you have them. This file is enough on its own.

Work one milestone at a time, and stop at each gate to report to the owner.

## Ground rules

- **Environment:** run in the cloud environment **NYC Events**. Its network allows every source host below. If a host is refused, propose adding it with the environment tools; never work around a block.
- **Repo:** `namkurd/Nycevents` (public). Commit often to your working branch. Open no PR unless the owner asks.
- **Never invent events, times or prices.** Every event must trace to a fetched source URL. A source that fails is reported as failed, never filled in.
- **No Claude API key and no `@anthropic-ai/sdk`.** Newsletters are parsed by rules, with the daily Claude session as the fallback (collector spec 5).
- **Privacy (the repo is public):** the owner's home location and nearby routes come only from environment variables (`NYC_HOME_LAT`, `NYC_HOME_LNG`, `NYC_HOME_ROUTES_T1`, `NYC_HOME_ROUTES_T2`). Never write them into code, tests, commits or docs. `dist/` and `data/curated/one-seat-stops.json` are gitignored because they contain distances from home. They are published only to the private artifact.
- **Ask the owner first** before anything that costs money or touches accounts: creating the scheduled task, sharing the page.

## Tech stack and layout

Node 22 + TypeScript (run with `tsx`), `zod` for schemas, `vitest` for tests, `fast-xml-parser` for RSS/KML, `cheerio` for HTML. Chromium and Playwright are preinstalled: `require('playwright')` works and needs no `playwright install`. If you pin `@playwright/test`, launch with `executablePath: '/opt/pw-browsers/chromium'`.

```text
pipeline/
  schema.ts                # zod Event schema (below)
  collectors/              # one file per source, each exports collect(): RawEvent[]
    fomo.ts  nycforfree.ts  skint.ts  substack.ts  ohmyrockness.ts  thoughtgallery.ts
  parse/                   # rule-based newsletter parsers, one per newsletter
  inbox.ts                 # writes lines the rules miss to data/inbox/ for the Claude session
  transit/build-stops.ts   # MTA GTFS -> stops on the home routes
  normalize.ts  dedupe.ts  rank.ts  build.ts
data/
  raw/<source>/<date>.json        # fetched payloads (gitignored)
  inbox/<source>-<hash>.md        # unparsed newsletter text, waiting for the daily session
  cache/extract/<hash>.json       # events the Claude session extracted (committed)
  curated/free-nights.yaml        # recurring free museum nights (hand-verified)
  curated/one-seat-stops.json     # stops on the home routes (gitignored, built from GTFS)
dist/                             # gitignored; published to the artifact
  index.json                      # generatedAt, per-source status, list of week files
  events-2026-W47.json ...        # one file per ISO week, next 4 weeks
app/index.html                    # the artifact page (single file)
tests/fixtures/                   # real responses saved from each source
```

Scripts: `npm run collect -- --source=fomo`, `npm run pipeline` (all collectors to dist), `npm run stops` (rebuild transit stops), `npm test`, `npm run typecheck`.

- Node's built-in `fetch` only uses the sandbox proxy with `NODE_USE_ENV_PROXY=1`; the npm scripts set it.
- Every response is cached for the day under `data/raw/http/`. While developing, `NYC_USE_CACHE=1 npm run pipeline` rebuilds from that cache in about 30 seconds instead of re-fetching (a full live run takes about 4–5 minutes, mostly fomo's ~130 files at 1 request per second).

**Page constraints (claude.ai artifact):**
- Scripts load only from cdnjs, cdn.jsdelivr.net/npm, unpkg, cdn.tailwindcss.com or code.jquery.com, with exact pinned versions (for example `fullcalendar@6.1.15`).
- The page reads its data by relative `fetch('events-2026-W47.json')`. Those files are published beside the page through the Artifact tool's `files`.
- Before writing the page, load the `artifact-design` and `artifact-capabilities` skills.

## Event data model

Every collector maps into this one shape. Times are local to `America/New_York`, written as ISO strings with offset.

```ts
type Category = 'art' | 'film' | 'music' | 'talks' | 'books' | 'theater-dance' | 'comedy'
  | 'food-drink' | 'outdoors' | 'community' | 'nightlife' | 'kids' | 'fitness' | 'other';

interface Event {
  id: string;                 // sha1(normTitle | startDate | normVenue), first 12 hex
  title: string;
  description?: string;       // <= 400 chars
  start: string;              // '2026-11-20T19:00:00-05:00'; date-only events: '2026-11-20'
  end?: string;
  allDay: boolean;
  ongoing?: { from: string; to: string };   // exhibitions / multi-week runs -> On view strip
  venue: { name: string; address?: string; lat?: number; lng?: number; borough?: string };
  category: Category;
  price: { free: boolean | null; text?: string };   // null = unknown; never guess
  rsvp?: { required: boolean; opensAt?: string };
  url: string;                // best link for the event
  ticketsUrl?: string;
  sources: { id: SourceId; url: string }[];
  pickedBy: SourceId[];       // newsletters / recommended flags that chose it
  tags: string[];
  transit?: { tier: 1 | 2; routes: string[]; walkM: number };  // nearest home-route stop
  homeKm?: number;            // straight-line distance from home
  score: number;              // from rank.ts
}
type SourceId = 'fomo' | 'nycforfree' | 'skint' | 'cityhappenings' | 'readingthecity'
  | 'fieldnotes' | 'ohmyrockness' | 'thoughtgallery' | 'curated';
```

**Hidden by default (owner's decisions, Nov 16):** fitness classes, brand pop-ups and chain cinema showtimes (Regal, AMC, iPic, Cinemark, Showcase, Look, Cinépolis; independent and repertory houses stay visible). Each event carries `hide: ['fitness' | 'brand-popup' | 'chain-cinema']` when it falls in one of these groups. Rules live in `pipeline/categories.ts`: fomo `Fitness`/`Open Practice` types and fitness-tagged classes; fomo `Pop-Up` type and shopping tags; NYC for FREE brand categories (Fashion, Beauty, Food, Drink, Pet, Cars, Technology, Travel, NYFW); titles with pop-up/shop/store/giveaway/sampling or activation wording (experience, takeover, wonderland, grand opening), consumer brand names, or "Brand X Brand" collaborations (brand names are checked on NYC for FREE titles only). A newsletter pick removes the brand-popup flag. The page shows each group behind its own toggle.

**Week files (format 2)**, written by `build.ts`:
- `dist/events-YYYY-Www.json`: shown events. `dist/events-YYYY-Www-hidden.json`: hidden-by-default events, loaded only when a group is toggled on.
- Each is `{ format: 2, week, from, to, generatedAt, venues: { v0: Venue }, events: LeanEvent[], ongoing: LeanEvent[] }`.
- A `LeanEvent` is an `Event` without `venue`/`sources`, plus `v` (venue key), `src` (source ids) and `links` (only source URLs that differ from `url`). Defaults are omitted: `pickedBy` [], `allDay` false, unknown `price`, `score` 0. Non-pick descriptions are cut to about 110 characters; tags to 3.
- Ongoing runs appear in `ongoing` of every week they overlap.
- Budget: under 6 MB raw per shown week file, about 1.5 MB gzipped. The densest week measured 4.7 MB raw, 1.26 MB gzipped, and parsed in 43 ms. `dist/index.json` lists the weeks, per-source status and counts.

**Shared marks (artifact `db`):** one doc per person at `marks/{userId}`, shaped `{ [eventId]: { status: 'interested' | 'going', note?: string, at: number } }`. Rules: everyone reads, and each person writes only their own doc.

```json
{ "db": { "rules": [ { "path": "marks", "read": "view", "write": "owner" },
                     { "path": "marks/{self}", "write": "interact" } ] },
  "user": { "scopes": ["profile"] }, "downloads": true }
```

## Collector specs

Each collector saves its raw payload to `data/raw/`, keeps one real response as a test fixture, and returns events in the schema. The endpoints below were verified on Nov 15, 2026.

**1. fomo.nyc (backbone, plain HTTP)**
- `GET https://fomo.nyc/data/manifest.json` returns `days[]` (dates for day0..dayN) and `remainderChunks[]`. `data/query-manifest.json` lists every valid file (132 on Nov 15).
- For each chunk `X` (`day0`…, `remainder0`…) there are two files: `events.X.json` (an array) and `events.X.desc.json` (id → description). Venues come from `locations.dayN.json`, or one shared `locations.remainder.json`. Organizers come from `organizers.json`.
- Event fields: `id, name, event_type, location, place_id, lat, lng, tags[], occurrences[[startDate, startTime, endDate, endTime]], urls[], organizer_ids[], section` (`"Ongoing"` = exhibition). Times look like `"7pm"`, `"10:30am"` or `""` (all-day).
- Map `event_type` and `tags` to `category` (e.g. Screening→film, Exhibition→art, Concert→music, Club Night→nightlife). If `tags` contains `Free`, set `price.free = true`; otherwise `null`. There is no price field.
- About 3,100 events a day. Keep only occurrences inside the next 28 days. Link back to the event's own URL; this is personal use, and no license was found.

**2. NYC for FREE (plain HTTP + cheerio)**
- `GET https://www.nycforfree.co/events`. Each event is a `div[role=listitem][slug]` with attributes `title, start-date, end-date, start-time, end-time, address, borough, lat, long, category, frequency, recurring-days, description`.
- Inside it, a hidden `div[event-data=occurrences]` holds sessions as `2026-11-07|16:00|19:00,2026-11-16|20:00|23:00`. Use it when present.
- Runs longer than 3 days without sessions → `ongoing`. URL = `https://www.nycforfree.co/events/{slug}`. All are free: `price.free = true`, `pickedBy: ['nycforfree']`.

**3. The Skint (plain HTTP + text rules)**
- `GET https://www.theskint.com/wp-json/wp/v2/posts?per_page=10&after=<ISO 8 days ago>`. `title.rendered` (e.g. `FRI-MON, 11/13-16: SKINT WEEKEND`) gives the date range; `content.rendered` holds the entries.
- Entry lines look like `► sat 11am-5pm: name: venue (area), price. >>`, or, under a day heading, `fri thru sun: name: description. >>`. The link is the `>>` anchor.
- A day + time + `:` regex matched 74 of 78 entry lines in the 6 latest posts (Nov 15 test). Lines that don't match go to the inbox (spec 5). `pickedBy: ['skint']`.

**4. Substacks: City Happenings, Reading the City, field notes (RSS + text rules)**
- `GET https://cityhappenings.substack.com/feed`, `https://readingthecity.substack.com/feed` and `https://fieldnotesnyc.substack.com/feed`. Take items from the last 8 days and use `content:encoded`. Convert the HTML to one line per block element, keeping links.
- **field notes:** day header `Monday, November 9`, then for each event: an emoji, the title, a time line (`6—9pm`, `7pm`), `Venue: address`, the price and a quote. Time lines matched all 26 events in the Nov 9 post.
- **City Happenings:** day header `Monday November 9`, then the title, the venue, `6-9pm at 333 W 23rd St, Chelsea`, and a blurb.
- **Reading the City:** day header `Monday, November 9`, a type label (`LAUNCH`, `SERIES`), the title and blurb, then `$10 …; 7-8pm; Venue, address` on one line.
- One parser per newsletter, each with a fixture test on a saved post. `pickedBy` = the newsletter id.

**5. No API key: match first, Claude session as fallback**
- **Match first.** Before parsing deeply, match each newsletter line to an existing fomo event (same day, title token overlap). A match only needs `pickedBy` added, so most picks never need full parsing.
- **Rules second.** The per-newsletter parsers above handle most of the rest.
- **Claude session last.** Anything that fails a rule or schema validation goes to `data/inbox/<source>-<hash>.md`, with its post URL, date range and raw text. The daily scheduled Claude Code session (M3) reads each inbox file, writes the events to `data/cache/extract/<hash>.json` in the schema, and deletes the inbox file.
- Never fill in a field the text does not state.

**6. Oh My Rockness (headless browser)**
- Open `https://www.ohmyrockness.com/shows` in Playwright, and listen for responses matching `/api/shows.json`. They need a token the page issues; a plain request returns 401.
- Go through pages 1–6 using the site's own pagination links, and collect the JSON.
- Fields: `starts_at, cached_bands[].name, venue{name, full_address, latitude, longitude}, price, age, sold_out, tickets_url, recommended, url`. Title = the band names joined. `recommended` → `pickedBy: ['ohmyrockness']`.

**7. Thought Gallery (headless browser)**
- Plain requests get a Cloudflare 403. Playwright renders `https://thoughtgallery.org/all-categories/` normally: day headings, then time, title, venue and category labels (Free, In Person, Virtual …).
- First task: save the rendered HTML as a fixture and write selectors from it; the DOM structure has not been mapped yet. Drop events tagged only Virtual. Every entry counts as a pick for talks.
- If a Cloudflare challenge page appears instead, skip the source for that run and log it. Do not try to defeat it.

**8. Curated free nights (`data/curated/free-nights.yaml`)**
- Recurring rules (e.g. Whitney Fridays 5–10pm). Verify each rule on the museum's official page before adding it, and store that URL and the check date with the rule.

**9. Transit scoring**
- `pipeline/transit/build-stops.ts` downloads MTA GTFS from `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip` and `https://rrgtfsfeeds.s3.amazonaws.com/gtfs_b.zip` (Brooklyn buses). Both were reachable from the NYC Events environment on Nov 15. It writes `data/curated/one-seat-stops.json` (route → every stop it serves, with lat/lng). Run it monthly; the file is gitignored.
- Home = `NYC_HOME_LAT` / `NYC_HOME_LNG`. Tier 1 routes = comma list in `NYC_HOME_ROUTES_T1`; tier 2 = `NYC_HOME_ROUTES_T2`. Route ids match GTFS `route_id` (Select Bus Service routes end in `+`, e.g. `M15+`). If the variables are missing, skip transit scoring and say so; never hardcode a fallback.
- For each event with lat/lng: nearest stop on a tier-1 route within 400 m → `transit = { tier: 1, routes, walkM }`; otherwise tier 2 within 400 m; otherwise none. Always set `homeKm`.

**NYC boundary:** fomo also lists New Jersey, Nassau and Westchester venues. `inNyc()` in `collectors/fomo.ts` keeps a bounding box, drops everything west of the Hudson (a hand-traced line), the Great Neck peninsula, and Mount Vernon/Pelham.

**Dedupe and rank**
- Same event = same start date + same venue (normalized with fomo's `locations[].aliases`) + title token Jaccard ≥ 0.6, or one title containing the other.
- Merge: venue and geo from fomo; price text and blurb from the newsletter; union `sources` and `pickedBy`.
- `score = 3·|pickedBy| + 1 if free + 1 if transit tier 1 + 0.5 if tier 2 + 0.5 if homeKm < 3`. Proximity is a nudge: one newsletter pick (3) outweighs every transit bonus combined. Picks = `pickedBy` not empty.

## Milestones

Do them in order, and stop at each gate.

### M1 — Data pipeline
- [x] Scaffold (layout above), `package.json` scripts, vitest.
- [x] `schema.ts` with zod, plus a test that rejects a malformed event.
- [x] fomo collector, with fixture tests for one day chunk and one remainder chunk.
- [x] NYC for FREE collector, with a fixture test covering the `occurrences` sessions.
- [x] The Skint collector and parser, the inbox fallback (spec 5), and transit scoring (spec 9), each with a fixture test on saved real data.
- [x] `dedupe.ts`, `rank.ts` and `build.ts` → `dist/index.json` plus 4 week files.
- [x] Re-measure fomo coverage across all 7 days for: The Met, Atlas Obscura, The Kitchen, Little Island, Whitney, Guggenheim, Brooklyn Museum, Morgan, 92NY, Film Forum, BAM, Lincoln Center. Report which have events.
    - Result, Nov 16 (next 4 weeks): Whitney 113, Film Forum 124, Lincoln Center 80, BAM 79, Brooklyn Museum 72, 92NY 31, Guggenheim 24, The Met 17, Morgan 9, Little Island 6. **None:** Atlas Obscura, The Kitchen.

*Gate M1:* `npm test` passes. `npm run pipeline` prints a count per source and writes week files under the 6 MB budget. Show the owner 20 random events with their source links to spot-check.

### M2 — Shared calendar page
- [x] Load the `artifact-design` and `artifact-capabilities` skills, then build `app/index.html`. Use FullCalendar (pinned) with week (default), day, month and list views; month cells show a count plus the top 3.
- [x] On view strip for ongoing items, a Picks/Everything toggle, filters (free, category, borough, time of day, source, "direct from home", search), "picked by" badges and a "direct" badge.
- [x] Event panel with Interested / Going / note, written to `marks/{userId}` in `db`. Show each person's initials via `user.profiles`. Add "Both interested" and "Ours" views.
- [x] Google Calendar link: `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=YYYYMMDDTHHMMSS/YYYYMMDDTHHMMSS&ctz=America/New_York&location=…&details=…`. Add a per-event .ics and an "Export Going" .ics through the `downloads` capability.
    - Done differently: the `downloads` capability does not allow `.ics`. The page offers Google Calendar and Outlook links per event, and "Export Going (.csv)" in Google Calendar's import format. Apple Calendar waits for the M4 live feed.
- [x] Publish with the Artifact tool, mapping `dist/*.json` through `files`. Show "last updated" per source, read from `index.json`.

**Page:** https://claude.ai/artifact/7Gux5vJioAx6CaepNhEP9z (private; share from its Share menu with Contributor access or higher so marks can be saved). Built without FullCalendar: day columns of event cards read better than a time grid at this density, and each day column shows its top items by score with a "more" link into the Day view. Source: `app/index.html`; data files are `dist/*.json`, published beside it.

*Gate M2:* using `ArtifactData`, list `marks` and confirm both people's docs exist after each has starred an event. The owner then shares the page from its Share menu.

### M3 — Full curation and daily refresh
- [x] Substack parsers for all three feeds; Oh My Rockness and Thought Gallery browser collectors.
- [x] Picks ranking switched on with all sources.
- [x] With the owner's OK, create a daily scheduled task (about 5:40am New York) that starts a fresh session in the NYC Events environment with this repo. It runs the pipeline (which fills `data/inbox/`), extracts the inbox files itself (spec 5), re-runs `npm run pipeline`, commits `data/cache/`, and republishes the page's data `files` to the same artifact URL.

- **Refresh (option B, owner's choice, Nov 16):** GitHub Actions (`.github/workflows/refresh.yml`, free on a public repo) collects Mondays and Thursdays at 10:40 UTC and pushes week files to the `data` branch. The scheduled task "City Docket refresh" (`trig_013N5QWJq9sio7nVA4McGD2p`) then runs at 7:10am New York: it fetches the three Substacks from the cloud environment (Substack refuses GitHub's servers; we don't work around that), merges them with `npm run newsletters`, and republishes (see `DAILY.md`). Thought Gallery stays (owner's decision, Nov 16). Transit scoring moved into the page, which reads home from its private db (`home/config`). The newsletter inbox is not read in this mode.
- **NYC for FREE is a background source** (owner's decision, Nov 16): its events are listed but never count as picks.
- Live counts, Nov 16: fomo 42,470 · Oh My Rockness 682 (123 recommended) · Thought Gallery 217 · NYC for FREE 118 · The Skint 95 · field notes 25 · City Happenings 20 · Reading the City 19 → 36,718 events, 600 picks.

**Coverage and balance (owner's request, Nov 16):**
- Free museum nights: `data/curated/free-nights.json`, expanded by `collectors/curated.ts`. Seven rules were verified on museum pages Nov 16: Whitney Fridays 5–10pm and second Sundays; Noguchi first Fridays; Jewish Museum third Thursdays 5–8pm and Saturdays; Japan Society first Fridays 5–7pm; MCNY Wednesdays. MoMA, Brooklyn Museum, Morgan, Frick, MoMI, Asia Society and NY Historical refused automated requests, and the Guggenheim and New Museum pages showed no readable policy, so all of those are left out until checked by hand.
- Repertory specials: fomo already lists the repertory houses (Angelika, BAM, Nitehawk, Film Forum, IFC, Metrograph, Anthology…). `isRepertoryPick` marks older films (a year in the title), 35/70/16mm, Q&As, guests, restorations, retrospectives, anniversaries, double features and tributes. A run counts once; one-night extras count every time.
- Pick weights (`PICK_WEIGHTS`): newsletters and free nights 3, Thought Gallery and repertory 2, Oh My Rockness 1. In Picks view, the lighter picks are capped at 3 per type per day.
- New hidden group `library-program` (library classes, kids'/teen programs, games, services; author talks and readings stay). Sports watch parties are categorised as community.

**Finding events (owner's picks from the UX list, Nov 16):** a For us feed (default view: Tonight, Tomorrow, This weekend, Later this week; ranked with variety, from picks, overdue rhythms that are free or a direct trip, and your marks); time presets; travel-time estimates from home ("≈25 min on the 3"; rough model in `travelOf`); a "Not for us" mark (`s: 'pass'`) that hides an event for both of you and ranks similar ones lower, undoable from Ours; and Day view showing the top 5 per type with "Show all".

**Page legibility (owner's request, Nov 16):** each event type has its own icon and colour token (`--c-<type>`, light and dark). The Day view groups events by type within each time block. Rhythm matches show their date and scroll sideways through the next month.

**Rhythms (owner's request, Nov 16).** The owner's offline sheet of activity types and frequencies lives in the page's shared db at `rhythms/list`: `{ items: { id: { name, group: 'date'|'chill', goalDays, last, cats[], words[], archived } }, log: { key: { rid, date, title, eventId, by } } }`. Status matches the sheet: Greenin under 75% of the goal, Coolin from 75 to 100%, Overdue past it. An event matches a rhythm when its category is in `cats` (if any) and its text contains one of `words` (if any). Ranking nudge on the event's own date: −2 in the first half after logging, −1 until 75%, +1 when Coolin, +2 to +4 when Overdue. Logging happens from the Rhythms view ("We did this today") or from an event's panel ("We did this", for events on or before today); it moves `last` forward and appends to `log`. Edits use db `update` on `items.<id>`, so the two people can change different rhythms without overwriting each other.

*Gate M3:* twice-weekly refreshes for two weeks of fresh data with no manual fixes. Each run reports one status line: counts per source and any failed sources.

### M4 — Extras (in order of the owner's interest)
- [ ] Map view (MapLibre from a CDN, using the lat/lng already in events).
- [ ] `free-nights.yaml` layer, and the Little Island `https://littleisland.org/events/?ical=1` collector.
- [ ] Thursday "weekend for us" digest of both people's marks plus top picks.
- [ ] RSVP-opens reminders.
- [ ] Live Going feed: a secret-URL `.ics` file on a public static host, regenerated each run from `marks`.
- [ ] Nonsense NYC through email forwarding.

## Politeness, testing, done

- At most 1 request per second per host, and each source at most once per daily run. Use a generic user agent such as `nyc-events-personal/0.1`. Cache raw payloads and re-use them while developing.
- Never log in, never use another person's account, never defeat a bot challenge. If a site challenges or blocks, skip it for that run and report it.
- One fixture-based parser test per collector, using real saved responses (never hand-written ones). Schema validation runs on every pipeline run; invalid events are dropped and counted. A smoke test asserts every event has `url`, `start` and `venue.name`.
- **Done (each milestone):** tests pass; the pipeline or page runs end to end on real data; changes are committed; the owner gets a gate report with counts, failures and what to check.
