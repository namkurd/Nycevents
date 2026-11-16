/**
 * NYC for FREE — Webflow site. Each event card wrapper carries structured attributes:
 * title, start-date, end-date, start-time, end-time, address, borough, lat, long, category,
 * frequency (One-time | Multiple Dates | Recurrent), recurring-days ("Sun,Sat"), slug, description.
 * A hidden child div[event-data=occurrences] lists sessions as "2026-11-07|16:00|19:00,...".
 */
import * as cheerio from 'cheerio';
import { nffCategory } from '../categories.ts';
import { getText, saveRaw } from '../lib/http.ts';
import { clean, truncate } from '../lib/text.ts';
import { addDays, daysBetween, nyIso, nyToday, parseClock } from '../lib/time.ts';
import type { CollectResult, RawEvent } from '../schema.ts';

const PAGE = 'https://www.nycforfree.co/events';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoFromLong(s: string | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(`${s} 12:00 UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function parseNycForFree(html: string, from: string, to: string): { events: RawEvent[]; skipped: number } {
  const $ = cheerio.load(html);
  const events: RawEvent[] = [];
  let skipped = 0;

  $('[role="listitem"][slug]').each((_, el) => {
    const a = (k: string) => clean($(el).attr(k) ?? '');
    const slug = a('slug');
    const title = a('title');
    const startDate = isoFromLong(a('start-date'));
    const endDate = isoFromLong(a('end-date')) ?? startDate;
    if (!slug || !title || !startDate || !endDate) { skipped++; return; }

    const url = `https://www.nycforfree.co/events/${slug}`;
    const lat = Number(a('lat'));
    const lng = Number(a('long'));
    const { category, hide } = nffCategory(a('category'), title);
    const startT = parseClock(a('start-time'));
    const endT = parseClock(a('end-time'));
    const address = a('address') || undefined;
    const base = {
      title,
      description: truncate(a('description'), 400),
      venue: {
        name: address?.split(',')[0] || 'New York',
        address,
        ...(Number.isFinite(lat) && lat !== 0 ? { lat, lng } : {}),
        borough: ['Manhattan', 'Brooklyn', 'Queens', 'The Bronx', 'Staten Island'].includes(a('borough')) ? a('borough').replace('The ', '') : undefined,
      },
      category,
      price: { free: true, text: 'Free' },
      url,
      sources: [{ id: 'nycforfree' as const, url }],
      pickedBy: ['nycforfree' as const],
      tags: [a('category'), a('frequency')].filter(Boolean),
      ...(hide.length ? { hide } : {}),
    };

    // Sessions: explicit occurrences > recurring weekdays > a single day > an ongoing run.
    const occText = clean($(el).find('[event-data="occurrences"]').text());
    const sessions: { day: string; s: string | null; e: string | null }[] = [];
    if (occText) {
      for (const part of occText.split(',')) {
        const [day, s, e] = part.split('|').map(x => x.trim());
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) sessions.push({ day, s: parseClock(s) ?? null, e: parseClock(e) ?? null });
      }
    } else if (a('frequency') === 'Recurrent' && a('recurring-days')) {
      const days = new Set(a('recurring-days').split(',').map(d => d.trim()));
      const lo = startDate > from ? startDate : from;
      const hi = endDate < to ? endDate : to;
      for (let d = lo; d <= hi; d = addDays(d, 1)) {
        if (days.has(DOW[new Date(`${d}T12:00:00Z`).getUTCDay()])) sessions.push({ day: d, s: startT, e: endT });
      }
    } else if (daysBetween(startDate, endDate) <= 3) {
      for (let d = startDate; d <= endDate; d = addDays(d, 1)) sessions.push({ day: d, s: startT, e: endT });
    }

    if (sessions.length) {
      for (const { day, s, e } of sessions) {
        if (day < from || day > to) continue;
        events.push({
          ...base,
          start: s ? nyIso(day, s) : day,
          ...(s && e && e > s ? { end: nyIso(day, e) } : {}),
          allDay: !s,
        });
      }
    } else if (endDate >= from && startDate <= to) {
      events.push({ ...base, start: startDate < from ? from : startDate, allDay: true, ongoing: { from: startDate, to: endDate } });
    }
  });
  return { events, skipped };
}

export async function collectNycForFree(root: string, days = 28): Promise<CollectResult> {
  const from = nyToday();
  const html = await getText(PAGE, { accept: 'text/html' });
  await saveRaw(root, 'nycforfree', 'events.html', html);
  const { events, skipped } = parseNycForFree(html, from, addDays(from, days - 1));
  return { source: 'nycforfree', events, notes: skipped ? [`${skipped} cards skipped (missing title/date)`] : [] };
}
