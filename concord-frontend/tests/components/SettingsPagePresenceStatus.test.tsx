/**
 * V1.2 Wave A — Society & Presence. Pins the Settings > Presence Status
 * control: clicking a status button emits the real `player:presence-status`
 * socket request (server.js) and surfaces the honest ack/nack/timeout
 * result, mirroring the established `player:visibility` round trip
 * (SettingsPageVisibility.test.tsx) rather than being localStorage-only
 * decoration.
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

describe('SettingsPage — presence status round trip', () => {
  it('renders all four status options with none pre-selected but "available" as default state', async () => {
    render(<SettingsPage />);
    await screen.findByText('Presence Status');
    for (const label of ['Available', 'Away', 'Busy', 'Do Not Disturb']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const availableBtn = screen.getByText('Available').closest('button')!;
    expect(availableBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('emits player:presence-status immediately on click (not gated behind Save/Apply)', async () => {
    render(<SettingsPage />);
    await screen.findByText('Presence Status');

    fireEvent.click(screen.getByText('Busy'));

    expect(emitMock).toHaveBeenCalledWith('player:presence-status', { status: 'busy' });
    // Applied live, immediately — no need to click the form's Apply button.
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('shows the honest ack result and updates the selected pill', async () => {
    render(<SettingsPage />);
    await screen.findByText('Presence Status');

    fireEvent.click(screen.getByText('Away'));
    await act(async () => {
      fireServerEvent('player:presence-status:ack', { status: 'away' });
    });

    await waitFor(() => {
      const notes = screen.getAllByRole('status');
      expect(notes.some((n) => /Status set to away/.test(n.textContent || ''))).toBe(true);
    });
    const awayBtn = screen.getByText('Away').closest('button')!;
    expect(awayBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an honest not-connected message on nack, never a fabricated success', async () => {
    render(<SettingsPage />);
    await screen.findByText('Presence Status');

    fireEvent.click(screen.getByText('Do Not Disturb'));
    await act(async () => {
      fireServerEvent('player:presence-status:nack', { reason: 'invalid_status' });
    });

    await waitFor(() => {
      const notes = screen.getAllByRole('status');
      expect(notes.some((n) => /Could not apply status live/.test(n.textContent || ''))).toBe(true);
    });
  });

  it('persists the last chosen status to localStorage for next session', async () => {
    render(<SettingsPage />);
    await screen.findByText('Presence Status');
    fireEvent.click(screen.getByText('Busy'));
    expect(localStorage.getItem('concord:presenceStatus')).toBe('busy');
  });
});
