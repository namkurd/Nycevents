/**
 * Headless Chromium for the two sources that need a real browser (Oh My Rockness, Thought Gallery).
 * Playwright is preinstalled in the cloud environment and resolved through NODE_PATH, so it is
 * loaded with require() rather than an ESM import. Never install another Playwright version.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

// Minimal shapes of the Playwright API used here.
export interface PwResponse { url(): string; status(): number; json(): Promise<unknown> }
export interface PwPage {
  goto(url: string, o?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  content(): Promise<string>;
  title(): Promise<string>;
  waitForTimeout(ms: number): Promise<void>;
  on(ev: 'response', fn: (r: PwResponse) => void): void;
}

export async function withPage<T>(fn: (page: PwPage) => Promise<T>): Promise<T> {
  let chromium: { launch(): Promise<{ newContext(o: object): Promise<{ newPage(): Promise<PwPage> }>; close(): Promise<void> }> };
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright is not available in this environment');
  }
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ userAgent: UA });
    return await fn(await ctx.newPage());
  } finally {
    await browser.close();
  }
}

/** True when the page is a bot-check interstitial rather than the site. We skip, never work around it. */
export function isChallenge(title: string, html: string): boolean {
  return /just a moment|attention required|security verification/i.test(title) || /cf-challenge|challenge-platform\/h\/[a-z]\/orchestrate/i.test(html.slice(0, 20000));
}
