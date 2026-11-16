import { XMLParser } from 'fast-xml-parser';
import { getText, saveRaw } from '../lib/http.ts';
import { addDays, nyToday } from '../lib/time.ts';
import { PARSERS, type FeedItem, type SubstackSource } from '../parse/substack.ts';
import type { CollectResult } from '../schema.ts';

export const FEEDS: Record<SubstackSource, string> = {
  fieldnotes: 'https://fieldnotesnyc.substack.com/feed',
  cityhappenings: 'https://cityhappenings.substack.com/feed',
  readingthecity: 'https://readingthecity.substack.com/feed',
};

/** Parse an RSS document into items (title, link, ISO date, full HTML body). */
export function feedItems(xml: string): FeedItem[] {
  const doc = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true }).parse(xml);
  const raw = doc?.rss?.channel?.item ?? [];
  return (Array.isArray(raw) ? raw : [raw]).map((it: Record<string, unknown>) => ({
    title: String(it.title ?? ''),
    link: String(it.link ?? ''),
    pubDate: new Date(String(it.pubDate ?? '')).toISOString().slice(0, 10),
    html: String(it['content:encoded'] ?? it.description ?? ''),
  }));
}

export async function collectSubstack(root: string, source: SubstackSource): Promise<CollectResult> {
  // Substack refuses some data-center clients (GitHub Actions gets 403). That is a block, so we report
  // the source as failed rather than working around it.
  const xml = await getText(FEEDS[source], { accept: 'application/rss+xml' });
  await saveRaw(root, source, 'feed.xml', xml);
  const since = addDays(nyToday(), -8);
  const items = feedItems(xml).filter(i => i.pubDate >= since);
  const result: CollectResult = { source, events: [], unparsed: [], notes: [] };
  let matched = 0; let total = 0;
  for (const it of items) {
    const r = PARSERS[source](it);
    result.events.push(...r.events);
    result.unparsed!.push(...r.unparsed);
    matched += r.matched; total += r.total;
  }
  result.notes!.push(`${items.length} post(s) since ${since}; rules read ${matched}/${total} entries`);
  return result;
}
