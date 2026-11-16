/**
 * Small local venues read from their own schedules (data/curated/venues.json):
 *  - 'ics': a calendar feed (e.g. WordPress "The Events Calendar" ?ical=1)
 *  - 'squarespace': a Squarespace events page, read as JSON with ?format=json (this month and next)
 * Their events are "Local venue" picks.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as cheerio from 'cheerio';
import { guessCategory, newsletterHide } from '../categories.ts';
import { getJson, getText } from '../lib/http.ts';
import { nyWallClock, parseIcs } from '../lib/ics.ts';
import { clean, decodeEntities, safeUrl, truncate } from '../lib/text.ts';
import { addDays, nyIso, nyToday } from '../lib/time.ts';
import type { Category, CollectResult, Event, RawEvent } from '../schema.ts';

export interface LocalVenue {
  id: string;
  type: 'ics' | 'squarespace';
  url: string;
  venue: Event['venue'];
  category?: Category;
  price?: string;
  skipTitles?: string;
  note?: string;
}

interface SqItem { title: string; startDate: number; endDate?: number; fullUrl?: string; excerpt?: string; body?: string }

function make(v: LocalVenue, f: { title: string; date: string; time: string | null; endTime?: string | null; url: string; text?: string }): RawEvent {
  const category = v.category ?? guessCategory(`${f.title} ${f.text ?? ''}`);
  const hide = newsletterHide(category);
  const price = (f.text?.match(/\$\d+(?:\.\d{2})?(?:\s*(?:suggested|cash|donation|cover|admission|tickets?))*/i)?.[0]) ?? v.price;
  return {
    title: f.title,
    description: truncate([f.text, v.note].filter(Boolean).join(' '), 400),
    start: f.time ? nyIso(f.date, f.time) : f.date,
    ...(f.time && f.endTime && f.endTime > f.time ? { end: nyIso(f.date, f.endTime) } : {}),
    allDay: !f.time,
    venue: v.venue,
    category,
    price: price ? { free: /\bfree\b/i.test(price) && !/\$/.test(price), text: price } : { free: null },
    url: f.url,
    sources: [{ id: 'local', url: f.url }],
    pickedBy: ['local'],
    tags: ['Local venue', v.id],
    ...(hide.length ? { hide } : {}),
  };
}

const textOf = (html?: string) => (html ? clean(cheerio.load(html).text()) : '');

export function parseIcsVenue(v: LocalVenue, ics: string, from: string, to: string): RawEvent[] {
  const skip = v.skipTitles ? new RegExp(v.skipTitles, 'i') : null;
  return parseIcs(ics)
    .filter(e => e.date >= from && e.date <= to && !(skip?.test(e.summary)))
    .map(e => make(v, { title: e.summary, date: e.date, time: e.time, endTime: e.endDate === e.date ? e.endTime : null, url: safeUrl(e.url) ?? v.url, text: textOf(e.description) }));
}

export function parseSquarespaceVenue(v: LocalVenue, items: SqItem[], from: string, to: string): RawEvent[] {
  const origin = new URL(v.url).origin;
  const skip = v.skipTitles ? new RegExp(v.skipTitles, 'i') : null;
  const seen = new Set<string>();
  const out: RawEvent[] = [];
  for (const it of items) {
    if (!it.startDate || !it.title) continue;
    const title = clean(decodeEntities(it.title));
    if (skip?.test(title)) continue;
    const s = nyWallClock(it.startDate);
    if (s.date < from || s.date > to) continue;
    const e = it.endDate ? nyWallClock(it.endDate) : null;
    const key = `${s.date}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(make(v, { title, date: s.date, time: s.time, endTime: e?.date === s.date ? e.time : null, url: safeUrl(it.fullUrl, origin) ?? v.url, text: textOf(it.excerpt || it.body) }));
  }
  return out;
}

export async function collectLocal(root: string, days = 28): Promise<CollectResult> {
  const { venues } = JSON.parse(await readFile(join(root, 'data', 'curated', 'venues.json'), 'utf8')) as { venues: LocalVenue[] };
  const from = nyToday();
  const to = addDays(from, days - 1);
  const events: RawEvent[] = [];
  const notes: string[] = [];
  for (const v of venues) {
    try {
      let got: RawEvent[];
      if (v.type === 'ics') {
        got = parseIcsVenue(v, await getText(v.url, { accept: 'text/calendar' }), from, to);
      } else {
        // This month's page, plus next month's (?month=MM-YYYY), to cover the 4-week window.
        const items: SqItem[] = [];
        for (const d of [from, addDays(from, 31)]) {
          const month = `${d.slice(5, 7)}-${d.slice(0, 4)}`;
          const page = await getJson<{ items?: SqItem[]; upcoming?: SqItem[] }>(`${v.url}?format=json&month=${month}`);
          items.push(...(page.items ?? page.upcoming ?? []));
        }
        got = parseSquarespaceVenue(v, items, from, to);
      }
      events.push(...got);
      notes.push(`${v.id} ${got.length}`);
    } catch (err) {
      notes.push(`${v.id} failed: ${(err as Error).message}`);
    }
  }
  return { source: 'local', events, notes };
}
