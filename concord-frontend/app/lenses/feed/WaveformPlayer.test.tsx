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

  // ── Honest placeholder when no real peaks exist ─────────────────────────
  // The feed lens (app/lenses/feed/page.tsx) used to fall back to a
  // `Math.sin(...)`-generated fake curve — shaped to *look* like real audio
  // — whenever a post's real waveform (sourced from the media DTU, which is
  // honestly `null` server-side when no client-computed peaks were
  // supplied — see server/lib/media-dtu.js#generateWaveform) was empty. It
  // now falls back to a flat placeholder instead. This component doesn't
  // know or care where its `waveform` prop came from, so these tests pin
  // the render-level contract that matters: a flat/uniform array renders as
  // flat/uniform bars — nothing in WaveformPlayer itself embellishes,
  // randomizes, or reshapes the data it's given into something curve-like.
  it('renders a flat placeholder waveform as visually flat bars (equal heights), never inventing a curve', () => {
    const flatPlaceholder = Array.from({ length: 32 }, () => 8);
    const { container } = render(
      <WaveformPlayer title="No Data Track" duration="0:10" waveform={flatPlaceholder} />
    );
    const bars = container.querySelectorAll('.flex-1.rounded-sm');
    expect(bars).toHaveLength(32);
    const heights = Array.from(bars).map((el) => (el as HTMLElement).style.height);
    expect(new Set(heights).size).toBe(1);
    expect(heights[0]).toBe('8%');
  });

  it('renders whatever real peaks it is given exactly as provided — no per-render randomization of a real waveform either', () => {
    const realPeaks = [5, 90, 12, 47, 3, 99, 61];
    const { container } = render(
      <WaveformPlayer title="Real Track" duration="0:07" waveform={realPeaks} />
    );
    const bars = container.querySelectorAll('.flex-1.rounded-sm');
    const heights = Array.from(bars).map((el) => (el as HTMLElement).style.height);
    expect(heights).toEqual(realPeaks.map((p) => `${p}%`));
  });
});
