import { describe, expect, it } from 'vitest';
import { Event } from '../pipeline/schema';

// Shape-only test of the validator; values are placeholders, not a real event.
const valid = {
  id: '0123456789ab',
  title: 'Placeholder',
  start: '2026-11-20T19:00:00-05:00',
  allDay: false,
  venue: { name: 'Placeholder venue' },
  category: 'film',
  price: { free: null },
  url: 'https://example.com/e',
  sources: [{ id: 'fomo', url: 'https://example.com/e' }],
  pickedBy: [],
  tags: [],
  score: 0,
};

describe('Event schema', () => {
  it('accepts a well-formed event', () => {
    expect(Event.safeParse(valid).success).toBe(true);
  });

  it('accepts a date-only start', () => {
    expect(Event.safeParse({ ...valid, start: '2026-11-20', allDay: true }).success).toBe(true);
  });

  it.each([
    ['missing url', { url: undefined }],
    ['bad start', { start: '11/20 7pm' }],
    ['UTC offset', { start: '2026-11-20T19:00:00Z' }],
    ['unknown category', { category: 'sports' }],
    ['empty venue name', { venue: { name: '' } }],
    ['no sources', { sources: [] }],
    ['unknown source', { sources: [{ id: 'yelp', url: 'https://x.com' }] }],
    ['description too long', { description: 'x'.repeat(401) }],
    ['bad id', { id: 'nothex' }],
  ])('rejects %s', (_label, patch) => {
    expect(Event.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
