/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import ButcheringMinigame from './ButcheringMinigame';

// ButcheringMinigame's final cut starts a 700ms setTimeout that fires the
// real backend-mutating onComplete callback (POST /api/world/creature/:id/butcher
// via CorpseMarkerOverlay). Regression coverage for the "cancel doesn't
// cancel" bug: a cancel click (or any unmount) during that window must
// prevent onComplete from ever firing.

describe('ButcheringMinigame — cancel-doesn\'t-cancel regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function cutThreeTimes() {
    const cutBtn = screen.getByText('Cut');
    act(() => { fireEvent.click(cutBtn); });
    act(() => { fireEvent.click(cutBtn); });
    act(() => { fireEvent.click(cutBtn); });
  }

  it('does NOT call onComplete when cancel is clicked before the completion timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<ButcheringMinigame toolTier={2} speciesName="Deer" onComplete={onComplete} onCancel={onCancel} />);

    cutThreeTimes();

    act(() => { vi.advanceTimersByTime(300); });
    expect(onComplete).not.toHaveBeenCalled();

    const cancelBtn = screen.getByText('cancel');
    act(() => { fireEvent.click(cancelBtn); });
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does NOT call onComplete when the component unmounts (not via the cancel button) before the timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <ButcheringMinigame toolTier={2} speciesName="Deer" onComplete={onComplete} onCancel={onCancel} />
    );

    cutThreeTimes();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { unmount(); });

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('positive path: onComplete DOES fire with the quality multiplier when not cancelled', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<ButcheringMinigame toolTier={2} speciesName="Deer" onComplete={onComplete} onCancel={onCancel} />);

    cutThreeTimes();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(700); });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    const q = onComplete.mock.calls[0][0];
    expect(typeof q).toBe('number');
    // 0 hits=0.5, 1=1.0, 2=1.5, 3 hits=2.0
    expect([0.5, 1.0, 1.5, 2.0]).toContain(q);
  });
});
