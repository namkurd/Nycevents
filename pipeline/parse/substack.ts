/**
 * Rule-based parsers for the three weekly Substack newsletters. Each post groups events under
 * day headings ("Monday, November 9"); the per-event layout differs by newsletter:
 *
 *  field notes:      <p><strong>🎞️ <a href=URL>Title</a><br></strong>6—9pm | <em>Venue:</em> address | $11.49+</p>
 *  City Happenings:  <p><strong>Title</strong><br><em>Venue</em> | 6-9pm at 333 W 23rd St, Chelsea</p><p>blurb … <a>Tickets</a></p>
 *  Reading the City: <h5>LAUNCH | <a href=URL>Title</a></h5><p>blurb</p><p><em>$10; 7-8pm; Venue, address</em></p>
 */
import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import { guessCategory, newsletterHide } from '../categories.ts';
import { clean, safeUrl, truncate } from '../lib/text.ts';
import { monthIndex, nyIso, parseClockRange, resolveMonthDay } from '../lib/time.ts';
import type { Category, RawEvent, SourceId } from '../schema.ts';
import type { Unparsed } from './skint.ts';

export interface FeedItem { title: string; link: string; pubDate: string; html: string }
export type SubstackSource = 'fieldnotes' | 'cityhappenings' | 'readingthecity';

const DAY_HEADING = /^(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+([a-z]+)\s+(\d{1,2})\b/i;
const TIME_RX = /(\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}(?::\d{2})?\s*(?:am|pm)|noon)/i;

/** "Monday, November 9" -> 2026-11-09 (year from the post date). */
export function headingDate(text: string, postDate: string): string | null {
  const m = clean(text).match(DAY_HEADING);
  if (!m) return null;
  const mon = monthIndex(m[1]);
  return mon ? resolveMonthDay(mon, Number(m[2]), postDate) : null;
}

/** "7.30pm" -> "7:30pm" (Reading the City writes times British-style). */
const dotTimes = (s: string) => s.replace(/\b(\d{1,2})\.(\d{2})(?=\s*(?:am|pm|[-–—]))/gi, '$1:$2');

function timeOf(text: string): { start?: string; end?: string } {
  const t = dotTimes(text).match(TIME_RX)?.[1];
  if (!t) return {};
  const r = parseClockRange(t.replace(/\s+/g, ''));
  return r ? { start: r.start, end: r.end } : {};
}

function priceOf(text: string): { free: boolean | null; text?: string } {
  const dollars = text.match(/\$\d+(?:\.\d{2})?\+?(?:\s*[-–]\s*\$?\d+(?:\.\d{2})?)?/)?.[0];
  const free = /\bfree\b/i.test(text);
  if (free && !dollars) return { free: true, text: clean(text).slice(0, 60) };
  if (dollars) return { free: false, text: clean(text).slice(0, 60) };
  return { free: null };
}

function makeEvent(source: SourceId, day: string, f: {
  title: string; url: string; venue: string; address?: string; time: { start?: string; end?: string };
  price: { free: boolean | null; text?: string }; blurb?: string; category: Category; rsvp?: boolean;
}): RawEvent {
  const hide = newsletterHide(f.category);
  return {
    title: f.title,
    description: truncate(f.blurb, 400),
    start: f.time.start ? nyIso(day, f.time.start) : day,
    ...(f.time.start && f.time.end && f.time.end > f.time.start ? { end: nyIso(day, f.time.end) } : {}),
    allDay: !f.time.start,
    venue: { name: f.venue || 'See listing', ...(f.address ? { address: f.address } : {}) },
    category: f.category,
    price: f.price,
    url: f.url,
    sources: [{ id: source, url: f.url }],
    pickedBy: [source],
    tags: [source],
    ...(f.rsvp ? { rsvp: { required: true } } : {}),
    ...(hide.length ? { hide } : {}),
  };
}

/** Top-level blocks of a post body, in order. */
function blocks(html: string): { $: cheerio.CheerioAPI; nodes: Element[] } {
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  const nodes = $('#root').children().toArray().filter((n: AnyNode): n is Element => n.type === 'tag');
  return { $, nodes };
}

const textOf = ($: cheerio.CheerioAPI, n: Element) => clean($(n).text());
const htmlLines = ($: cheerio.CheerioAPI, n: Element) => ($(n).html() ?? '').split(/<br\s*\/?>/i).map(h => clean(cheerio.load(h).text()));

export function parseFieldNotes(item: FeedItem): { events: RawEvent[]; unparsed: Unparsed[]; matched: number; total: number } {
  const { $, nodes } = blocks(item.html);
  const events: RawEvent[] = []; const unparsed: Unparsed[] = [];
  let day: string | null = null; let total = 0; let matched = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (/^h[2-4]$/.test(n.tagName)) { day = headingDate(textOf($, n), item.pubDate) ?? day; continue; }
    if (!day || n.tagName !== 'p') continue;
    const a = $(n).find('strong a').first();
    if (!a.length) continue;
    total++;
    const [, info = ''] = htmlLines($, n);
    const parts = info.split(/\s+\|\s+/);
    const url = safeUrl(a.attr('href'));
    const title = clean(a.text());
    const time = timeOf(parts[0] ?? '');
    const venueAddr = parts[1] ?? '';
    const vm = venueAddr.match(/^(.+?):\s*(.*)$/);
    if (!url || !title || !time.start || !vm) { unparsed.push({ postUrl: item.link, title: item.title, range: day, text: `${textOf($, n)} ${url ?? ''}` }); continue; }
    matched++;
    const next = nodes[i + 1];
    const blurb = next && next.tagName === 'p' && !$(next).find('strong a').length ? textOf($, next).replace(/^[“"]|[”"]$/g, '') : undefined;
    const price = priceOf(parts.slice(2).join(' | '));
    events.push(makeEvent('fieldnotes', day, {
      title: title.replace(/\?utm_source=\w+$/, ''), url: url.replace(/[?&]utm_source=fieldnotesnyc$/, ''), venue: vm[1], address: vm[2], time, price, blurb,
      category: guessCategory(`${title} ${blurb ?? ''}`), rsvp: /\brsvp\b/i.test(parts.slice(2).join(' ')),
    }));
  }
  return { events, unparsed, matched, total };
}

