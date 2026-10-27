/**
 * source-profile with no bias terms returns null lean/score and a reason.
 * The chip must say "Not available" with the plain reason, never
 * "null lean (null)" or the raw code.
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
  it('says Not available with the plain reason when bias terms are absent', async () => {
    const { container } = render(<NewsSourceTransparency />);
    fireEvent.click(await screen.findByRole('button', { name: /Wire/ }));
    expect(
      await screen.findByText('Not available: no loaded or hedge words found in the text'),
    ).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/\bnull\b|undefined|NaN|no_bias_terms/);
  });
});
