// Coverage for the sidebar rail footer: search, sessions, help events, online dot and the
// cached /auth/me lookup that feeds the notification bell.

import React from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  setPalette: vi.fn(), toggle: vi.fn(), online: { isOnline: true }, entered: 'yes' as string | null,
  get: vi.fn(async () => ({ data: { user: { id: 'u9' } } })),
}));
vi.mock('@/lib/api/client', () => ({ api: { get: h.get } }));
vi.mock('@/store/ui', () => ({ useUIStore: (sel: (s: unknown) => unknown) => sel({ setCommandPaletteOpen: h.setPalette }) }));
vi.mock('@/lib/safe-storage', () => ({ safeGetItem: () => h.entered }));
vi.mock('@/hooks/usePowerMode', () => ({ usePowerMode: () => ({ powerMode: false, togglePowerMode: h.toggle }) }));
vi.mock('@/components/common/OfflineIndicator', () => ({ useOnlineStatus: () => h.online }));
vi.mock('@/components/social/NotificationBell', () => ({ NotificationBell: ({ userId }: { userId?: string }) => <span>bell:{String(userId)}</span> }));
vi.mock('@/components/common/ThemeToggle', () => ({ ThemeToggle: () => <span>theme-stub</span> }));
vi.mock('../topbar/UserMenu', () => ({ UserMenu: ({ onTogglePowerMode }: { onTogglePowerMode: () => void }) => <button onClick={onTogglePowerMode}>user-menu</button> }));

const mount = async (expanded: boolean) => {
  const { RailAccount } = await import('../RailAccount');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><RailAccount expanded={expanded} /></QueryClientProvider>);
};
afterEach(() => cleanup());
beforeEach(() => { h.online.isOnline = true; h.entered = 'yes'; h.get.mockClear(); h.setPalette.mockClear(); });

describe('RailAccount', () => {
  it('opens search, toggles sessions and help via window events, and loads the user id', async () => {
    const sessions = vi.fn(); const help = vi.fn();
    window.addEventListener('concord:toggle-sessions', sessions);
    window.addEventListener('concord:open-help', help);
    const view = await mount(true);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(view.container.textContent).toContain('bell:u9');
    await act(async () => { fireEvent.click(screen.getByLabelText('Search')); });
    expect(h.setPalette).toHaveBeenCalledWith(true);
    await act(async () => { fireEvent.click(screen.getByLabelText('Open sessions')); });
    await act(async () => { fireEvent.click(screen.getByLabelText('Help and feedback')); });
    await act(async () => { fireEvent.click(screen.getByText('user-menu')); });
    expect(sessions).toHaveBeenCalled(); expect(help).toHaveBeenCalled(); expect(h.toggle).toHaveBeenCalled();
    expect(view.container.querySelector('.flex-row')).toBeTruthy();
    window.removeEventListener('concord:toggle-sessions', sessions);
    window.removeEventListener('concord:open-help', help);
  });

  it('shows the offline dot, collapsed layout and skips /auth/me before first entry', async () => {
    h.online.isOnline = false; h.entered = null;
    const view = await mount(false);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(h.get).not.toHaveBeenCalled();
    expect(view.container.querySelector('[title^="Offline"]')).toBeTruthy();
    expect(view.container.querySelector('.flex-col')).toBeTruthy();
    expect(view.container.textContent).toContain('bell:undefined');
  });
});
