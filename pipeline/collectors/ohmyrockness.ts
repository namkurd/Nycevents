/**
 * Oh My Rockness — indie/rock show listings. /api/shows.json needs a token the page issues,
 * so a headless browser loads /shows?page=N and the JSON responses it fetches are captured.
 * Each page holds ~50 shows (about a day and a half); OMR "recommended" shows count as picks.
 */
import { saveRaw } from '../lib/http.ts';
import { clean, safeUrl } from '../lib/text.ts';
import { addDays, nyToday } from '../lib/time.ts';
import type { CollectResult, RawEvent } from '../schema.ts';
import { isChallenge, withPage } from '../lib/browser.ts';

export interface OmrShow {
  id: number;
  starts_at: string;
  price?: string;
  age?: string;
  sold_out?: boolean;
  recommended?: boolean;
  tickets_url?: string;
  url: string;
  cached_bands: { name: string }[];
  venue: { name: string; full_address?: string; latitude?: string; longitude?: string };
}

const PAGES = 14;

export function parseOmr(shows: OmrShow[], from: string, to: string): RawEvent[] {
  const seen = new Set<number>();
  const out: RawEvent[] = [];
  for (const s of shows) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    const day = s.starts_at?.slice(0, 10);
    if (!day || day < from || day > to) continue;
    const url = safeUrl(s.url);
    const bands = (s.cached_bands ?? []).map(b => clean(b.name)).filter(Boolean);
    if (!url || !bands.length) continue;
    const lat = Number(s.venue?.latitude);
    const lng = Number(s.venue?.longitude);
    const price = clean(s.price ?? '');
    // "2026-11-15T19:00:00.000-05:00" -> schema form without milliseconds.
    const start = s.starts_at.replace(/\.\d{3}/, '');
    out.push({
      title: bands.join(', '),
      start,
      allDay: false,
      venue: {
        name: clean(s.venue?.name ?? 'See listing'),
        address: s.venue?.full_address ? clean(s.venue.full_address.replace(/\n/g, ', ')) : undefined,
        ...(Number.isFinite(lat) && Number.isFinite(lng) && lat ? { lat, lng } : {}),
      },
      category: 'music',
      price: price ? { free: /free/i.test(price), text: price } : { free: null },
      url,
      ...(safeUrl(s.tickets_url) ? { ticketsUrl: safeUrl(s.tickets_url) } : {}),
      sources: [{ id: 'ohmyrockness', url }],
      pickedBy: s.recommended ? ['ohmyrockness'] : [],
      tags: ['ohmyrockness', s.age, s.sold_out ? 'Sold out' : ''].filter((t): t is string => !!t),
    });
  }
  return out;
}

export async function collectOhMyRockness(root: string, days = 28): Promise<CollectResult> {
  const from = nyToday();
  const shows: OmrShow[] = [];
  await withPage(async page => {
    page.on('response', async r => {
      if (!r.url().includes('/api/shows.json') || r.status() !== 200) return;
      try { shows.push(...((await r.json()) as OmrShow[])); } catch { /* not JSON */ }
    });
    for (let n = 1; n <= PAGES; n++) {
      await page.goto(`https://www.ohmyrockness.com/shows${n > 1 ? `?page=${n}` : ''}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(800);
      if (n === 1 && isChallenge(await page.title(), await page.content())) throw new Error('bot check shown; skipped this run');
    }
  });
  if (!shows.length) throw new Error('no show data captured');
  await saveRaw(root, 'ohmyrockness', 'shows.json', JSON.stringify(shows));
  const events = parseOmr(shows, from, addDays(from, days - 1));
  return { source: 'ohmyrockness', events, notes: [`${shows.length} shows from ${PAGES} pages; ${events.filter(e => e.pickedBy.length).length} recommended`] };
}
