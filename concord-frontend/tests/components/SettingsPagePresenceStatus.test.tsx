/**
 * Presence status is a live socket request, applied on click.
 * The control used to live on `/settings`; that route now redirects to
 * the lens, and this panel is the same round trip.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

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

import { PresenceStatusControl } from '@/components/settings/PresenceStatusControl';

beforeEach(() => {
  localStorage.clear();
  emitMock.mockClear();
  Object.keys(listeners).forEach((k) => delete listeners[k]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PresenceStatusControl — presence status round trip', () => {
  it('renders all four status options with available pressed by default', () => {
    render(<PresenceStatusControl />);
    for (const label of ['Available', 'Away', 'Busy', 'Do Not Disturb']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Available').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('ignores a stored value that is not one of the four statuses', () => {
    localStorage.setItem('concord:presenceStatus', 'invisible');
    render(<PresenceStatusControl />);
    expect(screen.getByText('Available').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('emits player:presence-status immediately on click', () => {
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Busy'));
    expect(emitMock).toHaveBeenCalledWith('player:presence-status', { status: 'busy' });
  });

  it('does not re-emit when the already selected status is clicked again', () => {
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Available'));
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('shows the honest ack result and updates the selected pill', async () => {
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Away'));
    await act(async () => {
      fireServerEvent('player:presence-status:ack', { status: 'away' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Status set to away/);
    });
    expect(screen.getByText('Away').closest('button')!.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows an honest not-connected message on nack', async () => {
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Do Not Disturb'));
    await act(async () => {
      fireServerEvent('player:presence-status:nack', { reason: 'invalid_status' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Could not apply status live/);
    });
  });

  it('says the world socket is down when the ack never arrives', async () => {
    vi.useFakeTimers();
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Busy'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByRole('status').textContent).toMatch(/Not connected to a world/);
  });

  it('persists the last chosen status to localStorage', () => {
    render(<PresenceStatusControl />);
    fireEvent.click(screen.getByText('Busy'));
    expect(localStorage.getItem('concord:presenceStatus')).toBe('busy');
  });
});
