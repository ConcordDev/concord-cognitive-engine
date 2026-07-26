/**
 * Pins the DET-C batch 8 fix: the Settings > Privacy "World Visible to
 * Others" toggle used to be pure localStorage decoration — nothing ever
 * emitted `player:visibility` (server.js's BD#27 ghost/appear-offline
 * handler), so `player:visibility:ack` / `player:visibility:nack` were
 * genuinely dead broadcasts. Saving a changed toggle now emits the real
 * socket request and surfaces the honest ack/nack/timeout result.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: mockBack, push: vi.fn(), replace: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/components/system/DomainProbeCard', () => ({
  DomainProbeCard: () => null,
}));

type Listener = (data: unknown) => void;
const listeners: Record<string, Listener[]> = {};
const emitMock = vi.fn();

vi.mock('@/lib/realtime/socket', () => ({
  emit: (event: string, data?: unknown) => emitMock(event, data),
  subscribe: (event: string, cb: Listener) => {
    listeners[event] = listeners[event] || [];
    listeners[event].push(cb);
    return () => {
      listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
    };
  },
}));

function fireServerEvent(event: string, data: unknown) {
  for (const cb of listeners[event] || []) cb(data);
}

import SettingsPage from '@/app/settings/page';

beforeEach(() => {
  localStorage.clear();
  emitMock.mockClear();
  mockBack.mockClear();
  Object.keys(listeners).forEach((k) => delete listeners[k]);
});

function clickWorldVisibilityToggle() {
  fireEvent.click(screen.getByText('Privacy'));
  const toggleRow = screen.getByText('World Visible to Others').closest('div')!;
  const toggleBtn = toggleRow.querySelector('button')!;
  fireEvent.click(toggleBtn);
}

describe('SettingsPage — live world-visibility round trip', () => {
  it('does not emit player:visibility when saving without a privacy change', async () => {
    render(<SettingsPage />);
    await screen.findByText('Privacy');
    fireEvent.click(screen.getByText('Apply'));
    expect(emitMock).not.toHaveBeenCalledWith('player:visibility', expect.anything());
    expect(mockBack).toHaveBeenCalled();
  });

  it('emits player:visibility and shows the honest ack result when the toggle changes', async () => {
    render(<SettingsPage />);
    await screen.findByText('Privacy');

    clickWorldVisibilityToggle();
    fireEvent.click(screen.getByText('Apply'));

    expect(emitMock).toHaveBeenCalledWith('player:visibility', { mode: 'hidden' });

    await act(async () => {
      fireServerEvent('player:visibility:ack', { mode: 'hidden' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/hidden from other players/);
    });
  });

  it('shows an honest not-connected message on nack, never a fabricated success', async () => {
    render(<SettingsPage />);
    await screen.findByText('Privacy');

    clickWorldVisibilityToggle();
    fireEvent.click(screen.getByText('Apply'));

    await act(async () => {
      fireServerEvent('player:visibility:nack', { reason: 'invalid_mode' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Could not apply live visibility/);
    });
  });
});
