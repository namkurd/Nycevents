/**
 * Rule-based parser for The Skint's WordPress posts.
 *
 * Entry paragraphs look like:
 *   [► ]<when>: <b>title</b>: description … venue (area), price. </span><a href="URL">>></a>
 * where <when> is e.g. "sat 11am-5pm", "sat + sun (10am-5pm)", "fri thru sun",
 * "fri thru 1/24/2027", "fri + sat (fri 6-9pm, sat 1-6pm)", "sun 12-6pm (+ 12/5, 12/19)".
 * Post titles carry the date range: "FRI-MON, 11/13-16: SKINT WEEKEND".
 */
import * as cheerio from 'cheerio';
import { guessCategory, newsletterHide } from '../categories.ts';
import { clean, decodeEntities, safeUrl, truncate } from '../lib/text.ts';
import { addDays, daysBetween, nyIso, parseClockRange, resolveMonthDay } from '../lib/time.ts';
import type { RawEvent } from '../schema.ts';

export interface WpPost {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

export interface Unparsed { postUrl: string; title: string; range?: string; text: string }

const DAY = '(?:mon|tues?|wed|thurs?|fri|sat|sun)[a-z]*';
const DAY_IDX: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const dayIdx = (d: string) => DAY_IDX[d.toLowerCase().slice(0, 3)];
const TIME = '\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?(?:\\s*[-–—]\\s*(?:\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)|close|late))?|noon';

/** "FRI-MON, 11/13-16" -> { from: 2026-11-13, to: 2026-11-16 }. */
export function postRange(title: string, postDate: string): { from: string; to: string } | null {
  const m = decodeEntities(title).match(/(\d{1,2})\/(\d{1,2})\s*[-–]\s*(?:(\d{1,2})\/)?(\d{1,2})/);
  if (!m) return null;
  const from = resolveMonthDay(Number(m[1]), Number(m[2]), postDate.slice(0, 10));
  const to = resolveMonthDay(Number(m[3] ?? m[1]), Number(m[4]), from);
  return to >= from && daysBetween(from, to) <= 10 ? { from, to } : null;
}

/** Date in [from, to] falling on weekday `idx`. */
function dateFor(idx: number, from: string, to: string): string | null {
  for (let d = from; d <= to; d = addDays(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === idx) return d;
  return null;
}

function mdDate(s: string, anchor: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return null;
  if (m[3]) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return resolveMonthDay(Number(m[1]), Number(m[2]), anchor);
}

export interface WhenResult {
  sessions: { day: string; start?: string; end?: string }[];
  ongoing?: { from: string; to: string };
}

/** Parse the "when" prefix of an entry against the post's date range. */
export function parseWhen(whenRaw: string, range: { from: string; to: string }): WhenResult | null {
  const when = clean(whenRaw).toLowerCase().replace(/^►\s*/, '');
  // "thru 12/31": a run already underway when the post went out.
  const thru = when.match(/^thru\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/);
  if (thru) {
    const to = mdDate(thru[1], range.from);
    if (!to || to < range.from) return null;
    if (daysBetween(range.from, to) > 4) return { sessions: [], ongoing: { from: range.from, to } };
    const sessions = [];
    for (let d = range.from; d <= to; d = addDays(d, 1)) sessions.push({ day: d });
    return { sessions };
  }
  const head = when.match(new RegExp(`^(${DAY}(?:\\s*\\+\\s*${DAY})*)(?:\\s+thru\\s+(${DAY}|\\d{1,2}/\\d{1,2}(?:/\\d{4})?))?`));
  if (!head) return null;
  const rest = when.slice(head[0].length);
  const days = head[1].split('+').map(s => s.trim());

  // Per-day times "(fri 6-9pm, sat 1-6pm)" or one shared time.
  const perDay = new Map<number, string>();
  for (const m of rest.matchAll(new RegExp(`(${DAY})\\s+(${TIME})`, 'g'))) perDay.set(dayIdx(m[1]), m[2]);
  const shared = rest.match(new RegExp(`(?:^|[\\s(])(${TIME})`))?.[1];
  const timeFor = (idx: number) => {
    const t = perDay.get(idx) ?? shared;
    if (!t) return {};
    const r = parseClockRange(t.replace(/\s+/g, '').replace(/[-–—](close|late)$/, ''));
    return r ? { start: r.start, end: r.end } : {};
  };

  const startIdx = dayIdx(days[0]);
  const startDay = dateFor(startIdx, range.from, range.to);
  if (!startDay) return null;

  if (head[2]) {
    const endDay = /^\d/.test(head[2]) ? mdDate(head[2], range.from) : dateFor(dayIdx(head[2]), startDay, addDays(startDay, 6));
    if (!endDay || endDay < startDay) return null;
    if (daysBetween(startDay, endDay) > 4) return { sessions: [], ongoing: { from: startDay, to: endDay } };
    const sessions = [];
    for (let d = startDay; d <= endDay; d = addDays(d, 1)) sessions.push({ day: d, ...timeFor(new Date(`${d}T12:00:00Z`).getUTCDay()) });
    return { sessions };
  }

  const sessions: WhenResult['sessions'] = [];
  for (const d of days) {
    const day = dateFor(dayIdx(d), range.from, range.to);
    if (day) sessions.push({ day, ...timeFor(dayIdx(d)) });
  }
  // Extra dates: "(+ 12/5, 12/19)".
  const extra = rest.match(/\(\+\s*([\d/,\s]+)\)/);
  if (extra) {
    for (const s of extra[1].split(',').map(x => x.trim()).filter(Boolean)) {
      const day = mdDate(s, range.from);
      if (day) sessions.push({ day, ...timeFor(new Date(`${day}T12:00:00Z`).getUTCDay()) });
    }
  }
  return sessions.length ? { sessions } : null;
}

/** "… the new york historical store (uws). $5 admission" -> venue "the new york historical store", area "uws". */
export function venueFrom(desc: string): { name: string; area?: string } | null {
  const matches = [...desc.matchAll(/([^.:;!?()]{3,80}?)\s*\(([a-z][a-z .'’\-/&]{1,30})\)/gi)];
  for (let i = matches.length - 1; i >= 0; i--) {
    const [, before, area] = matches[i];
    if (/^(monthly|weekly|free|rsvp|\+)/i.test(area)) continue;
    let name = before.split(/,\s|\bat\s|\bof\s(?=the\s)|@\s|\bover\s|\btake over\s/i).pop()!.trim();
    name = name.replace(/^(the\s+)?(back room|basement|rooftop)\s+(of|at)\s+/i, '').trim();
    if (name.length >= 3) return { name, area };
  }
  return null;
}

/** "industry city, $20 admission." -> "industry city" (a short first clause before a price or full stop). */
export function leadingVenue(desc: string): { name: string; area?: string } | null {
  const m = desc.match(/^([^,.:;]{3,40}?)\s*(?:,|\.)(?:\s|$)/);
  if (!m) return null;
  const name = m[1].trim();
  if (name.split(/\s+/).length > 5 || /^(the annual|this|a |an |join|celebrate|free|\$)/i.test(name)) return null;
  return { name };
}

function priceFrom(text: string): { free: boolean | null; text?: string } {
  const t = text.toLowerCase();
  const dollars = text.match(/\$\d+(?:\.\d{2})?(?:\s*[-–]\s*\$?\d+)?\+?(?:\s+(?:admission|tickets?|suggested donation|general|cover|advance))?/i)?.[0];
  if (/\bfree\b/.test(t) && !dollars) return { free: true, text: 'Free' };
  if (/\bfree\b/.test(t) && dollars) return { free: null, text: `Free / ${dollars}` };
  if (dollars) return { free: false, text: dollars };
  return { free: null };
}

export function parseSkintPost(post: WpPost): { events: RawEvent[]; unparsed: Unparsed[]; matched: number; total: number } {
  const title = clean(post.title.rendered);
  const range = postRange(title, post.date);
  const events: RawEvent[] = [];
  const unparsed: Unparsed[] = [];
  if (/sponsored/i.test(title)) return { events, unparsed, matched: 0, total: 0 };
  if (!range) {
    // Not a dated round-up (e.g. a feature post): let the daily session read it.
    unparsed.push({ postUrl: post.link, title, text: cheerio.load(post.content.rendered).text().trim().slice(0, 6000) });
    return { events, unparsed, matched: 0, total: 0 };
  }

  const $ = cheerio.load(post.content.rendered);
  let total = 0;
  let matched = 0;
  $('p').each((_, p) => {
    const link = $(p).find('a').filter((_, a) => /&gt;&gt;|>>/.test($(a).html() ?? '') || /»/.test($(a).text())).last();
    const href = safeUrl(link.attr('href'));
    if (!href) return; // headings, intros, section labels
    if (/^https?:\/\/(www\.)?theskint\.com\//.test(href)) return; // links to the Skint's own round-ups
    if (/^\s*(►\s*)?sponsored\b/i.test($(p).text())) return; // paid placements
    total++;
    const html = $(p).html() ?? '';
    const bold = $(p).find('b').first();
    const name = clean(bold.text());
    const text = clean($(p).text()).replace(/\s*>>\s*$/, '');
    const whenText = clean(cheerio.load(html.split(/<b>/i)[0]).text()).replace(/:\s*$/, '');
    const when = name ? parseWhen(whenText, range) : null;
    if (!when || !name) {
      unparsed.push({ postUrl: post.link, title, range: `${range.from}..${range.to}`, text: `${text} ${href}` });
      return;
    }
    matched++;
    const desc = clean(text.slice(text.indexOf(name) + name.length).replace(/^\s*:\s*/, ''));
    const venue = venueFrom(desc) ?? leadingVenue(desc);
    const category = guessCategory(`${name} ${desc}`);
    const hide = newsletterHide(category);
    const base = {
      title: name.replace(/^./, c => c.toUpperCase()),
      description: truncate(desc, 400),
      venue: { name: venue?.name ?? 'See listing', ...(venue?.area ? { address: venue.area } : {}) },
      category,
      price: priceFrom(desc),
      url: href,
      sources: [{ id: 'skint' as const, url: href }],
      pickedBy: ['skint' as const],
      tags: ['skint'],
      ...(/\brsvp\b/i.test(desc) ? { rsvp: { required: true } } : {}),
      ...(hide.length ? { hide } : {}),
    };
    if (when.ongoing) {
      events.push({ ...base, start: when.ongoing.from, allDay: true, ongoing: when.ongoing });
      return;
    }
    for (const s of when.sessions) {
      events.push({
        ...base,
        start: s.start ? nyIso(s.day, s.start) : s.day,
        ...(s.start && s.end && s.end > s.start ? { end: nyIso(s.day, s.end) } : {}),
        allDay: !s.start,
      });
    }
  });
  return { events, unparsed, matched, total };
}
