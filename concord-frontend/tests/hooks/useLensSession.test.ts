// Pins the fabricated-success-envelope fix for useLensSession's local
// runMacro helper. POST /api/lens/run ALWAYS wraps a dispatched macro's own
// return value as { ok: true, result: <macro's own return> } — even when the
// macro itself reports { ok: false, reason: '...' }. Before this fix,
// runMacro cast the OUTER envelope directly as the macro's result, so every
// caller (start/advance/update/close/refresh) read `r.session` off an object
// that never had one — genuine backend successes were silently treated as
// failures. Real-world impact: WarCampaignSession (kingdoms lens) could never
// actually start, advance, or resolve a war campaign.
//
// These tests drive the hook against a mocked `api.post` returning the REAL
// /api/lens/run envelope shape and assert the hook surfaces the macro's own
// fields correctly on both success and failure.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLensSession } from '@/hooks/useLensSession';

const post = vi.fn();
vi.mock('@/lib/api/client', () => ({
  api: { post: (...a: unknown[]) => post(...a) },
}));

describe('useLensSession — envelope unwrap', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('start() reads the session from the nested result, not the outer envelope', async () => {
    // The exact shape POST /api/lens/run returns for sessions.start.
    post.mockResolvedValueOnce({
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
    post.mockResolvedValueOnce({
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

  it('advance() applies the real next step from the nested result', async () => {
    post.mockResolvedValueOnce({
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

    post.mockResolvedValueOnce({
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
