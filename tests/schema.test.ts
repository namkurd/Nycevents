import { describe, expect, it } from 'vitest';
import { Event } from '../pipeline/schema.ts';
import { parseClock, parseClockRange, nyIso, resolveMonthDay } from '../pipeline/lib/time.ts';
import { fomoCategory, fomoHide, isChainCinema, nffCategory } from '../pipeline/categories.ts';

const valid = {
  id: 'abcdef012345',
  title: 'Gallery talk',
  start: '2026-11-20T19:00:00-05:00',
  allDay: false,
  venue: { name: 'Whitney Museum', lat: 40.7396, lng: -74.0089 },
  category: 'talks',
  price: { free: true },
  url: 'https://whitney.org/events/x',
  sources: [{ id: 'fomo', url: 'https://whitney.org/events/x' }],
  pickedBy: [],
  tags: [],
  score: 0,
};

describe('Event schema', () => {
  it('accepts a well-formed event', () => {
    expect(Event.safeParse(valid).success).toBe(true);
  });
  it('rejects a malformed event', () => {
    expect(Event.safeParse({ ...valid, url: 'not a url' }).success).toBe(false);
    expect(Event.safeParse({ ...valid, start: 'Friday 7pm' }).success).toBe(false);
    expect(Event.safeParse({ ...valid, venue: { name: '' } }).success).toBe(false);
    expect(Event.safeParse({ ...valid, category: 'sports' }).success).toBe(false);
    expect(Event.safeParse({ ...valid, venue: { name: 'X', lat: 51.5, lng: -0.1 } }).success).toBe(false);
  });
});

describe('time helpers', () => {
  it('parses clock times and ranges', () => {
    expect(parseClock('7pm')).toBe('19:00');
    expect(parseClock('10:30am')).toBe('10:30');
    expect(parseClock('12pm')).toBe('12:00');
    expect(parseClock('12am')).toBe('00:00');
    expect(parseClock('noon')).toBe('12:00');
    expect(parseClockRange('6-9pm')).toEqual({ start: '18:00', end: '21:00' });
    expect(parseClockRange('6—7:30pm')).toEqual({ start: '18:00', end: '19:30' });
    expect(parseClockRange('11am-5pm')).toEqual({ start: '11:00', end: '17:00' });
    expect(parseClockRange('11-1pm')).toEqual({ start: '11:00', end: '13:00' });
  });
  it('uses the right New York offset across DST', () => {
    expect(nyIso('2026-11-20', '19:00')).toBe('2026-11-20T19:00:00-05:00');
    expect(nyIso('2026-07-04', '21:00')).toBe('2026-07-04T21:00:00-04:00');
  });
  it('resolves a month/day to the nearest year', () => {
    expect(resolveMonthDay(1, 3, '2026-12-20')).toBe('2027-01-03');
    expect(resolveMonthDay(11, 9, '2026-11-15')).toBe('2026-11-09');
  });
});

describe('categories and hide rules', () => {
  it('hides fitness classes and brand pop-ups', () => {
    expect(fomoCategory('Class', ['Yoga', 'Wellness'])).toBe('fitness');
    expect(fomoHide('Class', ['Yoga'], 'fitness')).toEqual(['fitness']);
    expect(fomoHide('Pop-Up', ['Fashion'], 'other')).toEqual(['brand-popup']);
    expect(fomoHide('Market', ['Shopping'], 'community')).toEqual([]);
    expect(nffCategory('Beauty').hide).toEqual(['brand-popup']);
    expect(nffCategory('Museum')).toEqual({ category: 'art', hide: [] });
    expect(nffCategory('Kids', 'Toybox 3D Printer Pop-Up Event').hide).toEqual(['brand-popup']);
    expect(nffCategory('Books', 'Harry Potter Shop Celebrates the Holiday Season').hide).toEqual(['brand-popup']);
    expect(nffCategory('Holiday', 'Holiday Under the Stars: Columbus Circle').hide).toEqual([]);
    expect(nffCategory('Community', 'REBEL Deal Bodega X Shopify').hide).toEqual(['brand-popup']);
    expect(nffCategory('Culture', 'Malcolm X Day Celebration').hide).toEqual([]);
    expect(nffCategory('Art', 'Ceramics 6 x 6 show').hide).toEqual([]);
    for (const t of ['The Coca-Cola Holiday Truck', "Walmart's Holiday Wonderland", 'Stanley 1913 Museum of Adventure', 'Etsy Creative Chalet', "Bluey's Aussie Christmas", 'Peacock Pillow Fort', 'Burger Village Fresh Meadows Grand Opening'])
      expect(nffCategory('Holiday', t).hide, t).toEqual(['brand-popup']);
    for (const t of ['Madison Square Park Holiday Tree Lighting', "100th Macy's Thanksgiving Day Parade", 'Books & Bouquets Nov 18', 'Astronomy on Tap NYC: Sky News & Views!'])
      expect(nffCategory('Holiday', t).hide, t).toEqual([]);
  });
  it('hides chain multiplex showtimes but not independent cinemas', () => {
    expect(fomoHide('Screening', ['Film'], 'film', 'https://www.regmovies.com/movies/x', 'Regal Union Square')).toEqual(['chain-cinema']);
    expect(fomoHide('Screening', ['Film'], 'film', 'https://www.amctheatres.com/movies/x', 'AMC Lincoln Square 13')).toEqual(['chain-cinema']);
    expect(isChainCinema('https://filmforum.org/film/x', 'Film Forum')).toBe(false);
    expect(isChainCinema('https://drafthouse.com/nyc/show/x', 'Alamo Drafthouse Cinema Brooklyn')).toBe(false);
    expect(isChainCinema('https://www.metrograph.com/film/x', 'Metrograph')).toBe(false);
    expect(fomoHide('Talk', ['Film'], 'talks', 'https://www.amctheatres.com/x', 'AMC 34th Street')).toEqual([]);
    expect(fomoHide('Concert', ['Music'], 'music', 'https://example.org', 'Carnegie Hall', 'Max Richter: Sleep')).toEqual([]);
    expect(fomoHide('Talk', ['Film'], 'talks', 'https://example.org', 'MoMI', 'Stanley Kubrick at 100')).toEqual([]);
  });
  it('maps fomo types and tags', () => {
    expect(fomoCategory('Screening', ['Film'])).toBe('film');
    expect(fomoCategory('Workshop', ['Crafts', 'Art'])).toBe('art');
    expect(fomoCategory('Class', ['Kids', 'Music'])).toBe('kids');
  });
});
