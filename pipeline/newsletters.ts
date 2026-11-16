/**
 * npm run newsletters -- --data <dir>
 *
 * The short Claude publish run uses this. GitHub Actions cannot read the three Substack
 * newsletters (Substack refuses its servers, and we do not work around that), but the
 * NYC Events cloud environment can. This script fetches them there and merges them into
 * week files already built by Actions (format 2, in <dir>, normally the `data` branch):
 * a mention of an existing event adds a pick; anything new is added as its own event.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { leanWeek, liteBody, LITE_FILE } from './build.ts';
import { collectSubstack } from './collectors/substack.ts';
import { sameEvent } from './dedupe.ts';
import { eventId, normKey } from './lib/text.ts';
import { isoWeek } from './lib/week.ts';
import { isPick, score } from './rank.ts';
import { Event, type CollectResult, type RawEvent, type SourceId } from './schema.ts';
import type { SubstackSource } from './parse/substack.ts';

type Lean = Omit<Event, 'venue' | 'sources' | 'pickedBy' | 'allDay' | 'price' | 'score'> & {
  v: string; src: SourceId[]; links?: Record<string, string>;
  pickedBy?: SourceId[]; allDay?: boolean; price?: Event['price']; score?: number;
};
interface WeekFile { format: 2; week: string; from: string; to: string; generatedAt: string; venues: Record<string, Event['venue']>; events: Lean[]; ongoing: Lean[] }
interface IndexFile {
  generatedAt: string; window: { from: string; to: string };
  sources: Record<string, { ok: boolean; count: number; error?: string; notes?: string[]; lastSuccess?: string }>;
  weeks: { week: string; from: string; to: string; file: string; hiddenFile: string; events: number; ongoing: number; hidden: number; bytes: number }[];
  counts: Record<string, unknown>;
}

/** Lean week entries back to full events. */
export function expandWeek(w: WeekFile): Event[] {
  return [...w.events, ...w.ongoing].map(l => {
    const { v, src, links, ...rest } = l;
    return {
      ...rest,
      venue: w.venues[v] ?? { name: 'See listing' },
      sources: src.map(id => ({ id, url: links?.[id] ?? l.url })),
      pickedBy: l.pickedBy ?? [],
      allDay: l.allDay ?? false,
      price: l.price ?? { free: null },
      score: l.score ?? 0,
    } as Event;
  });
}

/**
 * Merge newsletter events into a pool of events (all weeks, shown and hidden together).
 * Returns how many matched an existing event and how many were added.
 */
export function mergeNewsletterEvents(pool: Map<string, Event>, incoming: RawEvent[], window: { from: string; to: string }): { matched: number; added: number } {
  const byDay = new Map<string, Event[]>();
  const ongoing: Event[] = [];
  for (const e of pool.values()) {
    if (e.ongoing) ongoing.push(e);
    else (byDay.get(e.start.slice(0, 10)) ?? byDay.set(e.start.slice(0, 10), []).get(e.start.slice(0, 10))!).push(e);
  }
  // Venue coordinates by name, borrowed from events that already have them.
  const venues = new Map<string, Event['venue']>();
  for (const e of pool.values()) if (e.venue.lat != null) venues.set(normKey(e.venue.name), e.venue);

  let matched = 0;
  let added = 0;
  for (const n of incoming) {
    const day = n.start.slice(0, 10);
    if (!n.ongoing && (day < window.from || day > window.to)) continue;
    const match = (n.ongoing ? undefined : byDay.get(day)?.find(e => sameEvent(e, n)))
      ?? ongoing.find(e => e.ongoing!.from <= day && e.ongoing!.to >= day && sameEvent(e, n));
    if (match) {
      for (const s of n.sources) if (!match.sources.some(x => x.id === s.id)) match.sources.push(s);
      for (const p of n.pickedBy) if (!match.pickedBy.includes(p)) match.pickedBy.push(p);
      if (match.price.free == null && n.price.free != null) match.price = n.price;
      if (!match.description && n.description) match.description = n.description;
      if (match.hide) { match.hide = match.hide.filter(h => h === 'fitness'); if (!match.hide.length) delete match.hide; }
      match.score = score(match);
      matched++;
      continue;
    }
    const known = venues.get(normKey(n.venue.name));
    const venue = known && n.venue.lat == null ? { ...known, name: known.name } : n.venue;
    const id = eventId(n.title, day, venue.name);
    if (pool.has(id)) continue;
    const ev = { ...n, venue, id, score: 0 } as Event;
    ev.score = score(ev);
    const ok = Event.safeParse(ev);
    if (!ok.success) continue;
    pool.set(id, ok.data);
    (n.ongoing ? ongoing : (byDay.get(day) ?? byDay.set(day, []).get(day)!)).push(ok.data);
    added++;
  }
  return { matched, added };
}

