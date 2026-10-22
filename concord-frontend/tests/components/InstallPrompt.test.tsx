import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';

const nav = vi.hoisted(() => ({ pathname: '/lenses/chat' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
}));

import { InstallPrompt } from '@/components/pwa/InstallPrompt';

function fireInstallable() {
  const event = new Event('beforeinstallprompt');
  Object.assign(event, {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome: 'dismissed' as const }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe('InstallPrompt', () => {
  beforeEach(() => {
    nav.pathname = '/lenses/chat';
    localStorage.removeItem('concord_pwa_dismissed');
  });

  afterEach(() => {
    localStorage.removeItem('concord_pwa_dismissed');
  });

  it('shows the install toast after beforeinstallprompt on platform lenses', () => {
    render(<InstallPrompt />);
    expect(screen.queryByText('Install Concord')).toBeNull();
    fireInstallable();
    expect(screen.getByText('Install Concord')).toBeInTheDocument();
    expect(screen.getByText(/Use Concord offline/i)).toBeInTheDocument();
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

  it('stays hidden when the user already dismissed it', () => {
    localStorage.setItem('concord_pwa_dismissed', '1');
    render(<InstallPrompt />);
    fireInstallable();
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
