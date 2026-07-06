/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { WaveformPlayer } from './WaveformPlayer';

describe('WaveformPlayer (feed lens) — honest playback state', () => {
  it('never renders a fabricated progress percentage, even after time passes on a bare timer', () => {
    vi.useFakeTimers();
    render(<WaveformPlayer title="Test Track" duration="3:45" waveform={[10, 20, 30, 40, 50]} />);

    // No percentage text anywhere before play.
    expect(screen.queryByText(/%\s*$/)).toBeNull();

    fireEvent.click(screen.getByRole('button'));

    // Advance well past where the old setInterval(200ms, +2%) bug would have
    // ticked from 0 to 100 (50 ticks = 10s). If the fabricated-progress
    // regressed, a percentage string would now be in the document.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.queryByText(/%\s*$/)).toBeNull();
    vi.useRealTimers();
  });

  it('toggles play/pause without depending on elapsed time', () => {
    render(<WaveformPlayer title="Test Track" duration="1:00" waveform={[10, 20, 30]} />);
    const button = screen.getByRole('button');
    fireEvent.click(button);
    fireEvent.click(button);
    // Just pins that toggling doesn't throw / leave stray intervals — no
    // numeric progress assertions since none should exist.
    expect(button).toBeInTheDocument();
  });
});