async function main() {
  const dir = process.argv.find(a => a.startsWith('--data='))?.split('=')[1] ?? process.argv[process.argv.indexOf('--data') + 1] ?? 'dist';
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as IndexFile;
  const weeks = new Map<string, { file: string; hiddenFile: string; shown: WeekFile; hidden: WeekFile }>();
  const pool = new Map<string, Event>();
  for (const w of index.weeks) {
    const shown = JSON.parse(await readFile(join(dir, w.file), 'utf8')) as WeekFile;
    const hidden = JSON.parse(await readFile(join(dir, w.hiddenFile), 'utf8')) as WeekFile;
    weeks.set(w.week, { file: w.file, hiddenFile: w.hiddenFile, shown, hidden });
    for (const e of [...expandWeek(shown), ...expandWeek(hidden)]) pool.set(e.id, e);
  }

  const results: CollectResult[] = [];
  for (const s of ['fieldnotes', 'cityhappenings', 'readingthecity'] as SubstackSource[]) {
    try {
      const r = await collectSubstack(process.cwd(), s);
      results.push(r);
      index.sources[s] = { ok: true, count: r.events.length, notes: r.notes, lastSuccess: new Date().toISOString() };
    } catch (err) {
      index.sources[s] = { ok: false, count: 0, error: String((err as Error).message ?? err), lastSuccess: index.sources[s]?.lastSuccess };
    }
    console.log(`${s.padEnd(15)} ${index.sources[s].ok ? `${index.sources[s].count} events` : `FAILED: ${index.sources[s].error}`}`);
  }
  const { matched, added } = mergeNewsletterEvents(pool, results.flatMap(r => r.events), index.window);
  console.log(`merged: ${matched} matched existing events, ${added} added`);

  // Re-split every week into shown and hidden files.
  const all = [...pool.values()].sort((a, b) => a.start.localeCompare(b.start) || b.score - a.score);
  for (const w of index.weeks) {
    const inWeek = all.filter(e => (e.ongoing ? e.ongoing.from <= w.to && e.ongoing.to >= w.from : isoWeek(e.start.slice(0, 10)) === w.week && e.start.slice(0, 10) >= index.window.from && e.start.slice(0, 10) <= index.window.to));
    const shown = inWeek.filter(e => !e.hide?.length);
    const hidden = inWeek.filter(e => e.hide?.length);
    const head = { format: 2 as const, week: w.week, from: w.from, to: w.to, generatedAt: index.generatedAt };
    const body = JSON.stringify({ ...head, ...leanWeek(shown) });
    await writeFile(join(dir, w.file), body);
    await writeFile(join(dir, w.hiddenFile), JSON.stringify({ ...head, ...leanWeek(hidden) }));
    Object.assign(w, { events: shown.filter(e => !e.ongoing).length, ongoing: shown.filter(e => e.ongoing).length, hidden: hidden.length, bytes: Buffer.byteLength(body) });
  }
  await writeFile(join(dir, LITE_FILE), liteBody(all, index.window.from, index.generatedAt));
  (index as IndexFile & { lite?: string }).lite = LITE_FILE;
  index.counts = { ...index.counts, afterDedupe: pool.size, picks: all.filter(isPick).length, newslettersMergedAt: new Date().toISOString() };
  await writeFile(join(dir, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`picks now ${index.counts.picks}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
