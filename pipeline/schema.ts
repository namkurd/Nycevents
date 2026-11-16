import { z } from 'zod';

export const SOURCE_IDS = [
  'fomo', 'nycforfree', 'skint', 'cityhappenings', 'readingthecity',
  'fieldnotes', 'ohmyrockness', 'thoughtgallery', 'curated',
] as const;
export const SourceId = z.enum(SOURCE_IDS);
export type SourceId = z.infer<typeof SourceId>;

/** Sources whose inclusion of an event counts as an editorial pick. */
export const PICK_SOURCES: SourceId[] = [
  'nycforfree', 'skint', 'cityhappenings', 'readingthecity', 'fieldnotes', 'ohmyrockness', 'thoughtgallery',
];

export const CATEGORIES = [
  'art', 'film', 'music', 'talks', 'books', 'theater-dance', 'comedy',
  'food-drink', 'outdoors', 'community', 'nightlife', 'kids', 'fitness', 'other',
] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

/** Reasons an event is hidden unless the viewer turns the group back on. */
export const HIDE_REASONS = ['fitness', 'brand-popup', 'chain-cinema'] as const;
export const HideReason = z.enum(HIDE_REASONS);
export type HideReason = z.infer<typeof HideReason>;

const isoDateTime = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export const Event = z.object({
  id: z.string().regex(/^[0-9a-f]{12}$/),
  title: z.string().min(1),
  description: z.string().max(400).optional(),
  start: z.string().regex(isoDateTime),
  end: z.string().regex(isoDateTime).optional(),
  allDay: z.boolean(),
  ongoing: z.object({ from: z.string().regex(isoDate), to: z.string().regex(isoDate) }).optional(),
  venue: z.object({
    name: z.string().min(1),
    address: z.string().optional(),
    lat: z.number().min(40.3).max(41.2).optional(),
    lng: z.number().min(-74.5).max(-73.4).optional(),
    borough: z.string().optional(),
  }),
  category: Category,
  price: z.object({ free: z.boolean().nullable(), text: z.string().optional() }),
  rsvp: z.object({ required: z.boolean(), opensAt: z.string().optional() }).optional(),
  url: z.string().url(),
  ticketsUrl: z.string().url().optional(),
  sources: z.array(z.object({ id: SourceId, url: z.string().url() })).min(1),
  pickedBy: z.array(SourceId),
  tags: z.array(z.string()),
  hide: z.array(HideReason).optional(),
  transit: z.object({ tier: z.union([z.literal(1), z.literal(2)]), routes: z.array(z.string()), walkM: z.number() }).optional(),
  homeKm: z.number().optional(),
  score: z.number(),
});
export type Event = z.infer<typeof Event>;

/** What a collector returns before ids, transit and scores are filled in. */
export type RawEvent = Omit<Event, 'id' | 'score' | 'transit' | 'homeKm'>;

export interface CollectResult {
  source: SourceId;
  events: RawEvent[];
  /** Lines/blocks a rule-based parser could not read; written to data/inbox/. */
  unparsed?: { postUrl: string; title: string; range?: string; text: string }[];
  notes?: string[];
}
