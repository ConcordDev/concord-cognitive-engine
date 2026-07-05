// Phase CA1 — confirm FlightHUD listens for concordia:flight-state.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { FlightHUD } from '@/components/world/FlightHUD';

function dispatchFlightState(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent('concordia:flight-state', { detail }));
  });
}

const BASE_STATE = {
  airspeed: 12.3, heading: Math.PI / 2, rollRad: 0, pitchRad: 0, vy: -1.5, stalled: false, stallTimerMs: 0,
};

describe('Phase CA1 — Flight HUD wired to flight-physics event', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('subscribes to concordia:flight-state and renders nothing before the first event', () => {
    const { container } = render(<FlightHUD />);
    expect(container.firstChild).toBeNull();
    dispatchFlightState(BASE_STATE);
    expect(screen.getByText(/Flight instruments/)).toBeInTheDocument();
  });

  it('reads airspeed + heading + vy + roll + pitch + stall from event detail', () => {
    render(<FlightHUD />);
    dispatchFlightState({
      airspeed: 25.678, heading: Math.PI, rollRad: Math.PI / 4, pitchRad: -Math.PI / 6, vy: 3.2, stalled: false, stallTimerMs: 0,
    });
    expect(screen.getByText('25.7 m/s')).toBeInTheDocument(); // airspeed
    expect(screen.getByText('180°')).toBeInTheDocument(); // heading
    expect(screen.getByText('+3.2 m/s')).toBeInTheDocument(); // vy
    expect(screen.getByText('45°')).toBeInTheDocument(); // roll
    expect(screen.getByText('-30°')).toBeInTheDocument(); // pitch
    expect(screen.getByText('OK')).toBeInTheDocument(); // stall
  });

  it('auto-hides on silence (no event for SILENCE_MS)', () => {
    vi.useFakeTimers();
    render(<FlightHUD />);
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:flight-state', { detail: BASE_STATE }));
    });
    expect(screen.getByText(/Flight instruments/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2600); }); // > SILENCE_MS (2000ms) + one 500ms poll tick
    expect(screen.queryByText(/Flight instruments/)).not.toBeInTheDocument();
  });

  it('shows stall warning when stalled', () => {
    render(<FlightHUD />);
    dispatchFlightState({ ...BASE_STATE, stalled: true, stallTimerMs: 340 });
    expect(screen.getByText(/STALL — pitch down to recover/)).toBeInTheDocument();
    expect(screen.getByText('340ms')).toBeInTheDocument();
  });
});
