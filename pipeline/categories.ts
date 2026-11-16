import type { Category, HideReason } from './schema.ts';

/** fomo event_type -> category. Tags refine the ambiguous types below. */
const FOMO_TYPE: Record<string, Category> = {
  Screening: 'film', 'Watch Party': 'film',
  Exhibition: 'art', 'Immersive Experience': 'art',
  Concert: 'music',
  'Club Night': 'nightlife', Party: 'nightlife',
  'Theater Show': 'theater-dance',
  'Comedy Show': 'comedy',
  Talk: 'talks', 'Discussion Group': 'talks', Conference: 'talks',
  Reading: 'books',
  Tour: 'outdoors', Outing: 'outdoors',
  Fitness: 'fitness', 'Open Practice': 'fitness', Sports: 'fitness', 'Self-Paced Challenge': 'fitness',
  Tasting: 'food-drink', Market: 'community',
  Festival: 'community', 'Community Celebration': 'community', Volunteer: 'community', 'Civic Meeting': 'community',
  Mixer: 'community', 'Open House': 'community', Benefit: 'community', Ceremony: 'community',
  Service: 'community', 'Drop-In Service': 'community', Game: 'community',
  'Pop-Up': 'other', Workshop: 'other', Class: 'other', Other: 'other',
};

const FITNESS_TAGS = new Set(['Fitness', 'Yoga', 'Pilates', 'Vinyasa', 'Strength Training', 'Running', 'Mind-Body', 'Pickleball', 'Meditation', 'Dance Class', 'Cycling', 'Boxing', 'HIIT', 'Barre']);
const POPUP_TAGS = new Set(['Shopping', 'Sampling', 'Brand Activation', 'Giveaway', 'Sale']);

/** Tag-based category for Workshop/Class/Other/Pop-Up types, in priority order. */
const TAG_ORDER: [string, Category][] = [
  ['Kids', 'kids'], ['Storytime', 'kids'],
  ['Literature', 'books'], ['Poetry', 'books'],
  ['Film', 'film'],
  ['Music', 'music'],
  ['Comedy', 'comedy'],
  ['Theater', 'theater-dance'], ['Dance', 'theater-dance'],
  ['Art', 'art'], ['Visual Arts', 'art'], ['Crafts', 'art'], ['Photography', 'art'], ['Design', 'art'],
  ['Food', 'food-drink'], ['Cooking Class', 'food-drink'], ['Tasting', 'food-drink'],
  ['History', 'talks'], ['Science', 'talks'], ['Education', 'talks'],
  ['Nature', 'outdoors'], ['Outdoor', 'outdoors'], ['Gardening', 'outdoors'],
  ['Nightlife', 'nightlife'],
  ['Community', 'community'],
];

export function fomoCategory(eventType: string, tags: string[]): Category {
  const t = new Set(tags);
  const byType = FOMO_TYPE[eventType];
  if (byType === 'fitness') return 'fitness';
  if ((eventType === 'Class' || eventType === 'Workshop') && tags.some(x => FITNESS_TAGS.has(x))) return 'fitness';
  if (byType && byType !== 'other') return byType;
  for (const [tag, cat] of TAG_ORDER) if (t.has(tag)) return cat;
  return 'other';
}

/** Multiplex chains whose regular showtimes are hidden by default (owner's decision, Nov 16).
 *  Independent and repertory houses (Film Forum, Metrograph, IFC, Angelika, Alamo, Nitehawk…) stay visible. */
const CHAIN_DOMAINS = /(^|\.)(regmovies\.com|amctheatres\.com|ipic\.com|cinemark\.com|showcasecinemas\.com|lookcinemas\.com|cinepolisusa\.com)$/i;
const CHAIN_VENUE = /^(regal|amc|ipic|cinemark|showcase|look dine-in|cin[eé]polis)\b/i;

export function isChainCinema(url: string, venue: string): boolean {
  let host = '';
  try { host = new URL(url).hostname; } catch { /* not a url */ }
  return CHAIN_DOMAINS.test(host) || CHAIN_VENUE.test(venue.trim());
}

export function fomoHide(eventType: string, tags: string[], category: Category, url = '', venue = '', title = ''): HideReason[] {
  const out: HideReason[] = [];
  if ((eventType === 'Screening' || category === 'film') && isChainCinema(url, venue)) out.push('chain-cinema');
  if (category === 'fitness') out.push('fitness');
  if (eventType === 'Pop-Up' || (eventType !== 'Market' && tags.some(x => POPUP_TAGS.has(x)))) out.push('brand-popup');
  return out;
}

