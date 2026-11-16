/**
 * Prices stated in a listing's own text. Only explicit statements count: a dollar amount next to
 * ticket wording ("Tickets: $20", "$10 suggested donation", "$15 advance / $20 door"), or plain
 * free-admission wording. A bare "$5 drinks" or "$100 prize" is ignored, and nothing is guessed.
 */
const AMOUNT = String.raw`\$\d{1,3}(?:\.\d{2})?(?:\s*(?:-|–|to)\s*\$?\d{1,3}(?:\.\d{2})?)?`;
const WORD = String.raw`(?:tickets?|admission|entry|entrance|cover(?: charge)?|suggested donation|donation|general admission|ga|advance|adv|at the door|door|registration|per person|in advance|presale|students?)`;
const BEFORE = new RegExp(String.raw`\b(?:tickets?|admission|entry|cover(?: charge)?|cost|prices?|suggested donation|general admission|registration|fee)\b\s*(?:are|is|:|-|–|from|start(?:ing)? at|of)?\s*(${AMOUNT}(?:\s*(?:\/|,|or)?\s*(?:${AMOUNT})\s*${WORD})?)`, 'i');
const AFTER = new RegExp(String.raw`(${AMOUNT})\s*(?:\+\s*fees?\s*)?\b${WORD}\b(?:\s*(?:\/|,|;|and)\s*${AMOUNT}\s*\b${WORD}\b)?`, 'i');
const FREE = /\b(?:free (?:admission|entry|and open to the public|event|to attend|with rsvp|for all|of charge)|admission is free|entry is free|no cover)\b/i;

export interface StatedPrice { free: boolean | null; text: string }

/** Fill in a price from the listing's own text when it has none (a source's free tag wins over a dollar amount). */
export function withStatedPrice<T extends { price: { free: boolean | null; text?: string } }>(e: T, text: string | undefined): T {
  if (e.price.text) return e;
  const p = priceFromText(text);
  if (p && !(e.price.free === true && p.free === null)) e.price = { free: e.price.free ?? p.free, text: p.text };
  return e;
}

export function priceFromText(text: string | undefined): StatedPrice | null {
  if (!text) return null;
  const m = text.match(BEFORE) ?? text.match(AFTER);
  if (m) {
    const t = m[0].replace(/\s+/g, ' ').trim().replace(/[,;:.]$/, '');
    return { free: null, text: t[0].toUpperCase() + t.slice(1) };
  }
  if (FREE.test(text)) return { free: true, text: 'Free' };
  return null;
}
