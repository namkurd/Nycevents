/**
 * Merge the same event seen in several sources. fomo events go in first, so a newsletter's
 * mention of an event fomo already has just adds a "picked by" badge (spec 5: match first).
 */
import { containsTitle, jaccard, normKey, tokens } from './lib/text.ts';
import type { RawEvent } from './schema.ts';

const VAGUE_VENUES = new Set(['see listing', 'new york', 'various venues', 'various', 'online', 'tba']);

export interface VenueIndex {
  /** normalized venue name or alias -> canonical venue with coordinates */
  byName: Map<string, { name: string; address?: string; lat?: number; lng?: number; borough?: string }>;
}

function dayKey(e: RawEvent): string {
  return e.ongoing ? 'ongoing' : e.start.slice(0, 10);
}

function minutes(e: RawEvent): number | null {
  return e.allDay || e.start.length < 16 ? null : Number(e.start.slice(11, 13)) * 60 + Number(e.start.slice(14, 16));
}

function vague(name: string): boolean {
  return VAGUE_VENUES.has(name.trim().toLowerCase());
}

/** Title token sets to compare: the whole title, and the part after a colon ("Series: Film"). Years in parentheses are dropped. */
const variantCache = new Map<string, string[][]>();
const venueCache = new Map<string, string[]>();
const venueTokens = (name: string) => {
  let v = venueCache.get(name);
  if (!v) { v = tokens(name); venueCache.set(name, v); }
  return v;
};

function titleVariants(title: string): string[][] {
  const hit = variantCache.get(title);
  if (hit) return hit;
  const v = computeVariants(title);
  variantCache.set(title, v);
  return v;
}

function computeVariants(title: string): string[][] {
  const t = title.replace(/\((?:19|20)\d{2}\)/g, ' ');
  const parts = [t];
  const i = t.lastIndexOf(':');
  if (i > 0 && t.length - i > 6) parts.push(t.slice(i + 1));
  return parts.map(tokens).filter(x => x.length);
}

/** Share of the shorter token list found in the longer one. */
function containment(a: string[], b: string[]): { share: number; size: number } {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const L = new Set(l);
  return { share: s.filter(t => L.has(t)).length / s.length, size: s.length };
}

export function sameEvent(a: RawEvent, b: RawEvent): boolean {
  let tj = 0;
  let strong = false; // 3+ tokens of the shorter title all found in the longer
  let contained = false;
  for (const va of titleVariants(a.title)) for (const vb of titleVariants(b.title)) {
    tj = Math.max(tj, jaccard(va, vb));
    const c = containment(va, vb);
    if (c.size >= 2 && c.share >= 0.8) contained = true;
    if (c.size >= 3 && c.share === 1) strong = true;
  }
  if (tj < 0.6 && !contained) return false;
  const ma = minutes(a);
  const mb = minutes(b);
  if (ma != null && mb != null && Math.abs(ma - mb) > 180) return false;
  if (strong || tj >= 0.85) return true;
  if (vague(a.venue.name) || vague(b.venue.name)) return tj >= 0.75 || contained;
  const va = venueTokens(a.venue.name);
  const vb = venueTokens(b.venue.name);
  return jaccard(va, vb) >= 0.34 || containsTitle(va, vb) || va.some(t => t.length > 4 && vb.includes(t));
}

function merge(into: RawEvent, from: RawEvent): void {
  for (const s of from.sources) if (!into.sources.some(x => x.url === s.url && x.id === s.id)) into.sources.push(s);
  for (const p of from.pickedBy) if (!into.pickedBy.includes(p)) into.pickedBy.push(p);
  if (into.price.free == null && from.price.free != null) into.price = { ...from.price };
  else if (!into.price.text && from.price.text) into.price.text = from.price.text;
  if (!into.description && from.description) into.description = from.description;
  if (!into.rsvp && from.rsvp) into.rsvp = from.rsvp;
  if (into.venue.lat == null && from.venue.lat != null) into.venue = { ...into.venue, lat: from.venue.lat, lng: from.venue.lng };
  if (vague(into.venue.name) && !vague(from.venue.name)) into.venue = { ...from.venue, ...(into.venue.lat != null ? { lat: into.venue.lat, lng: into.venue.lng } : {}) };
  if (into.allDay && !from.allDay) { into.start = from.start; into.end = from.end; into.allDay = false; }
  // An editorial pick un-hides an event: if a newsletter chose it, it is not just a brand activation.
  if (into.hide && from.pickedBy.length && !from.hide?.length) {
    into.hide = into.hide.filter(h => h !== 'brand-popup');
    if (!into.hide.length) delete into.hide;
  }
}

/** Fill coordinates for venues fomo knows by name or alias (newsletter events carry no lat/lng). */
export function geocode(e: RawEvent, venues: VenueIndex): void {
  if (e.venue.lat != null || vague(e.venue.name)) return;
  const hit = venues.byName.get(normKey(e.venue.name));
  if (hit?.lat != null) e.venue = { ...e.venue, name: hit.name, address: e.venue.address && e.venue.address.length > 12 ? e.venue.address : hit.address ?? e.venue.address, lat: hit.lat, lng: hit.lng, borough: hit.borough };
}

/** Events in priority order (fomo first). Returns merged events and how many were folded in. */
export function dedupe(events: RawEvent[], venues?: VenueIndex): { events: RawEvent[]; merged: number } {
  const buckets = new Map<string, RawEvent[]>();
  const out: RawEvent[] = [];
  let merged = 0;
  for (const e of events) {
    if (venues) geocode(e, venues);
    const key = dayKey(e);
    const bucket = buckets.get(key) ?? [];
    let match = bucket.find(b => sameEvent(b, e));
    // A festival day or a run in a newsletter may be one ongoing run in fomo: match against runs covering that date.
    if (!match && (e.allDay || e.ongoing)) {
      const day = e.start.slice(0, 10);
      match = (buckets.get('ongoing') ?? []).find(b => b !== e && b.ongoing && b.ongoing.from <= day && b.ongoing.to >= day && sameEvent(b, e));
    }
    if (match) { merge(match, e); merged++; continue; }
    const copy = { ...e, sources: [...e.sources], pickedBy: [...e.pickedBy], price: { ...e.price }, venue: { ...e.venue } };
    bucket.push(copy);
    buckets.set(key, bucket);
    out.push(copy);
  }
  return { events: out, merged };
}