/** NYC for FREE's own category labels -> category (+ whether it is a brand activation). */
const NFF: Record<string, [Category, boolean]> = {
  Art: ['art', false], Museum: ['art', false], Floral: ['art', false],
  Books: ['books', false], Bookss: ['books', false],
  Music: ['music', false], 'Performance/Dance': ['theater-dance', false],
  'TV/Movies': ['film', false],
  Culture: ['community', false], Community: ['community', false], Parade: ['community', false],
  Holiday: ['community', false], Halloween: ['community', false], 'Party/Festival': ['community', false],
  Expo: ['community', false], Marathon: ['community', false],
  Nature: ['outdoors', false],
  Kids: ['kids', false],
  'Sports/Fitness': ['fitness', false], Yoga: ['fitness', false], Wellness: ['fitness', false],
  // Freebie and brand-activation categories: hidden by default as brand pop-ups.
  Fashion: ['other', true], Beauty: ['other', true], Cars: ['other', true], Pet: ['other', true],
  Technology: ['other', true], Travel: ['other', true], NYFW: ['other', true],
  Food: ['food-drink', true], Drink: ['food-drink', true],
  Other: ['other', false],
};

/** Brand-activation wording in a title (shop events, pop-ups, giveaways, samples). */
const BRAND_COLLAB = /(?<!Malcolm)\s[xX×]\s(?=[A-Z])/; // "Brand X Brand" collaborations
const BRAND_TITLE = /\bpop[- ]?ups?\b|\bshop\b|\bstore\b|\bboutique\b|gift with purchase|\bgiveaways?\b|\bfree samples?\b|\bsampling\b|\bpost (?:&|and) tag\b|\bbrand week\b/i;

/** Activation wording and consumer brands that mark a corporate pop-up rather than a cultural event.
 *  Applied to NYC for FREE titles only; fomo's cultural listings would trip on names like these. */
const ACTIVATION = /\b(experience|takeover|takes over|wonderland|chalet|grand opening|flagship|activation|pop-in|swag|merch drop|free (?:gift|gifts|tote|treats?|drinks?))\b/i;
const BRANDS = /\b(coca-cola|pepsi|walmart|amazon|stanley|etsy|peacock|netflix|hulu|disney\+?|hbo max|paramount\+?|apple tv|prime video|bluey|tamagotchi|samsung|shopify|warby parker|spotify|nike|adidas|lego|sephora|ulta|uniqlo|ikea|starbucks|dunkin|red bull|heineken|bacardi|tito'?s|aperol|hennessy|verizon|t-mobile|at&t|bank of america|citibank|amex|american express|mastercard|uber eats|lyft|doordash|instacart|popmart|pop mart|skullpanda|labubu|harry potter shop|m&m'?s|hershey|oreo|crocs|lululemon|glossier|dyson|mcdonald'?s|chipotle|taco bell|wendy'?s|shake shack|krispy kreme|voodoo doughnut)\b/i;

export function isBrandActivation(title: string): boolean {
  return BRAND_TITLE.test(title) || BRAND_COLLAB.test(title) || ACTIVATION.test(title) || BRANDS.test(title);
}

export function nffCategory(label: string, title = ''): { category: Category; hide: HideReason[] } {
  const [category, popup] = NFF[label.trim()] ?? ['other', false];
  const hide: HideReason[] = [];
  if (category === 'fitness') hide.push('fitness');
  if (popup || isBrandActivation(title)) hide.push('brand-popup');
  return { category, hide };
}

/** Keyword guess for newsletter entries, which carry no category of their own. */
const KEYWORDS: [RegExp, Category][] = [
  [/\b(film|films|screening|cinema|movie|documentary|retrospective)\b/i, 'film'],
  [/\b(book|books|reading|poetry|poet|author|novel|literary|launch|bookstore|library)\b/i, 'books'],
  [/\b(talk|lecture|panel|conversation|discussion|q&a|symposium|seminar)\b/i, 'talks'],
  [/\b(comedy|comedian|stand-?up|improv|funny)\b/i, 'comedy'],
  [/\b(concert|jazz|band|orchestra|symphony|choir|dj|music|songs|recital|opera)\b/i, 'music'],
  [/\b(theater|theatre|play|dance|ballet|musical|cabaret|burlesque|drag)\b/i, 'theater-dance'],
  [/\b(exhibition|exhibit|gallery|museum|art|artist|opening|sculpture|photography)\b/i, 'art'],
  [/\b(market|fair|festival|parade|block party|pop-up|swap)\b/i, 'community'],
  [/\b(food|tasting|wine|beer|cocktail|dinner|brunch|dumpling|pizza)\b/i, 'food-drink'],
  [/\b(walk|walking tour|tour|park|garden|hike|bike|outdoor)\b/i, 'outdoors'],
  [/\b(kids|family|children)\b/i, 'kids'],
  [/\b(yoga|pilates|run club|workout|fitness)\b/i, 'fitness'],
  [/\b(party|club|rave|dance party)\b/i, 'nightlife'],
];

export function guessCategory(text: string, fallback: Category = 'other'): Category {
  for (const [re, cat] of KEYWORDS) if (re.test(text)) return cat;
  return fallback;
}

/** Hide rules for newsletter entries (editorial picks are rarely brand pop-ups). */
export function newsletterHide(category: Category): HideReason[] {
  return category === 'fitness' ? ['fitness'] : [];
}
