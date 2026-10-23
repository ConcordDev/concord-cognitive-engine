import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/lenses/chat' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { useUIStore } from '@/store/ui';

function fireInstallable(outcome: 'accepted' | 'dismissed' = 'dismissed') {
  const event = new Event('beforeinstallprompt');
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event as Event & { prompt: ReturnType<typeof vi.fn> };
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    nav.pathname = '/lenses/chat';
    localStorage.removeItem('concord_pwa_dismissed');
    useUIStore.setState({ installBannerFootprint: 0 });
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem('concord_pwa_dismissed');
    useUIStore.setState({ installBannerFootprint: 0 });
    vi.restoreAllMocks();
  });

  it('asks to install Concord as an app', () => {
    render(<InstallPrompt />);
    expect(screen.queryByText('Install Concord')).toBeNull();
    fireInstallable();
    expect(screen.getByText('Install Concord')).toBeInTheDocument();
    expect(screen.getByText('Install Concord as an app')).toBeInTheDocument();
    expect(screen.queryByText(/offline as a desktop app/i)).toBeNull();
  });

  it('does not cover the Studio workspace', () => {
    nav.pathname = '/lenses/studio';
    render(<InstallPrompt />);
    fireInstallable();
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('also stays off nested Studio paths', () => {
    nav.pathname = '/lenses/studio/project';
    render(<InstallPrompt />);
    fireInstallable();
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('still shows on paths that only share a prefix with Studio', () => {
    nav.pathname = '/lenses/studiox';
    render(<InstallPrompt />);
    fireInstallable();
    expect(screen.getByText('Install Concord')).toBeInTheDocument();
  });

  it('stays hidden when the user already dismissed it', () => {
    localStorage.setItem('concord_pwa_dismissed', '1');
    render(<InstallPrompt />);
    fireInstallable();
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('remembers a dismiss across a later visit', () => {
    render(<InstallPrompt />);
    fireInstallable();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(localStorage.getItem('concord_pwa_dismissed')).toBe('1');
    expect(screen.queryByText('Install Concord')).toBeNull();

    cleanup();
    render(<InstallPrompt />);
    fireInstallable();
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('remembers a native install-dialog dismiss', async () => {
    render(<InstallPrompt />);
    const event = fireInstallable('dismissed');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    });
    expect(event.prompt).toHaveBeenCalled();
    expect(localStorage.getItem('concord_pwa_dismissed')).toBe('1');
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('hides an already-queued toast when the user opens Studio', () => {
    nav.pathname = '/lenses/chat';
    const { rerender } = render(<InstallPrompt />);
    fireInstallable();
    expect(screen.getByText('Install Concord')).toBeInTheDocument();
    nav.pathname = '/lenses/studio';
    rerender(<InstallPrompt />);
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('sits above the global bottom bar + safe area on phones (still dismissible)', () => {
    // Real defect: at phone width the global MobileNav (fixed bottom-0,
    // h-14 + safe-area inset, z-50) covered the banner, which sat at a
    // hard-coded bottom-4. Structure assertion (jsdom has no layout):
    // below md the banner offsets by the bar height (3.5rem) + gap + the
    // home-indicator inset; at md+ (bar hidden) it keeps bottom-4.
    render(<InstallPrompt />);
    fireInstallable();
    const banner = screen.getByRole('banner');
    expect(banner.className).toContain('bottom-[calc(4rem+env(safe-area-inset-bottom,0px))]');
    expect(banner.className).toContain('md:bottom-4');
    // The dismiss control is still there and still works.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(localStorage.getItem('concord_pwa_dismissed')).toBe('1');
    expect(screen.queryByText('Install Concord')).toBeNull();
  });

  it('publishes its measured footprint while showing and clears it on dismiss (help button + scroll padding follow it)', () => {
    // Real defect (oc-social-3afix): the banner's footprint must be known
    // so the global Help launcher can sit above its X button and <main>
    // can reserve bottom padding for it. Stub a real-shaped rect (jsdom
    // reports all zeros): viewport 768 (jsdom default innerHeight) minus
    // a banner topping at 600 = 168px of covered viewport.
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: 600, bottom: 680, height: 80, width: 358, left: 0, right: 358, x: 0, y: 600, toJSON: () => ({}) } as DOMRect);
    render(<InstallPrompt />);
    fireInstallable();
    expect(useUIStore.getState().installBannerFootprint).toBe(768 - 600);

    // Re-measures when the viewport changes (e.g. keyboard or rotation).
    rectSpy.mockReturnValue({ top: 500, bottom: 580, height: 80, width: 358, left: 0, right: 358, x: 0, y: 500, toJSON: () => ({}) } as DOMRect);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(useUIStore.getState().installBannerFootprint).toBe(768 - 500);
    rectSpy.mockRestore();

    // Dismissing the banner releases the reserved space.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install prompt' }));
    expect(useUIStore.getState().installBannerFootprint).toBe(0);
  });

  it('publishes no footprint when it has no measurable rect (jsdom-honest: never pad for a phantom banner)', () => {
    // Default jsdom getBoundingClientRect reports all zeros — a zero-height
    // banner is not taking up viewport space, so nothing should reserve
    // padding for it.
    render(<InstallPrompt />);
    fireInstallable();
    expect(useUIStore.getState().installBannerFootprint).toBe(0);
  });
});
