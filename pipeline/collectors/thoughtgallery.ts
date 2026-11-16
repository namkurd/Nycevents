/**
 * Thought Gallery — talks, lectures, readings. Plain requests get a Cloudflare 403; a headless
 * browser renders /all-categories/ normally, with every page of results in the DOM:
 *   <h2 class="date_group_header">Monday, November 16, 2026</h2>
 *   <div class="all_categories_item_container">
 *     <div class="all_categories_time_container">5:00 PM</div>
 *     <div class="all_categories_event_container"><h3><a href="events/slug/">Title</a></h3>
 *       <span class="location"><a href="locations/x/">Venue</a></span>
 *       <span class="category"><a href="events/categories/free/">Free</a></span>, …
 */
import * as cheerio from 'cheerio';
import { guessCategory } from '../categories.ts';
import { saveRaw } from '../lib/http.ts';
import { clean, safeUrl } from '../lib/text.ts';
import { addDays, nyIso, nyToday, parseClock } from '../lib/time.ts';
import type { Category, CollectResult, RawEvent } from '../schema.ts';
import { isChallenge, withPage } from '../lib/browser.ts';

const PAGE = 'https://thoughtgallery.org/all-categories/';
const BASE = 'https://thoughtgallery.org/';

const TG_CATEGORY: Record<string, Category> = {
  art: 'art', design: 'art', film: 'film', 'food-drink': 'food-drink', literary: 'books', music: 'music',
  history: 'talks', politics: 'talks', science: 'talks', religion: 'talks', lgbt: 'talks',
};

export function parseThoughtGallery(html: string, from: string, to: string): { events: RawEvent[]; skipped: number } {
  const $ = cheerio.load(html);
  const events: RawEvent[] = [];
  let skipped = 0;
  let day: string | null = null;
  $('h2.date_group_header, div.all_categories_item_container').each((_, el) => {
    if (el.tagName === 'h2') {
      const t = Date.parse(`${clean($(el).text())} 12:00 UTC`);
      day = Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
      return;
    }
    if (!day || day < from || day > to) return;
    const a = $(el).find('h3 a').first();
    const title = clean(a.text());
    const url = safeUrl(a.attr('href'), BASE);
    const venue = clean($(el).find('.location').text());
    const cats = $(el).find('.category a').toArray().map(c => ($(c).attr('href') ?? '').match(/categories\/([a-z-]+)/)?.[1] ?? '').filter(Boolean);
    if (!title || !url) { skipped++; return; }
    if (cats.includes('virtual') && !cats.includes('in-person') && !cats.includes('hybrid')) return; // online-only
    const time = parseClock(clean($(el).find('.all_categories_time_container').text()).replace(/\s+/g, ''));
    const mapped = cats.map(c => TG_CATEGORY[c]).find(Boolean);
    events.push({
      title,
      start: time ? nyIso(day, time) : day,
      allDay: !time,
      venue: { name: venue || 'See listing' },
      category: mapped && mapped !== 'talks' ? (/talk|lecture|conversation|panel|discussion/i.test(title) ? 'talks' : mapped) : guessCategory(title, 'talks'),
      price: { free: cats.includes('free') ? true : null },
      url,
      sources: [{ id: 'thoughtgallery', url }],
      pickedBy: ['thoughtgallery'],
      tags: ['thoughtgallery', ...cats.filter(c => c !== 'free')].slice(0, 6),
    });
  });
  return { events, skipped };
}

export async function collectThoughtGallery(root: string, days = 28): Promise<CollectResult> {
  const from = nyToday();
  const html = await withPage(async page => {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const body = await page.content();
    if (isChallenge(await page.title(), body)) throw new Error('bot check shown; skipped this run');
    return body;
  });
  await saveRaw(root, 'thoughtgallery', 'all-categories.html', html);
  const { events, skipped } = parseThoughtGallery(html, from, addDays(from, days - 1));
  return { source: 'thoughtgallery', events, notes: skipped ? [`${skipped} items skipped (no title/link)`] : [] };
}
