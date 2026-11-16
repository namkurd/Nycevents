/**
 * npm run pipeline — collect every source, fold in extracted inbox results, dedupe, score,
 * and write dist/index.json plus one file per ISO week for the next 4 weeks.
 * dist/ is gitignored: it holds distances from home and is published only to the private page.
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { aliasesOf, collectFomo, type FomoLocation } from './collectors/fomo.ts';
import { collectNycForFree } from './collectors/nycforfree.ts';
import { collectSkint } from './collectors/skint.ts';
import { dedupe, type VenueIndex } from './dedupe.ts';
import { loadExtracted, writeInbox } from './inbox.ts';
import { eventId, normKey } from './lib/text.ts';
import { addDays, nyToday } from './lib/time.ts';
import { isoWeek, weekRange } from './lib/week.ts';
import { score, isPick } from './rank.ts';
import { Event, HIDE_REASONS, type CollectResult, type RawEvent, type SourceId } from './schema.ts';
import { buildStops, loadStops } from './transit/build-stops.ts';
import { homeConfig, scoreTransit } from './transit/home.ts';

const ROOT = process.cwd();
const DAYS = 28;

interface SourceStatus { ok: boolean; count: number; error?: string; notes?: string[]; lastSuccess?: string }

async function previousIndex(): Promise<{ sources?: Record<string, SourceStatus> } | null> {
  try { return JSON.parse(await readFile(join(ROOT, 'dist', 'index.json'), 'utf8')); } catch { return null; }
}

function venueIndex(locations: Map<number, FomoLocation>, fomoEvents: RawEvent[]): VenueIndex {
  const coords = new Map<string, { lat?: number; lng?: number; borough?: string; address?: string }>();
  for (const e of fomoEvents) if (e.venue.lat != null) coords.set(e.venue.name, e.venue);
  const byName: VenueIndex['byName'] = new Map();
  for (const [alias, canonical] of aliasesOf(locations)) {
    const c = coords.get(canonical);
    if (c?.lat != null) byName.set(normKey(alias), { name: canonical, ...c });
  }
  return { byName };
}

/**
 * Compact week payload (format 2): venues in a shared table, source links only where they
 * differ from the event's own link, short descriptions except for picks, at most 4 tags.
 *   { venues: { v0: Venue }, events: LeanEvent[], ongoing: LeanEvent[] }
 *   LeanEvent = Event minus venue/sources, plus v (venue key), src (source ids), links? ({ id: url })
 */
export function leanWeek(list: Event[]) {
  const venues: Record<string, Event['venue']> = {};
  const vkey = new Map<string, string>();
  const lean = (e: Event) => {
    const k = `${e.venue.name}|${e.venue.lat ?? ''}|${e.venue.lng ?? ''}`;
    if (!vkey.has(k)) { const id = `v${vkey.size}`; vkey.set(k, id); venues[id] = e.venue; }
    const links = Object.fromEntries(e.sources.filter(s => s.url !== e.url).map(s => [s.id, s.url]));
    const { venue: _v, sources, description, tags, pickedBy, allDay, price, score: sc, ...rest } = e;
    const desc = description && !isPick(e) && description.length > 110 ? `${description.slice(0, 109).replace(/\s+\S*$/, '')}…` : description;
    // Defaults are omitted to save space: pickedBy [], allDay false, price unknown, score 0.
    return {
      ...rest,
      v: vkey.get(k)!,
      src: [...new Set(sources.map(s => s.id))],
      ...(pickedBy.length ? { pickedBy } : {}),
      ...(allDay ? { allDay } : {}),
      ...(price.free != null || price.text ? { price } : {}),
      ...(sc ? { score: sc } : {}),
      ...(Object.keys(links).length ? { links } : {}),
      ...(desc ? { description: desc } : {}),
      tags: tags.slice(0, 3),
    };
  };
  const events = list.filter(e => !e.ongoing).map(lean);
  const ongoing = list.filter(e => e.ongoing).map(lean);
  return { venues, events, ongoing };
}

