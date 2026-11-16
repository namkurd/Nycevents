import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseOmr, type OmrShow } from '../pipeline/collectors/ohmyrockness.ts';
import { parseThoughtGallery } from '../pipeline/collectors/thoughtgallery.ts';
import { Event } from '../pipeline/schema.ts';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const valid = (events: unknown[]) => {
  for (const e of events as Record<string, unknown>[]) {
    const r = Event.safeParse({ ...e, id: '000000000000', score: 0 });
    if (!r.success) throw new Error(`${e.title}: ${r.error.message}`);
  }
};

// JSON captured from ohmyrockness.com/shows in a headless browser, Nov 16, 2026 (first 60 shows).
describe('Oh My Rockness', () => {
  const shows: OmrShow[] = JSON.parse(fixture('ohmyrockness-shows.json'));
  const events = parseOmr(shows, '2026-11-15', '2026-12-12');
  it('turns shows into valid music events with venue coordinates', () => {
    expect(events.length).toBeGreaterThan(40);
    valid(events);
    expect(events.every(e => e.category === 'music' && !e.allDay)).toBe(true);
    expect(events.filter(e => e.venue.lat != null).length / events.length).toBeGreaterThan(0.9);
  });
  it('counts only recommended shows as picks', () => {
    const rec = shows.filter(s => s.recommended).length;
    expect(events.filter(e => e.pickedBy.length).length).toBe(rec);
  });
});

// Rendered https://thoughtgallery.org/all-categories/ (Nov 16, 2026; scripts and styles stripped).
describe('Thought Gallery', () => {
  const html = fixture('thoughtgallery-rendered.html');
  const { events, skipped } = parseThoughtGallery(html, '2026-11-16', '2026-12-13');
  it('reads dated items into valid talk-led events', () => {
    expect(skipped).toBe(0);
    expect(events.length).toBeGreaterThan(40);
    valid(events);
    const first = events[0];
    expect(first.title).toBe('Braiding Indigenous Knowledges and Science');
    expect(first.start).toBe('2026-11-16T12:00:00-05:00');
    expect(first.venue.name).toBe('Columbia University');
    expect(first.price.free).toBe(true);
    expect(first.url).toBe('https://thoughtgallery.org/events/braiding-indigenous-knowledges-and-science/');
  });
  it('drops online-only events and keeps hybrid ones', () => {
    expect(events.some(e => e.tags.includes('virtual') && !e.tags.includes('hybrid') && !e.tags.includes('in-person'))).toBe(false);
  });
});
