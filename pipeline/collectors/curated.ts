/**
 * Hand-kept recurring free museum nights (data/curated/free-nights.json). Each rule was read on the
 * museum's own page; the pipeline expands the rules into dated events inside the listing window.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addDays, nyIso, nyToday } from '../lib/time.ts';
import type { CollectResult, Event, RawEvent } from '../schema.ts';

export interface FreeNightRule {
  id: string;
  title: string;
  venue: Event['venue'];
  weekday: number;        // 0 = Sunday … 6 = Saturday
  nth: number | null;     // 1-5 = that occurrence in the month; null = every week
  start: string | null;   // "17:00", or null for museum hours (all day)
  end: string | null;
  rsvp: boolean;
  note: string;
  url: string;
  overrides?: Record<string, { start?: string; end?: string; note?: string; closed?: boolean }>;
  verifiedAt: string;
}

const weekdayOf = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay();
/** 1 for the first such weekday of the month, 2 for the second… */
const nthOf = (d: string) => Math.ceil(Number(d.slice(8, 10)) / 7);

export function expandRules(rules: FreeNightRule[], from: string, to: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    for (const r of rules) {
      if (weekdayOf(d) !== r.weekday || (r.nth != null && nthOf(d) !== r.nth)) continue;
      const o = r.overrides?.[d] ?? {};
      if (o.closed) continue;
      const start = o.start ?? r.start;
      const end = o.end ?? r.end;
      out.push({
        title: r.title,
        description: [o.note, r.note, `Checked on the museum's site ${r.verifiedAt}.`].filter(Boolean).join(' '),
        start: start ? nyIso(d, start) : d,
        ...(start && end ? { end: nyIso(d, end) } : {}),
        allDay: !start,
        venue: r.venue,
        category: 'art',
        price: { free: true, text: 'Free admission' },
        ...(r.rsvp ? { rsvp: { required: true } } : {}),
        url: r.url,
        sources: [{ id: 'curated', url: r.url }],
        pickedBy: ['curated'],
        tags: ['Free museum night', 'Museum'],
      });
    }
  }
  return out;
}

export async function collectCurated(root: string, days = 28): Promise<CollectResult> {
  const file = JSON.parse(await readFile(join(root, 'data', 'curated', 'free-nights.json'), 'utf8')) as { rules: FreeNightRule[] };
  const from = nyToday();
  const events = expandRules(file.rules, from, addDays(from, days - 1));
  return { source: 'curated', events, notes: [`${file.rules.length} free-night rules`] };
}
