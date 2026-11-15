/**
 * UX Suite facts for the Chat analyst (FIX-ux-suite-005).
 *
 * Arriving with ?context=ux-suite used to give the analyst a label and no
 * data — buildLensFactsBlock had providers for analytics and conkay only,
 * so every other domain, this one included, returned an empty block and
 * the model answered ungrounded. These tests pin the ux-suite provider's
 * contract:
 *   GROUNDED — catalog counts and the caller's starred components come
 *              from the workbench's own reads (ux-suite.catalog /
 *              ux-suite.favourites-list), each citing its endpoint.
 *   ZERO IS A FACT — no starred components is stated, never missing.
 *   FAILURE NAMES ITSELF — an unreadable read is named, never zero-filled.
 *   TOTAL FAILURE DECLINES — no facts at all ⇒ a decline block.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const lensRunMock = vi.fn();

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn() },
  apiHelpers: { dtus: { myDtus: vi.fn() } },
  lensRun: (...a: unknown[]) => lensRunMock(...a),
}));
vi.mock('@/lib/utils', () => ({
  formatNumber: (n: number) => n.toLocaleString('en-US'),
}));

import { buildLensFactsBlock } from '@/components/chat/lensAccountFacts';

const CATALOG = {
  components: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  groups: [
    { id: 'settings', label: 'Settings', count: 2 },
    { id: 'world', label: 'World', count: 1 },
  ],
  source: 'code-derived catalog v3',
};

function wire(catalog: unknown, favourites: string[]) {
  lensRunMock.mockImplementation((_domain: string, action: string) => {
    if (action === 'catalog') return Promise.resolve({ data: { ok: true, result: catalog } });
    if (action === 'favourites-list') return Promise.resolve({ data: { ok: true, result: { favourites } } });
    return Promise.resolve({ data: { ok: true, result: {} } });
  });
}

describe('buildLensFactsBlock — ux-suite grounding (FIX-ux-suite-005)', () => {
  beforeEach(() => {
    lensRunMock.mockReset();
  });

  it('composes catalog + starred facts from the workbench substrate, with sources', async () => {
    wire(CATALOG, ['SaveSystem', 'DailyRituals']);
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('ACCOUNT FACTS — UX Suite');
    expect(block).toContain('Catalogued components: 3 components across 2 groups — Settings 2, World 1');
    expect(block).toContain('ux-suite.catalog');
    expect(block).toContain('Catalog source: code-derived catalog v3');
    expect(block).toContain('Your starred components: 2 starred: “SaveSystem”, “DailyRituals”');
    expect(block).toContain('ux-suite.favourites-list');
  });

  it('reads the workbench verbatim calls (domain ux-suite, catalog + favourites-list)', async () => {
    wire(CATALOG, []);
    await buildLensFactsBlock('ux-suite');
    const actions = lensRunMock.mock.calls.map((c) => `${c[0]}.${c[1]}`);
    expect(actions).toEqual(['ux-suite.catalog', 'ux-suite.favourites-list']);
  });

  it('states zero starred as a fact, never as missing', async () => {
    wire(CATALOG, []);
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('Your starred components: None starred yet.');
  });

  it('a failed read is named as unreadable — never zero-filled', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'catalog') return Promise.reject(new Error('down'));
      return Promise.resolve({ data: { ok: true, result: { favourites: ['SaveSystem'] } } });
    });
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('Your starred components: 1 starred');
    expect(block).toContain('Not readable just now: Component catalog (ux-suite.catalog)');
    expect(block).not.toContain('Catalogued components: 0');
  });

  it('an ok:false catalog envelope is unreadable, not an empty catalog', async () => {
    lensRunMock.mockImplementation((_domain: string, action: string) => {
      if (action === 'catalog') return Promise.resolve({ data: { ok: false, result: null } });
      return Promise.resolve({ data: { ok: true, result: { favourites: [] } } });
    });
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('Not readable just now: Component catalog (ux-suite.catalog)');
  });

  it('total read failure yields a decline block, not an estimate', async () => {
    lensRunMock.mockRejectedValue(new Error('down'));
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('UX Suite could not be read just now');
    expect(block).toContain('never estimate or invent a number');
  });

  it('carries the ux-suite decline rule (answer only from the facts)', async () => {
    wire(CATALOG, []);
    const block = await buildLensFactsBlock('ux-suite');
    expect(block).toContain('answer questions about this lens ONLY from the facts above');
  });
});
