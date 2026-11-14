/**
 * FIX-anon-004 — Tor flag percentages read up to 283% because the panel split
 * the summary payload's per-relay "f" field (the FINGERPRINT) into characters
 * and counted hex letters as flags. Pin: percentages come from the details
 * document's real flag names, one count per relay, never above 100%.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/public-lookup', () => ({
  publicLookup: vi.fn(async (key: string) => {
    if (key === 'onionoo-details') {
      return {
        relays: [
          { nickname: 'a', fingerprint: 'AAAA', flags: ['Running', 'Valid', 'Exit'] },
          { nickname: 'b', fingerprint: 'BBBB', flags: ['Running', 'Valid', 'Guard'] },
        ],
      };
    }
    // summary: fingerprints deliberately hex-letter heavy ('E' x40 would read 2000% under the old code)
    return {
      relays_published: '2026-11-13', bridges_published: '2026-11-13',
      relays: [{ n: 'a', f: 'E'.repeat(40) }, { n: 'b', f: 'F'.repeat(40) }],
      bridges: [],
    };
  }),
  carryLookupMeta: (v: unknown) => v,
  lookupMeta: () => undefined,
}));
vi.mock('@/components/dtu/SaveAsDtuButton', () => ({ SaveAsDtuButton: () => null }));

import { TorNetworkStatus } from '@/components/anon/TorNetworkStatus';

describe('FIX-anon-004 — Tor flag distribution', () => {
  it('percentages come from details flags and never exceed 100', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TorNetworkStatus />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Flag distribution (sampled relays)')).toBeTruthy();
    expect(screen.getAllByText('100%')).toHaveLength(2); // Running + Valid on both relays
    expect(screen.getAllByText('50%')).toHaveLength(2); // Exit, Guard on one each
    const pcts = screen.getAllByText(/^\d+%$/).map((el) => parseInt(el.textContent || '0', 10));
    expect(pcts.length).toBeGreaterThan(0);
    expect(Math.max(...pcts)).toBeLessThanOrEqual(100);
  });
});
