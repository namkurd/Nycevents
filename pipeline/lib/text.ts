import { createHash } from 'node:crypto';

const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'at', 'in', 'on', 'for', 'with', 'to', 'by', 'from', 'nyc', 'new', 'york', 'presents', 'live']);

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '…');
}

export function clean(s: string): string {
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

/** Lowercase word tokens without punctuation or filler words. */
export function tokens(s: string): string[] {
  return decodeEntities(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP.has(t));
}

export function normKey(s: string): string {
  return tokens(s).join(' ');
}

export function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** True when every token of the shorter title appears in the longer one (and it has 2+ tokens). */
export function containsTitle(a: string[], b: string[]): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length < 2) return false;
  const L = new Set(l);
  return s.every(t => L.has(t));
}

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export function eventId(title: string, startDate: string, venue: string): string {
  return sha1(`${normKey(title)}|${startDate}|${normKey(venue)}`).slice(0, 12);
}

export function truncate(s: string | undefined, n: number): string | undefined {
  if (!s) return undefined;
  const c = clean(s);
  if (!c) return undefined;
  return c.length <= n ? c : `${c.slice(0, n - 1).replace(/\s+\S*$/, '')}…`;
}

/** Distance in metres between two lat/lng points. */
export function metres(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Absolute http(s) URL or undefined. */
export function safeUrl(u: string | undefined | null, base?: string): string | undefined {
  if (!u) return undefined;
  try {
    const url = new URL(decodeEntities(u.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
