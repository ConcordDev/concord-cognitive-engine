/**
 * Platform Nerve Center → Brain Health.
 *
 * The online fraction used to be `{onlineCount}/4`. Five brains (the vision
 * brain included) rendered as "Online: 5/4", and the pre-payload state
 * rendered as "Mode: unknown | Online: 0/4".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import BrainHealthPanel from '@/components/brain/BrainHealthPanel';

function brain(enabled: boolean, role: string) {
  return {
    enabled,
    model: '',
    role,
    avgResponseMs: 12,
    stats: { requests: 1, totalMs: 12, dtusGenerated: 0, errors: 0, lastCallAt: null },
  };
}

const FIVE = {
  conscious: brain(true, 'chat'),
  subconscious: brain(true, 'autogen'),
  utility: brain(true, 'lens'),
  repair: brain(true, 'repair'),
  multimodal: brain(true, 'vision'),
};

describe('BrainHealthPanel', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state before status arrives, not a fake 0/4', () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    render(<BrainHealthPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/loading brain health/i);
    expect(screen.queryByText(/0\/4/)).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.queryByText(/online:/i)).toBeNull();
  });

  it('counts online brains from the payload list, including the fifth brain', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'five_brain',
        onlineCount: 5,
        brains: FIVE,
      }),
    });

    render(<BrainHealthPanel />);

    await waitFor(() => {
      expect(screen.getByText(/online:/i).textContent).toContain('5/5');
    });
    const line = screen.getByText(/online:/i).textContent || '';
    expect(line).toContain('five_brain');
    expect(line).not.toContain('/4');
    expect(line).not.toContain('5/4');
    expect(screen.getByRole('heading', { name: 'Multimodal' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Conscious' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Repair' })).toBeTruthy();
  });

  it('uses the list length when only some of the five brains are enabled', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        mode: 'partial',
        onlineCount: 3,
        brains: {
          ...FIVE,
          repair: brain(false, 'repair'),
          multimodal: brain(false, 'vision'),
        },
      }),
    });

    render(<BrainHealthPanel />);

    await waitFor(() => {
      expect(screen.getByText(/online:/i).textContent).toContain('3/5');
    });
    expect(screen.getByText(/online:/i).textContent).not.toContain('/4');
  });

  it('does not invent a ratio when the request fails before any snapshot', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    render(<BrainHealthPanel />);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/brain health unavailable/i);
    });
    expect(screen.queryByText(/0\/4/)).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it('says no data yet when a snapshot arrives with an empty brain list', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ mode: 'fallback', onlineCount: 0, brains: {} }),
    });
    render(<BrainHealthPanel />);
    await waitFor(() => {
      expect(screen.getByText(/online:/i).textContent).toContain('no data yet');
    });
    expect(screen.getByText(/online:/i).textContent).not.toMatch(/0\/0/);
    expect(screen.getByText(/online:/i).textContent).not.toContain('%');
  });
});
