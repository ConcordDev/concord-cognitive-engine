import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockPathname = '/lenses/world';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import { useWorldHudHidden } from '@/hooks/useWorldHudHidden';
import { useHUDContext } from '@/components/world/concordia-hud/HUDContextProvider';

// Regression coverage: globally-mounted chrome (BrainMonitor, SystemStatus
// — both mounted once above every lens page, in app/lenses/layout.tsx and
// components/shell/AppShell.tsx respectively) ignored the World Lens's
// manual "hide HUD" toggle (H key) entirely, since that toggle only lived
// in page.tsx's local React state with no channel to the layout/shell
// component tree above it.
//
// World Lens Phase 6b — the flag moved into the shared `useHUDContext`
// store (HUDContextProvider owns the one `concordia:hide-hud` listener
// that keeps it live, tested separately in
// hud-context-provider-manual-hidden.test.tsx); this hook is now a pure
// store read + pathname gate, so these tests drive the store directly
// rather than dispatching the window event themselves.
describe('useWorldHudHidden', () => {
  beforeEach(() => {
    mockPathname = '/lenses/world';
    act(() => {
      useHUDContext.setState({ manualHidden: false });
    });
  });

  it('starts false and flips true when the store\'s manualHidden flips', () => {
    const { result, rerender } = renderHook(() => useWorldHudHidden());
    expect(result.current).toBe(false);
    act(() => {
      useHUDContext.setState({ manualHidden: true });
    });
    rerender();
    expect(result.current).toBe(true);
    act(() => {
      useHUDContext.setState({ manualHidden: false });
    });
    rerender();
    expect(result.current).toBe(false);
  });

  it('never flips true on any other lens, even if the store somehow flips', () => {
    mockPathname = '/lenses/chat';
    const { result, rerender } = renderHook(() => useWorldHudHidden());
    act(() => {
      useHUDContext.setState({ manualHidden: true });
    });
    rerender();
    expect(result.current).toBe(false);
  });
});
