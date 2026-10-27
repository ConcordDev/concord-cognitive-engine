// Pins useLensSession's canonical lensRun path. The local runMacro helper now
// routes through lensRun, which already unwraps the POST /api/lens/run envelope
// into { data: { ok, result, error } }. The hook reads the macro's own fields
// from result, so genuine backend successes surface and macro-level failures
// propagate their reason.
//
// Real-world impact: WarCampaignSession (kingdoms lens) can start, advance, and
// resolve a war campaign without the old fabricated-success envelope bug.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLensSession } from '@/hooks/useLensSession';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...a: unknown[]) => lensRun(...a),
}));

describe('useLensSession — lensRun envelope', () => {
  beforeEach(() => {
    lensRun.mockReset();
  });

  it('start() reads the session from the unwrapped result', async () => {
    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          ok: true,
          session: {
            id: 'sess_1', userId: 'u1', lensId: 'kingdoms', title: 'War campaign · Iron Crown',
            status: 'open', currentStep: 'declare', state: { kingdomId: 'k1' },
            stepCount: 0, createdAt: 1000, updatedAt: 1000, closedAt: null,
          },
        },
      },
    });

    const { result } = renderHook(() => useLensSession({ lensId: 'kingdoms' }));

    let started: unknown;
    await act(async () => {
      started = await result.current.start({ title: 'War campaign · Iron Crown', initialStep: 'declare' });
    });

    expect(started).toMatchObject({ id: 'sess_1', status: 'open', currentStep: 'declare' });
    await waitFor(() => {
      expect(result.current.session?.id).toBe('sess_1');
      expect(result.current.error).toBeNull();
    });
  });

  it('start() surfaces the macro-level failure reason, not a swallowed generic', async () => {
    lensRun.mockResolvedValueOnce({
      data: { ok: true, result: { ok: false, reason: 'missing_lens_id' } },
    });

    const { result } = renderHook(() => useLensSession({ lensId: '' }));

    await act(async () => {
      await result.current.start({});
    });

    await waitFor(() => {
      expect(result.current.session).toBeNull();
      expect(result.current.error).toBe('missing_lens_id');
    });
  });

  it('advance() applies the real next step from the unwrapped result', async () => {
    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          ok: true,
          session: {
            id: 'sess_1', userId: 'u1', lensId: 'kingdoms', title: 'War campaign',
            status: 'open', currentStep: 'declare', state: {},
            stepCount: 0, createdAt: 1000, updatedAt: 1000, closedAt: null,
          },
        },
      },
    });
    const { result } = renderHook(() => useLensSession({ lensId: 'kingdoms' }));
    await act(async () => { await result.current.start({ initialStep: 'declare' }); });

    lensRun.mockResolvedValueOnce({
      data: {
        ok: true,
        result: {
          ok: true,
          session: {
            id: 'sess_1', userId: 'u1', lensId: 'kingdoms', title: 'War campaign',
            status: 'open', currentStep: 'muster', state: {},
            stepCount: 1, createdAt: 1000, updatedAt: 2000, closedAt: null,
          },
        },
      },
    });
    await act(async () => { await result.current.advance({ toStep: 'muster' }); });

    await waitFor(() => {
      expect(result.current.session?.currentStep).toBe('muster');
      expect(result.current.session?.stepCount).toBe(1);
    });
  });
});
