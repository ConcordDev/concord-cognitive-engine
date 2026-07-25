// G3.1 — accessibility settings now apply to the DOM + world.
//
// Pins the fix for "options apply to NOTHING": the a11y store is bridged from
// the settings event, and AccessibilityDOMApplier writes colorblind / text-scale
// / high-contrast / reduced-motion to <html> + a window flag.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import AccessibilityDOMApplier from '@/components/accessibility/AccessibilityDOMApplier';
import { useUIStore } from '@/store/ui';
import { useEventRouter } from '@/lib/event-router';
import GameJuice from '@/components/world-lens/GameJuice';
import { Providers } from '@/components/Providers';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/dashboard',
}));

// Real render of the real Providers tree (same mocking shape already
// established + verified working in tests/components/Providers.test.tsx),
// with AccessibilityDOMApplier deliberately left UNMOCKED so its real
// mount + DOM-mutation effect can be observed. Only the heavy/unrelated
// subtrees (AppShell, sockets, react-query's network calls, etc.) are
// stubbed.
vi.mock('@/lib/realtime/socket', () => ({
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  reconnectSocket: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(() => Promise.resolve({ data: {} })) },
  default: { get: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock('@/lib/perf', () => ({ observeWebVitals: vi.fn() }));
vi.mock('@/components/shell/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));
vi.mock('@/components/common/PermissionGate', () => ({
  PermissionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/providers/I18nProvider', () => ({
  I18nProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/media/GlobalMediaController', () => ({
  GlobalMediaController: () => null,
}));

function EventRouterHost() {
  useEventRouter();
  return null;
}

describe('G3.1 — DOM applier writes a11y settings to <html>', () => {
  beforeEach(() => {
    // reset the html element + store between tests
    const root = document.documentElement;
    delete root.dataset.colorblind;
    root.classList.remove('a11y-high-contrast', 'a11y-reduce-motion');
    root.style.fontSize = '';
    useUIStore.getState().resetAccessibility?.();
  });

  it('applies colorblind, text-scale, high-contrast, reduced-motion', () => {
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'protanopia',
        textScale: 1.5,
        screenReader: false,
        keyboardNavigation: false,
        reducedMotion: true,
        subtitles: false,
        subtitleFontSize: 16,
        gameSpeed: 1,
        highContrast: true,
      });
    });
    render(<AccessibilityDOMApplier />);
    const root = document.documentElement;
    expect(root.dataset.colorblind).toBe('protanopia');
    expect(root.classList.contains('a11y-high-contrast')).toBe(true);
    expect(root.classList.contains('a11y-reduce-motion')).toBe(true);
    expect(root.style.fontSize).toBe('24px'); // 16 × 1.5
    expect((window as unknown as { __CONCORD_REDUCE_MOTION__?: boolean }).__CONCORD_REDUCE_MOTION__).toBe(true);
  });

  it('clears colorblind + classes when settings are default/off', () => {
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'none', textScale: 1, screenReader: false, keyboardNavigation: false,
        reducedMotion: false, subtitles: false, subtitleFontSize: 16, gameSpeed: 1, highContrast: false,
      });
    });
    render(<AccessibilityDOMApplier />);
    const root = document.documentElement;
    expect(root.dataset.colorblind).toBeUndefined();
    expect(root.classList.contains('a11y-high-contrast')).toBe(false);
    expect(root.classList.contains('a11y-reduce-motion')).toBe(false);
  });
});

describe('G3.1 — store bridge + mounts are wired', () => {
  it('event-router writes the store on concord:a11y-changed (not just a toast)', () => {
    render(<EventRouterHost />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concord:a11y-changed', {
        detail: { colorblindMode: 'deuteranopia', textScale: 1.25, reducedMotion: true, highContrast: true },
      }));
    });
    const { accessibility } = useUIStore.getState();
    expect(accessibility.colorblindMode).toBe('deuteranopia');
    expect(accessibility.textScale).toBe(1.25);
    expect(accessibility.reducedMotion).toBe(true);
    expect(accessibility.highContrast).toBe(true);
  });

  it('mounts the real AccessibilityDOMApplier inside the real Providers tree, and its DOM-mutation effect actually fires', () => {
    // Real render of the real Providers component (not a mock of it) — see
    // this file's top-of-file vi.mock block for what's stubbed (AppShell,
    // sockets, react-query network calls) and, just as importantly, what
    // is NOT stubbed: AccessibilityDOMApplier itself. If Providers.tsx
    // stopped rendering <AccessibilityDOMApplier /> (or it moved outside
    // the tree, or its own effect broke), the assertions below would fail
    // for real — this cannot pass from source text alone.
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'tritanopia', textScale: 1.25, screenReader: false, keyboardNavigation: false,
        reducedMotion: false, subtitles: false, subtitleFontSize: 16, gameSpeed: 1, highContrast: true,
      });
    });

    render(
      <Providers>
        <div>content</div>
      </Providers>
    );

    const root = document.documentElement;
    expect(root.dataset.colorblind).toBe('tritanopia');
    expect(root.classList.contains('a11y-high-contrast')).toBe(true);
    expect(root.style.fontSize).toBe('20px'); // 16 × 1.25
    // The SVG filter defs AccessibilityDOMApplier itself renders (its own
    // returned JSX, not something Providers could fake) are present too.
    expect(document.getElementById('a11y-cb-filters')).not.toBeNull();
  });

  it('GameJuice gates motion on reduced-motion: a disaster trigger renders the shake overlay normally but downgrades to non-shake when reduced-motion is on', () => {
    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'none', textScale: 1, screenReader: false, keyboardNavigation: false,
        reducedMotion: false, subtitles: false, subtitleFontSize: 16, gameSpeed: 1, highContrast: false,
      });
    });
    const { container: normalContainer } = render(<GameJuice><div /></GameJuice>);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:game-juice', { detail: { trigger: 'disaster', opts: { magnitude: 5 } } }));
    });
    const shakeEl = [...normalContainer.querySelectorAll('div')].find((el) =>
      (el as HTMLElement).style.animation?.startsWith('shake'));
    expect(shakeEl).toBeTruthy();

    act(() => {
      useUIStore.getState().setAllAccessibility({
        colorblindMode: 'none', textScale: 1, screenReader: false, keyboardNavigation: false,
        reducedMotion: true, subtitles: false, subtitleFontSize: 16, gameSpeed: 1, highContrast: false,
      });
    });
    const { container: reducedContainer } = render(<GameJuice><div /></GameJuice>);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:game-juice', { detail: { trigger: 'disaster', opts: { magnitude: 5 } } }));
    });
    const shakeElReduced = [...reducedContainer.querySelectorAll('div')].find((el) =>
      (el as HTMLElement).style.animation?.startsWith('shake'));
    expect(shakeElReduced).toBeFalsy();
  });
});