export function parseCityHappenings(item: FeedItem): { events: RawEvent[]; unparsed: Unparsed[]; matched: number; total: number } {
  const { $, nodes } = blocks(item.html);
  const events: RawEvent[] = []; const unparsed: Unparsed[] = [];
  let day: string | null = null; let total = 0; let matched = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (/^h[2-4]$/.test(n.tagName)) { day = headingDate(textOf($, n), item.pubDate) ?? day; continue; }
    if (!day || n.tagName !== 'p') continue;
    const strong = $(n).children('strong').first();
    const em = $(n).children('em').first();
    if (!strong.length || !em.length) continue;
    total++;
    const [titleLine = '', info = ''] = htmlLines($, n);
    const title = clean(strong.text()) || titleLine;
    const venue = clean(em.text());
    const after = info.replace(venue, '').replace(/^\s*\|\s*/, '');
    const time = timeOf(after);
    const address = after.match(/\bat\s+(.+)$/)?.[1];
    // The next paragraph is the blurb; its links point to tickets or the event page.
    const next = nodes[i + 1];
    const blurbNode = next && next.tagName === 'p' && !$(next).children('strong').length ? next : undefined;
    const blurb = blurbNode ? textOf($, blurbNode) : undefined;
    const links = blurbNode ? $(blurbNode).find('a').toArray().map(a => ({ text: clean($(a).text()).toLowerCase(), href: safeUrl($(a).attr('href')) })) : [];
    const url = (links.find(l => /ticket|rsvp|register|info|details|event/.test(l.text)) ?? links.at(-1))?.href ?? item.link;
    if (!title || !venue || !time.start) { unparsed.push({ postUrl: item.link, title: item.title, range: day, text: `${textOf($, n)} ${blurb ?? ''}`.slice(0, 1500) }); continue; }
    matched++;
    events.push(makeEvent('cityhappenings', day, {
      title, url, venue, address, time, price: priceOf(blurb?.match(/[^.]*(?:\$\d|free)[^.]*/i)?.[0] ?? ''), blurb,
      category: guessCategory(`${title} ${blurb ?? ''}`), rsvp: /\brsvp\b/i.test(blurb ?? ''),
    }));
  }
  return { events, unparsed, matched, total };
}

export function parseReadingTheCity(item: FeedItem): { events: RawEvent[]; unparsed: Unparsed[]; matched: number; total: number } {
  const { $, nodes } = blocks(item.html);
  const events: RawEvent[] = []; const unparsed: Unparsed[] = [];
  let day: string | null = null; let total = 0; let matched = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (/^h[2-4]$/.test(n.tagName)) { day = headingDate(textOf($, n), item.pubDate) ?? day; continue; }
    if (!day || n.tagName !== 'h5') continue;
    total++;
    const head = textOf($, n);
    const [kind, ...rest] = head.split('|');
    const title = clean(rest.join('|')) || clean(head);
    const url = safeUrl($(n).find('a').first().attr('href')) ?? item.link;
    // Blurb paragraphs follow, then an italic logistics line "price; time; venue, address".
    let blurb = ''; let logistics = '';
    for (let j = i + 1; j < nodes.length && !/^h[2-5]$/.test(nodes[j].tagName); j++) {
      const p = nodes[j];
      if (p.tagName !== 'p') continue;
      const txt = textOf($, p);
      if ($(p).children('em').length === $(p).children().length && /;/.test(txt) && TIME_RX.test(dotTimes(txt))) { logistics = txt; break; }
      if (!blurb) blurb = txt;
    }
    const segs = logistics.split(';').map(s => s.trim()).filter(Boolean);
    const timeIdx = segs.findIndex(s => TIME_RX.test(dotTimes(s)) && s.length < 40);
    const time = timeIdx >= 0 ? timeOf(segs[timeIdx]) : {};
    const where = segs.slice(timeIdx + 1).join('; ');
    const [venue, ...addr] = where.split(',').map(s => s.trim());
    if (!time.start || !venue) { unparsed.push({ postUrl: item.link, title: item.title, range: day, text: `${head}\n${blurb}\n${logistics}`.slice(0, 1500) }); continue; }
    matched++;
    events.push(makeEvent('readingthecity', day, {
      title, url, venue, address: addr.join(', ').replace(/,?\s*and livestreamed.*$/i, '') || undefined, time,
      price: priceOf(segs.slice(0, Math.max(timeIdx, 0)).join('; ')), blurb,
      category: /reading|launch|series|book|poetry|author/i.test(`${kind} ${title}`) ? 'books' : guessCategory(`${title} ${blurb}`, 'books'),
      rsvp: /\brsvp\b|register/i.test(logistics),
    }));
  }
  return { events, unparsed, matched, total };
}

export const PARSERS: Record<SubstackSource, (i: FeedItem) => ReturnType<typeof parseFieldNotes>> = {
  fieldnotes: parseFieldNotes,
  cityhappenings: parseCityHappenings,
  readingthecity: parseReadingTheCity,
};
