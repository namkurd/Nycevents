import { z } from 'zod';

export const SOURCE_IDS = [
  'fomo', 'nycforfree', 'skint', 'cityhappenings', 'readingthecity',
  'fieldnotes', 'ohmyrockness', 'thoughtgallery', 'curated',
] as const;
export const SourceId = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceId>;

export const CATEGORIES = [
  'art', 'film', 'music', 'talks', 'books', 'theater-dance', 'comedy',
  'food-drink', 'outdoors', 'community', 'nightlife', 'kids', 'fitness', 'other',
] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

// '2026-11-20' or '2026-11-20T19:00:00-05:00' (NY offset is -05:00 or -04:00).
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[45]:00$/;
export const LocalTime = z.string().refine((s) => DATE.test(s) || DATETIME.test(s), {
  message: 'expected YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS-05:00/-04:00',
});

const Url = z.string().url().refine((u) => /^https?:\/\//.test(u), { message: 'http(s) url' });

export const Venue = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  borough: z.string().optional(),
});

export const Event = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  title: z.string().min(1),
  description: z.string().max(400).optional(),
  start: LocalTime,
  end: LocalTime.optional(),
  allDay: z.boolean(),
  ongoing: z.object({ from: LocalTime, to: LocalTime }).optional(),
  venue: Venue,
  category: Category,
  price: z.object({ free: z.boolean().nullable(), text: z.string().optional() }),
  rsvp: z.object({ required: z.boolean(), opensAt: LocalTime.optional() }).optional(),
  url: Url,
  ticketsUrl: Url.optional(),
  sources: z.array(z.object({ id: SourceId, url: Url })).min(1),
  pickedBy: z.array(SourceId),
  tags: z.array(z.string()),
  transit: z.object({
    tier: z.union([z.literal(1), z.literal(2)]),
    routes: z.array(z.string()),
    walkM: z.number().nonnegative(),
  }).optional(),
  homeKm: z.number().nonnegative().optional(),
  score: z.number(),
});
export type Event = z.infer<typeof Event>;

/** What collectors return: everything but the fields computed later in the pipeline. */
export type RawEvent = Omit<Event, 'id' | 'score' | 'transit' | 'homeKm'>;

export const WeekFile = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/),
  generatedAt: z.string(),
  events: z.array(Event),
  ongoing: z.array(Event),
});
export type WeekFile = z.infer<typeof WeekFile>;
