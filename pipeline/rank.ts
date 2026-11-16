import type { Event } from './schema.ts';

/**
 * score = 3·|pickedBy| + 1 if free + 1 if transit tier 1 + 0.5 if tier 2 + 0.5 if homeKm < 3.
 * Proximity is a nudge: one newsletter pick (3) outweighs every transit bonus combined (2).
 */
export function score(e: Pick<Event, 'pickedBy' | 'price' | 'transit' | 'homeKm'>): number {
  let s = 3 * e.pickedBy.length;
  if (e.price.free) s += 1;
  if (e.transit?.tier === 1) s += 1;
  else if (e.transit?.tier === 2) s += 0.5;
  if (e.homeKm != null && e.homeKm < 3) s += 0.5;
  return s;
}

export const isPick = (e: Pick<Event, 'pickedBy'>) => e.pickedBy.length > 0;
