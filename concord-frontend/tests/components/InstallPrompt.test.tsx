import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/lenses/chat' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { InstallPrompt } from '@/components/pwa/InstallPrompt';

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
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem('concord_pwa_dismissed');
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
});
