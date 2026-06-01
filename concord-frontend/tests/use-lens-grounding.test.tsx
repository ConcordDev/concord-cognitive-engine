// Job a+b payoff — useLensGrounding pulls a lens's routed grounding; GroundingRail
// renders it and stays silent when empty. Never throws into render.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api/client', () => ({ api: { post: vi.fn() } }));
import { api } from '@/lib/api/client';
import { GroundingRail } from '@/components/lens/GroundingRail';

describe('GroundingRail / useLensGrounding', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('passes the lens hint to discovery.search and renders the routed grounding', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { ok: true, results: [
        { id: 'grounding_ct_lqr', kind: 'control_theory', title: 'LQR — Linear Quadratic Regulator', snippet: 'optimal feedback…' },
        { id: 'grounding_ct_kalman', kind: 'control_theory', title: 'Kalman filter', snippet: 'optimal estimator…' },
      ] },
    });
    render(<GroundingRail lens="robotics" />);
    await waitFor(() => expect(screen.getByText(/Linear Quadratic Regulator/)).toBeTruthy());
    expect(screen.getByText('Kalman filter')).toBeTruthy();
    // the lens hint is forwarded to the macro
    const call = (api.post as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('/api/lens/run');
    expect(call[1].input.lens).toBe('robotics');
    expect(call[1].input.query).toBe('robotics'); // defaults to lens name
  });

  it('renders nothing when the lens has no grounding yet', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ data: { ok: true, results: [] } });
    const { container } = render(<GroundingRail lens="brand-new-lens" />);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('[data-testid="grounding-rail"]')).toBeNull());
  });

  it('never throws when the macro call rejects', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network'));
    const { container } = render(<GroundingRail lens="math" />);
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(container).toBeTruthy();
  });
});
