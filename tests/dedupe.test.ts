import { describe, expect, it } from 'vitest';
import { dedupe, sameEvent } from '../pipeline/dedupe.ts';
import type { RawEvent } from '../pipeline/schema.ts';

const ev = (title: string, venue: string, start: string, source: 'fomo' | 'skint' = 'fomo'): RawEvent => ({
  title, start, allDay: start.length === 10, venue: { name: venue }, category: 'other', price: { free: null },
  url: `https://example.org/${encodeURIComponent(title)}`, sources: [{ id: source, url: `https://example.org/${source}` }],
  pickedBy: source === 'fomo' ? [] : [source], tags: [],
});

// Pairs seen in the Nov 16 run: a Skint mention and the same event in fomo.
describe('dedupe', () => {
  it('matches a series-prefixed title against a film title with a year', () => {
    expect(sameEvent(
      ev('The Shop Around the Corner (1940)', 'Village East by Angelika', '2026-11-18T19:00:00-05:00'),
      ev('Classics in black + white: the shop around the corner', 'See listing', '2026-11-18T19:00:00-05:00', 'skint'),
    )).toBe(true);
  });
  it('matches a fully contained title even when the venue text was misread', () => {
    expect(sameEvent(
      ev('Go Fact Yourself - LIVE - with Alan Tudyk', 'Marlene Meyerson JCC', '2026-11-17T19:30:00-05:00'),
      ev('Go fact yourself', 'and michael ian black', '2026-11-17T19:30:00-05:00', 'skint'),
    )).toBe(true);
  });
  it('does not merge different events that share words', () => {
    expect(sameEvent(ev('Ice-skating at Bryant Park', 'Bryant Park', '2026-11-18'), ev('Meiomi Wines at The Lodge at Bank of America', 'Bryant Park', '2026-11-18', 'skint'))).toBe(false);
    expect(sameEvent(ev('Comedy Night', 'Caveat', '2026-11-18T19:00:00-05:00'), ev('Comedy Night', 'Caveat', '2026-11-18T23:30:00-05:00', 'skint'))).toBe(false);
  });
  it('folds the newsletter mention into the fomo event as a pick', () => {
    const { events, merged } = dedupe([
      ev('The Shop Around the Corner (1940)', 'Village East by Angelika', '2026-11-18T19:00:00-05:00'),
      ev('Classics in black + white: the shop around the corner', 'See listing', '2026-11-18T19:00:00-05:00', 'skint'),
    ]);
    expect(merged).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].pickedBy).toEqual(['skint']);
    expect(events[0].sources.map(s => s.id)).toEqual(['fomo', 'skint']);
  });
});

describe('dedupe against ongoing runs', () => {
  it('folds a newsletter festival day into the fomo run covering it', () => {
    const run = { ...ev('The Minnellis', 'Museum of the Moving Image', '2026-11-13'), ongoing: { from: '2026-11-13', to: '2027-01-24' } };
    const day = ev('The minnellis', 'museum of the moving image', '2026-11-14', 'skint');
    const { events, merged } = dedupe([run, day]);
    expect(merged).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].pickedBy).toEqual(['skint']);
  });
});
