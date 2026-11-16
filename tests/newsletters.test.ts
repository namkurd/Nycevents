import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leanWeek } from '../pipeline/build.ts';
import { feedItems } from '../pipeline/collectors/substack.ts';
import { expandWeek, mergeNewsletterEvents } from '../pipeline/newsletters.ts';
import { parseFieldNotes } from '../pipeline/parse/substack.ts';
import type { Event } from '../pipeline/schema.ts';

// field notes' Nov 9 issue (real feed), merged into a week that already lists one of its events.
const item = feedItems(readFileSync(new URL('./fixtures/substack-fieldnotesnyc.xml', import.meta.url), 'utf8'))[0];
const incoming = parseFieldNotes(item).events;
const existing: Event = {
  id: 'aaaaaaaaaaaa', title: 'New York: A Documentary Film - Shadows of the Past', start: '2026-11-09T18:00:00-05:00', allDay: false,
  venue: { name: 'SVA Theatre', address: '333 W 23rd St, New York, NY', lat: 40.7454, lng: -73.9993 },
  category: 'film', price: { free: null }, url: 'https://example.org/sva', sources: [{ id: 'fomo', url: 'https://example.org/sva' }],
  pickedBy: [], tags: ['Screening'], score: 0,
};

describe('merging newsletters into Actions-built week files', () => {
  it('round-trips the compact week format', () => {
    const back = expandWeek({ format: 2, week: '2026-W46', from: '2026-11-09', to: '2026-11-15', generatedAt: '', ...leanWeek([existing]) } as never);
    expect(back).toEqual([existing]);
  });

  it('adds a pick to the matching event and adds the rest with borrowed coordinates', () => {
    const pool = new Map([[existing.id, structuredClone(existing)]]);
    const { matched, added } = mergeNewsletterEvents(pool, incoming, { from: '2026-11-09', to: '2026-11-15' });
    expect(matched).toBe(1);
    expect(added).toBe(incoming.length - 1);
    const merged = pool.get(existing.id)!;
    expect(merged.pickedBy).toEqual(['fieldnotes']);
    expect(merged.sources.map(s => s.id)).toEqual(['fomo', 'fieldnotes']);
    expect(merged.score).toBe(3);
  });

  it('ignores events outside the listing window', () => {
    const pool = new Map<string, Event>();
    expect(mergeNewsletterEvents(pool, incoming, { from: '2027-01-01', to: '2027-01-28' })).toEqual({ matched: 0, added: 0 });
  });
});
