// Job a+b payoff — useLensGrounding pulls a lens's routed grounding; GroundingRail
// renders it and stays silent when empty. Never throws into render.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const lensRun = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ lensRun }));
import { GroundingRail } from '@/components/lens/GroundingRail';

describe('GroundingRail / useLensGrounding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('passes the lens hint to discovery.search and renders the routed grounding', async () => {
    lensRun.mockResolvedValue({
      data: {
        ok: true,
        result: {
          ok: true,
          results: [
            { id: 'grounding_ct_lqr', kind: 'control_theory', title: 'LQR — Linear Quadratic Regulator', snippet: 'optimal feedback…' },
            { id: 'grounding_ct_kalman', kind: 'control_theory', title: 'Kalman filter', snippet: 'optimal estimator…' },
          ],
        },
      },
    });
    render(<GroundingRail lens="robotics" />);
    await waitFor(() => expect(screen.getByText(/Linear Quadratic Regulator/)).toBeTruthy());
    expect(screen.getByText('Kalman filter')).toBeTruthy();
    // the lens hint is forwarded to the macro through the canonical lensRun path
    const call = lensRun.mock.calls[0];
    expect(call[0]).toBe('discovery');
    expect(call[1]).toBe('search');
    expect(call[2].lens).toBe('robotics');
    expect(call[2].query).toBe('robotics'); // defaults to lens name
  });

  it('renders nothing when the lens has no grounding yet', async () => {
    lensRun.mockResolvedValue({ data: { ok: true, result: { ok: true, results: [] } } });
    const { container } = render(<GroundingRail lens="brand-new-lens" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="grounding-rail"]')).toBeNull());
  });

  it('never throws when the macro call rejects', async () => {
    lensRun.mockRejectedValue(new Error('network'));
    const { container } = render(<GroundingRail lens="math" />);
    await waitFor(() => expect(lensRun).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });
});
