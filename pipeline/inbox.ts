/**
 * The no-API-key fallback.
 *
 * Text the rule-based parsers could not read is written to data/inbox/<source>-<hash>.md.
 * The daily scheduled Claude Code session reads each inbox file, writes the events it finds
 * to data/cache/extract/<hash>.json (format below), and deletes the inbox file. The pipeline
 * then folds every cache file into the build.
 *
 * Cache file format:
 * {
 *   "source": "skint", "postUrl": "https://…", "extractedAt": "2026-11-16T06:00:00Z",
 *   "events": [ { "title": "…", "date": "2026-11-20", "start": "19:00", "end": "21:00",
 *                 "venue": "…", "address": "…", "price": "Free" | "$15", "url": "https://…",
 *                 "category": "music", "rsvp": true } ]
 * }
 * Only fields the text states may be filled in. An empty "events" array is valid (nothing found).
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { newsletterHide } from './categories.ts';
import { sha1, safeUrl, truncate } from './lib/text.ts';
import { nyIso, parseClock } from './lib/time.ts';
import { Category, SourceId, type CollectResult, type RawEvent } from './schema.ts';

export function inboxHash(postUrl: string, text: string): string {
  return sha1(`${postUrl}\n${text}`).slice(0, 12);
}

/** Write unparsed blocks to data/inbox/, skipping any already extracted into the cache. */
export async function writeInbox(root: string, results: CollectResult[]): Promise<{ written: number; cached: number }> {
  const inbox = join(root, 'data', 'inbox');
  const cache = join(root, 'data', 'cache', 'extract');
  await mkdir(inbox, { recursive: true });
  await mkdir(cache, { recursive: true });
  const cachedIds = new Set((await readdir(cache)).map(f => f.replace(/\.json$/, '')));
  let written = 0;
  let cached = 0;
  for (const r of results) {
    for (const u of r.unparsed ?? []) {
      const h = inboxHash(u.postUrl, u.text);
      if (cachedIds.has(h)) { cached++; continue; }
      const body = [
        `source: ${r.source}`,
        `post: ${u.postUrl}`,
        `title: ${u.title}`,
        u.range ? `dates: ${u.range}` : null,
        `cache: data/cache/extract/${h}.json`,
        '',
        u.text,
        '',
      ].filter(x => x !== null).join('\n');
      await writeFile(join(inbox, `${r.source}-${h}.md`), body);
      written++;
    }
  }
  return { written, cached };
}

const CachedEvent = z.object({
  title: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z.string().optional(),
  end: z.string().optional(),
  venue: z.string().min(1),
  address: z.string().optional(),
  price: z.string().optional(),
  url: z.string().optional(),
  category: Category.optional(),
  rsvp: z.boolean().optional(),
  description: z.string().optional(),
});
const CacheFile = z.object({
  source: SourceId,
  postUrl: z.string().url(),
  extractedAt: z.string(),
  events: z.array(CachedEvent),
});

/** Load every cache file the Claude session wrote and turn it into RawEvents. Invalid files are reported, not used. */
export async function loadExtracted(root: string): Promise<{ events: RawEvent[]; errors: string[] }> {
  const dir = join(root, 'data', 'cache', 'extract');
  const events: RawEvent[] = [];
  const errors: string[] = [];
  let files: string[] = [];
  try { files = (await readdir(dir)).filter(f => f.endsWith('.json')); } catch { return { events, errors }; }
  for (const f of files) {
    const parsed = CacheFile.safeParse(JSON.parse(await readFile(join(dir, f), 'utf8')));
    if (!parsed.success) { errors.push(`${f}: ${parsed.error.issues[0]?.message}`); continue; }
    const { source, postUrl, events: list } = parsed.data;
    for (const c of list) {
      const url = safeUrl(c.url) ?? postUrl;
      const s = parseClock(c.start);
      const e = parseClock(c.end);
      const category = c.category ?? 'other';
      const hide = newsletterHide(category);
      const free = c.price ? /\bfree\b/i.test(c.price) && !/\$/.test(c.price) : null;
      events.push({
        title: c.title,
        description: truncate(c.description, 400),
        start: s ? nyIso(c.date, s) : c.date,
        ...(s && e && e > s ? { end: nyIso(c.date, e) } : {}),
        allDay: !s,
        venue: { name: c.venue, ...(c.address ? { address: c.address } : {}) },
        category,
        price: { free, ...(c.price ? { text: c.price } : {}) },
        url,
        sources: [{ id: source, url }],
        pickedBy: source === 'fomo' ? [] : [source],
        tags: [source, 'extracted'],
        ...(c.rsvp ? { rsvp: { required: true } } : {}),
        ...(hide.length ? { hide } : {}),
      });
    }
  }
  return { events, errors };
}
