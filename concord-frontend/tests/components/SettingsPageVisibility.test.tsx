/**
 * World visibility is a live `player:visibility` request. Apply does
 * nothing until the toggle actually changes, so a saved volume form
 * cannot be the thing that writes this.
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

import { WorldVisibilityControl } from '@/components/settings/WorldVisibilityControl';

beforeEach(() => {
  emitMock.mockClear();
  Object.keys(listeners).forEach((k) => delete listeners[k]);
});

afterEach(() => {
  vi.useRealTimers();
});

function toggleVisibility() {
  const row = screen.getByText('World Visible to Others').closest('div')!;
  fireEvent.click(row.querySelector('button')!);
}

describe('WorldVisibilityControl — live world-visibility round trip', () => {
  it('starts visible and does not emit when Apply is pressed unchanged', () => {
    render(<WorldVisibilityControl />);
    expect(screen.getByText('On')).toBeTruthy();
    expect(screen.getByTestId('visibility-apply')).toBeDisabled();
    fireEvent.click(screen.getByTestId('visibility-apply'));
    expect(emitMock).not.toHaveBeenCalled();
  });

  it('emits player:visibility and shows the honest ack when the toggle changes', async () => {
    render(<WorldVisibilityControl />);
    toggleVisibility();
    fireEvent.click(screen.getByTestId('visibility-apply'));

    expect(emitMock).toHaveBeenCalledWith('player:visibility', { mode: 'hidden' });

    await act(async () => {
      fireServerEvent('player:visibility:ack', { mode: 'hidden' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/hidden from other players/);
    });
  });

  it('emits visible again after the player turns presence back on', async () => {
    render(<WorldVisibilityControl />);
    toggleVisibility();
    fireEvent.click(screen.getByTestId('visibility-apply'));
    await act(async () => {
      fireServerEvent('player:visibility:ack', { mode: 'hidden' });
    });
    await screen.findByRole('status');

    toggleVisibility();
    fireEvent.click(screen.getByTestId('visibility-apply'));
    expect(emitMock).toHaveBeenCalledWith('player:visibility', { mode: 'visible' });
    await act(async () => {
      fireServerEvent('player:visibility:ack', { mode: 'visible' });
    });
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/visible to other players/);
    });
  });

  it('shows an honest not-connected message on nack', async () => {
    render(<WorldVisibilityControl />);
    toggleVisibility();
    fireEvent.click(screen.getByTestId('visibility-apply'));

    await act(async () => {
      fireServerEvent('player:visibility:nack', { reason: 'invalid_mode' });
    });

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/Could not apply live visibility/);
    });
  });

  it('says the world socket is down when the ack never arrives', async () => {
    vi.useFakeTimers();
    render(<WorldVisibilityControl />);
    toggleVisibility();
    fireEvent.click(screen.getByTestId('visibility-apply'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByRole('status').textContent).toMatch(/Not connected to a world/);
  });
});
