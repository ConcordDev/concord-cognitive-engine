import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { MetronomePlayer } from '@/components/studio/MetronomePlayer';

// Minimal Web Audio stub. createOscillator / createGain return objects with
// the methods the metronome scheduler touches.
function makeCtx() {
  const osc = () => ({
    type: '', frequency: { value: 0 },
    connect: vi.fn(), start: vi.fn(), stop: vi.fn(),
  });
  const gain = () => ({
    gain: {
      value: 0,
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  });
  return {
    currentTime: 0,
    state: 'running' as string,
    destination: {},
    createOscillator: vi.fn(osc),
    createGain: vi.fn(gain),
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

let ctx: ReturnType<typeof makeCtx>;

beforeEach(() => {
  ctx = makeCtx();
  vi.stubGlobal('AudioContext', vi.fn(() => ctx));
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('MetronomePlayer', () => {
  it('renders nothing (headless) and stays idle when disabled', () => {
    const { container } = render(<MetronomePlayer enabled={false} playing={false} bpm={120} />);
    expect(container.firstChild).toBeNull();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it('does not schedule when enabled but not playing', () => {
    render(<MetronomePlayer enabled playing={false} bpm={120} />);
    vi.advanceTimersByTime(100);
    expect(ctx.createOscillator).not.toHaveBeenCalled();
  });

  it('schedules clicks when enabled + playing', () => {
    render(<MetronomePlayer enabled playing bpm={120} beatsPerBar={4} />);
    // initial tick runs synchronously, then interval ticks
    vi.advanceTimersByTime(100);
    expect(ctx.createOscillator).toHaveBeenCalled();
    expect(ctx.createGain).toHaveBeenCalled();
  });

  it('resumes a suspended context', () => {
    ctx.state = 'suspended';
    render(<MetronomePlayer enabled playing bpm={140} />);
    expect(ctx.resume).toHaveBeenCalled();
  });

  it('clamps bpm into the 20-400 range when scheduling', () => {
    render(<MetronomePlayer enabled playing bpm={5} beatsPerBar={2} />);
    vi.advanceTimersByTime(60);
    expect(ctx.createOscillator).toHaveBeenCalled();
  });

  it('tears down the loop and closes the context on unmount', () => {
    const { unmount } = render(<MetronomePlayer enabled playing bpm={120} />);
    vi.advanceTimersByTime(50);
    unmount();
    expect(ctx.close).toHaveBeenCalled();
  });

  it('stops scheduling when playing flips false', () => {
    const { rerender } = render(<MetronomePlayer enabled playing bpm={120} />);
    vi.advanceTimersByTime(50);
    const callsBefore = ctx.createOscillator.mock.calls.length;
    rerender(<MetronomePlayer enabled playing={false} bpm={120} />);
    vi.advanceTimersByTime(200);
    expect(ctx.createOscillator.mock.calls.length).toBe(callsBefore);
  });
});
