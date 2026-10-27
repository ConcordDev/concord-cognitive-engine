/**
 * source-profile with no bias terms returns null lean/score.
 * The chip must not read "null lean (null)".
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('lucide-react', () => ({
  Loader2: () => null,
  ShieldCheck: () => null,
  BadgeCheck: () => null,
  AlertTriangle: () => null,
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async (_domain: string, name: string) => {
    if (name === 'channel-list') {
      return { data: { ok: true, result: { channels: [{ source: 'Wire', articleCount: 1 }] } } };
    }
    return {
      data: {
        ok: true,
        result: {
          source: 'Wire',
          articleCount: 1,
          contributors: 1,
          biasLean: null,
          biasScore: null,
          biasReason: 'no_bias_terms',
          factualityRating: 70,
          factualityLabel: 'mixed',
          transparency: { summaryRate: 0, hedgeRate: 0 },
          topicSpread: [],
        },
      },
    };
  }),
}));

import { NewsSourceTransparency } from './NewsSourceTransparency';

describe('NewsSourceTransparency', () => {
  it('says the lean is not measurable when bias terms are absent', async () => {
    render(<NewsSourceTransparency />);
    fireEvent.click(await screen.findByRole('button', { name: /Wire/ }));
    expect(await screen.findByText('lean not measurable (no bias terms)')).toBeInTheDocument();
    expect(screen.queryByText(/null lean/)).not.toBeInTheDocument();
  });
});
