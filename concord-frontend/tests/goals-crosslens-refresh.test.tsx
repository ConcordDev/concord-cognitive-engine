// §9 Group D — the CrossLens contract the Goals page now relies on.
// With hideWhenEmpty the panel returns null once loading settles
// empty: its "Refresh items from other lenses" button exists only
// mid-load, disabled — the control can never be clicked (§9 flow/J).
// The Goals page mounts it with hideWhenEmpty={false}; this pins the
// settled-state behaviour that prop buys: section present, refresh
// enabled, clicking re-runs the read.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const lensRun = vi.fn();
vi.mock('@/lib/api/client', () => ({
  lensRun: (...args: unknown[]) => lensRun(...args),
  apiHelpers: { goals: {} },
  api: { get: async () => ({ data: {} }), delete: async () => ({}) },
}));

import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';

beforeEach(() => {
  lensRun.mockReset();
  lensRun.mockResolvedValue({ data: { ok: true, result: { surfaces: [] } } });
});

describe('CrossLensRecentsPanel settled-empty states', () => {
  it('hideWhenEmpty={false}: the section and an ENABLED refresh survive settling', async () => {
    render(<CrossLensRecentsPanel lensId="goals" sinceDays={7} limit={6} hideWhenEmpty={false} />);
    expect(await screen.findByText(/No DTUs surfaced from elsewhere/)).toBeTruthy();
    const refresh = screen.getByRole('button', { name: 'Refresh items from other lenses' });
    expect(refresh).not.toBeDisabled();
    const before = lensRun.mock.calls.length;
    fireEvent.click(refresh);
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(before));
    const call = lensRun.mock.calls[lensRun.mock.calls.length - 1];
    expect(call[0]).toBe('dtu_surface');
    expect(call[1]).toBe('surfaced_from');
  });

  it('hideWhenEmpty (the old Goals mount): the settled section is gone entirely', async () => {
    const { container } = render(<CrossLensRecentsPanel lensId="goals" sinceDays={7} limit={6} hideWhenEmpty />);
    await waitFor(() => expect(lensRun.mock.calls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByRole('button', { name: 'Refresh items from other lenses' })).toBeNull();
  });
});