export async function run(): Promise<void> {
  const started = Date.now();
  const today = nyToday();
  const lastDay = addDays(today, DAYS - 1);
  const prev = await previousIndex();
  const status: Record<string, SourceStatus> = {};
  const results: CollectResult[] = [];
  let locations = new Map<number, FomoLocation>();

  const collectors: [SourceId, () => Promise<CollectResult>][] = [
    ['fomo', async () => { const r = await collectFomo(ROOT, DAYS); locations = r.locations; return r; }],
    ['nycforfree', () => collectNycForFree(ROOT, DAYS)],
    ['skint', () => collectSkint(ROOT)],
  ];
  for (const [id, fn] of collectors) {
    try {
      const r = await fn();
      results.push(r);
      status[id] = { ok: true, count: r.events.length, notes: r.notes, lastSuccess: new Date().toISOString() };
    } catch (err) {
      status[id] = { ok: false, count: 0, error: String((err as Error).message ?? err), lastSuccess: prev?.sources?.[id]?.lastSuccess };
    }
    console.log(`${id.padEnd(12)} ${status[id].ok ? `${String(status[id].count).padStart(5)} events` : `FAILED: ${status[id].error}`}${status[id].notes?.length ? `  (${status[id].notes!.join('; ')})` : ''}`);
  }

  const inbox = await writeInbox(ROOT, results);
  const extracted = await loadExtracted(ROOT);
  console.log(`inbox        ${inbox.written} new file(s) for the daily session; ${inbox.cached} already extracted; ${extracted.events.length} extracted events loaded${extracted.errors.length ? `; cache errors: ${extracted.errors.join(' | ')}` : ''}`);

  // fomo first so newsletter mentions merge into it.
  const ordered = [...results].sort((a, b) => (a.source === 'fomo' ? -1 : b.source === 'fomo' ? 1 : 0)).flatMap(r => r.events);
  const fomoEvents = results.find(r => r.source === 'fomo')?.events ?? [];
  const { events: merged, merged: foldCount } = dedupe([...ordered, ...extracted.events], venueIndex(locations, fomoEvents));

  // Transit + score + id + validation.
  const home = homeConfig();
  let stops = home ? await loadStops(ROOT) : null;
  if (home) {
    const fresh = await stat(join(ROOT, 'data', 'curated', 'one-seat-stops.json')).then(s => Date.now() - s.mtimeMs < 30 * 864e5).catch(() => false);
    if (!stops || !fresh) {
      try { stops = await buildStops(ROOT); } catch (err) { console.warn(`transit stops not rebuilt: ${(err as Error).message}`); }
    }
  } else {
    console.warn('NYC_HOME_* not set: skipping transit scoring.');
  }

  const ids = new Set<string>();
  const valid: Event[] = [];
  let invalid = 0;
  for (const e of merged) {
    const geo = home && e.venue.lat != null && e.venue.lng != null ? scoreTransit(e.venue.lat, e.venue.lng, home, stops) : {};
    let id = eventId(e.title, e.start.slice(0, 10), e.venue.name);
    if (ids.has(id)) id = eventId(`${e.title} ${e.url}`, e.start.slice(0, 10), e.venue.name);
    if (ids.has(id)) continue;
    const candidate = { ...e, ...geo, id, score: 0 };
    candidate.score = score(candidate);
    const r = Event.safeParse(candidate);
    if (!r.success) { invalid++; continue; }
    ids.add(id);
    valid.push(r.data);
  }
  valid.sort((a, b) => a.start.localeCompare(b.start) || b.score - a.score);

  // Week files: dated events in their week; ongoing runs listed once per week they overlap.
  // Hidden-by-default events (fitness, brand pop-ups) go in a separate "-hidden" file the page loads on demand.
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  const weeks: { week: string; from: string; to: string; file: string; hiddenFile: string; events: number; ongoing: number; hidden: number; bytes: number }[] = [];
  const weekKeys = [...new Set(Array.from({ length: DAYS }, (_, i) => isoWeek(addDays(today, i))))];
  const generatedAt = new Date().toISOString();
  for (const wk of weekKeys) {
    const [ws, we] = weekRange(wk);
    const inWeek = valid.filter(e => (e.ongoing
      ? e.ongoing.from <= we && e.ongoing.to >= ws
      : isoWeek(e.start.slice(0, 10)) === wk && e.start.slice(0, 10) >= today && e.start.slice(0, 10) <= lastDay));
    const shown = inWeek.filter(e => !e.hide?.length);
    const hidden = inWeek.filter(e => e.hide?.length);
    const file = `events-${wk}.json`;
    const hiddenFile = `events-${wk}-hidden.json`;
    const body = JSON.stringify({ format: 2, week: wk, from: ws, to: we, generatedAt, ...leanWeek(shown) });
    await writeFile(join(ROOT, 'dist', file), body);
    await writeFile(join(ROOT, 'dist', hiddenFile), JSON.stringify({ format: 2, week: wk, from: ws, to: we, generatedAt, ...leanWeek(hidden) }));
    weeks.push({ week: wk, from: ws, to: we, file, hiddenFile, events: shown.filter(e => !e.ongoing).length, ongoing: shown.filter(e => e.ongoing).length, hidden: hidden.length, bytes: Buffer.byteLength(body) });
  }

  const counts = {
    collected: results.reduce((n, r) => n + r.events.length, 0) + extracted.events.length,
    afterDedupe: valid.length,
    mergedDuplicates: foldCount,
    invalidDropped: invalid,
    picks: valid.filter(isPick).length,
    hiddenByDefault: Object.fromEntries(HIDE_REASONS.map(h => [h, valid.filter(e => e.hide?.includes(h)).length])),
    transitTier1: valid.filter(e => e.transit?.tier === 1).length,
    transitTier2: valid.filter(e => e.transit?.tier === 2).length,
  };
  const index = { generatedAt, window: { from: today, to: lastDay }, hiddenByDefault: HIDE_REASONS, sources: status, weeks, counts };
  await writeFile(join(ROOT, 'dist', 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\n${counts.collected} collected -> ${counts.afterDedupe} events (${counts.mergedDuplicates} duplicates merged, ${counts.invalidDropped} invalid dropped)`);
  console.log(`picks ${counts.picks} | hidden by default: fitness ${counts.hiddenByDefault.fitness}, brand pop-ups ${counts.hiddenByDefault['brand-popup']} | transit tier 1 ${counts.transitTier1}, tier 2 ${counts.transitTier2}`);
  for (const w of weeks) console.log(`dist/${w.file}  ${w.events} events + ${w.ongoing} ongoing (+${w.hidden} hidden in ${w.hiddenFile})  ${(w.bytes / 1e6).toFixed(2)} MB`);
  const over = weeks.filter(w => w.bytes > 6e6); // ~1.5 MB gzipped on the wire
  if (over.length) console.warn(`WARNING: over the 6 MB budget: ${over.map(w => w.file).join(', ')}`);
  console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
