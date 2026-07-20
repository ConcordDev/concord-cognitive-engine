import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

let mockPathname = '/lenses/world';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

import { useWorldHudHidden } from '@/hooks/useWorldHudHidden';

// Regression coverage: globally-mounted chrome (BrainMonitor, SystemStatus
// — both mounted once above every lens page, in app/lenses/layout.tsx and
// components/shell/AppShell.tsx respectively) ignored the World Lens's
// manual "hide HUD" toggle (H key) entirely, since that toggle only lived
// in page.tsx's local React state with no channel to the layout/shell
// component tree above it. This hook listens to the same
// `concordia:hide-hud` window event the World Lens page already
// broadcasts, gated by pathname so it can never affect any other lens.
describe('useWorldHudHidden', () => {
  beforeEach(() => {
    mockPathname = '/lenses/world';
  });

  it('starts false and flips true when the World Lens broadcasts hide=true', () => {
    const { result } = renderHook(() => useWorldHudHidden());
    expect(result.current).toBe(false);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: true } }));
    });
    expect(result.current).toBe(true);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: false } }));
    });
    expect(result.current).toBe(false);
  });

  it('never flips true on any other lens, even if the event somehow fires', () => {
    mockPathname = '/lenses/chat';
    const { result } = renderHook(() => useWorldHudHidden());
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:hide-hud', { detail: { hide: true } }));
    });
    expect(result.current).toBe(false);
  });
});
