import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';

vi.mock('lucide-react', async () => {
  const makeMockIcon = (name: string) => {
    const Icon = React.forwardRef<SVGSVGElement, Record<string, unknown>>((props, ref) =>
      React.createElement('span', { 'data-testid': `icon-${name}`, ref, ...props })
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    __esModule: true,
    Heart: makeMockIcon('Heart'),
    AlertTriangle: makeMockIcon('AlertTriangle'),
    ShieldCheck: makeMockIcon('ShieldCheck'),
  };
});

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  __esModule: true,
  api: { post: (...args: unknown[]) => post(...args) },
}));

import { WorldHealthBadge } from '@/components/hud/WorldHealthBadge';

/**
 * Regression pin: `api.post()` resolves (never throws) even on a failed
 * macro call — a 401/500/503 or `{ok:false}` response has no `perDetector`.
 * The component used to do `setSummary(s.data as SummaryResponse)`
 * unconditionally, then `summary?.perDetector.find(...)` — the `?.` only
 * guarded `summary` being null, not `perDetector` being missing, so a
 * malformed response threw `Cannot read properties of undefined (reading
 * 'find')` and crashed the ENTIRE World Lens via the lens-wide error
 * boundary (verified live: a genuine 401/503 from the detectors macro took
 * down the whole page, not just this HUD badge). Fixed to only accept a
 * well-formed `{ok:true, perDetector: [...]}` shape.
 */
describe('WorldHealthBadge', () => {
  beforeEach(() => {
    post.mockReset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the healthy badge on a well-formed empty-findings response', async () => {
    post
      .mockResolvedValueOnce({ data: { ok: true, generatedAt: new Date().toISOString(), detectorCount: 2, totals: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, perDetector: [] } })
      .mockResolvedValueOnce({ data: { ok: true, findings: [] } });

    render(<WorldHealthBadge />);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('icon-ShieldCheck')).toBeInTheDocument();
  });

  it('does not crash and stays in the loading/neutral state when the summary call returns a malformed {ok:false} response (the historical bug)', async () => {
    post
      .mockResolvedValueOnce({ data: { ok: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' } })
      .mockResolvedValueOnce({ data: { ok: false, error: 'Unauthorized' } });

    expect(() => render(<WorldHealthBadge />)).not.toThrow();

    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));

    // Never crashed → still renders the neutral/healthy badge (0 critical, 0
    // high is the safe default when no real summary was ever accepted).
    expect(screen.getByTestId('icon-ShieldCheck')).toBeInTheDocument();
  });

  it('does not crash when the summary call resolves with no body at all', async () => {
    post.mockResolvedValueOnce({ data: undefined }).mockResolvedValueOnce({ data: undefined });
    expect(() => render(<WorldHealthBadge />)).not.toThrow();
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('icon-ShieldCheck')).toBeInTheDocument();
  });

  it('shows the critical/high count and colour once a well-formed response with findings lands', async () => {
    post
      .mockResolvedValueOnce({
        data: {
          ok: true,
          generatedAt: new Date().toISOString(),
          detectorCount: 2,
          totals: { total: 3, critical: 1, high: 2, medium: 0, low: 0, info: 0 },
          perDetector: [
            { id: 'invariant-guardian', ok: false, summary: { total: 2, critical: 1, high: 1, medium: 0, low: 0, info: 0 }, durationMs: 5 },
            { id: 'secret-leak', ok: false, summary: { total: 1, critical: 0, high: 1, medium: 0, low: 0, info: 0 }, durationMs: 3 },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          ok: true,
          findings: [
            { detector: 'invariant-guardian', id: 'f1', severity: 'critical', message: 'bad thing' },
            { detector: 'secret-leak', id: 'f2', severity: 'high', message: 'leaky thing' },
          ],
        },
      });

    render(<WorldHealthBadge />);

    await waitFor(() => expect(screen.getByText('1!2')).toBeInTheDocument());
    expect(screen.getByTestId('icon-AlertTriangle')).toBeInTheDocument();
  });

  it('toggles the detail flyout open and closed on click', async () => {
    post
      .mockResolvedValue({ data: { ok: true, generatedAt: new Date().toISOString(), detectorCount: 0, totals: { total: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0 }, perDetector: [] } });

    render(<WorldHealthBadge />);
    await waitFor(() => expect(post).toHaveBeenCalled());

    expect(screen.queryByText('World Health')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(screen.getByText('World Health')).toBeInTheDocument();
    expect(screen.getByText('No invariant warnings.')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('×'));
    });
    expect(screen.queryByText('World Health')).not.toBeInTheDocument();
  });
});
