// Wave 4 gap-closure (ops-telemetry-capability-map.md) — LivenessPanel used
// to run its own unjittered 5s setInterval independently of the
// ops-telemetry page's own 5s refresh loop, firing two uncoordinated network
// round-trips every 5s. LivenessPanel now accepts an optional `refreshToken`
// prop: when supplied, the host owns the single interval and this panel
// refetches on token change instead of running its own timer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { LivenessPanel } from '@/components/admin/LivenessPanel';

function mockFetch() {
  return vi.fn().mockResolvedValue({
    status: 200,
    json: async () => ({
      ok: true,
      headline: { recordsLiving: 1, recordsPerCreator: 1, last7dRecords: 1, conversionRate: null, abandonRate: null, kFactor: null, viral: false, economySolvent: null },
    }),
  });
}

describe('LivenessPanel — coordinated refresh (Wave 4 gap-closure)', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('when refreshToken is supplied, does NOT start its own 5s setInterval', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    await act(async () => { render(<LivenessPanel refreshToken={0} />); });
    expect(fetchMock).toHaveBeenCalledTimes(1); // initial mount fetch only

    // Advance 30s (six 5s ticks) with the prop held constant — if this panel
    // were still running its own internal interval, it would have refetched
    // ~6 more times. It must not have, since no host-driven refreshToken
    // change occurred.
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the host bumps refreshToken, without any internal timer involved', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(<LivenessPanel refreshToken={0} />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { rerender(<LivenessPanel refreshToken={1} />); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { rerender(<LivenessPanel refreshToken={2} />); });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('standalone mount (no refreshToken prop) keeps its own internal interval, unchanged from before', async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

    await act(async () => { render(<LivenessPanel />); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
