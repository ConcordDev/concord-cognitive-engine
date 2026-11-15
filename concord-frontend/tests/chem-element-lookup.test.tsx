/**
 * FIX-chem-006 — the element lookup rendered the server summary (which already
 * embeds the uses and history text) AND the structured Uses/history lines, so
 * both repeated. Pin: each appears exactly once, and the header carries the
 * group/period facts the summary used to provide.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const PROFILE = {
  name: 'Nitrogen', symbol: 'N', z: 7, group: 15, period: 2, category: 'nonmetal',
  atomicMass: 14.007, uses: ['ammonia', 'fertilizer', 'cryogenics'],
  history: 'Isolated by Rutherford 1772.',
  summary: 'Nitrogen (N, Z=7): nonmetal, group 15, period 2. Uses: ammonia, fertilizer, cryogenics. Isolated by Rutherford 1772.',
};

vi.mock('@/lib/api/client', () => ({
  apiHelpers: {
    lens: {
      runDomain: vi.fn(async () => ({ data: { ok: true, result: PROFILE } })),
    },
  },
}));

import { ChemSafetyPanel } from '@/components/chem/ChemSafetyPanel';

describe('FIX-chem-006 — element lookup renders uses/history once', () => {
  it('shows Uses and the isolation line exactly once each', async () => {
    render(<ChemSafetyPanel />);
    fireEvent.click(screen.getByRole('button', { name: /Element Lookup/ }));
    const input = screen.getByPlaceholderText(/Fe|iron/i);
    fireEvent.change(input, { target: { value: 'N' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(await screen.findByText('Nitrogen')).toBeTruthy();
    expect(screen.getAllByText(/Uses:/)).toHaveLength(1);
    expect(screen.getAllByText(/Isolated by Rutherford 1772/)).toHaveLength(1);
    expect(screen.getByText(/group 15, period 2/)).toBeTruthy();
  });
});
