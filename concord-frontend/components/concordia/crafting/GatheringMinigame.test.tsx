/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import { GatheringMinigame } from './GatheringMinigame';

// GatheringMinigame's final click starts a 700ms setTimeout that fires the
// real backend-mutating onComplete callback. Regression coverage for the
// "cancel doesn't cancel" bug: a cancel click (or any unmount) during that
// window must prevent onComplete from ever firing.

describe('GatheringMinigame — cancel-doesn\'t-cancel regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function clickBarThreeTimes() {
    const bar = screen.getByTestId('gathering-rhythm-bar');
    act(() => { fireEvent.click(bar); });
    act(() => { fireEvent.click(bar); });
    act(() => { fireEvent.click(bar); });
  }

  it('does NOT call onComplete when cancel is clicked before the completion timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<GatheringMinigame toolTier={2} resourceName="Iron Ore" onComplete={onComplete} onCancel={onCancel} />);

    clickBarThreeTimes();

    // Completion timer (700ms) is pending but hasn't fired yet.
    act(() => { vi.advanceTimersByTime(300); });
    expect(onComplete).not.toHaveBeenCalled();

    // Player cancels mid-window.
    const cancelBtn = screen.getByText('✕');
    act(() => { fireEvent.click(cancelBtn); });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Advance well past the original 700ms deadline — the stale timer must
    // never fire the real backend mutation.
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does NOT call onComplete when the component unmounts (not via the cancel button) before the timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <GatheringMinigame toolTier={2} resourceName="Iron Ore" onComplete={onComplete} onCancel={onCancel} />
    );

    clickBarThreeTimes();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { unmount(); });

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('positive path: onComplete DOES fire with the score when not cancelled', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<GatheringMinigame toolTier={2} resourceName="Iron Ore" onComplete={onComplete} onCancel={onCancel} />);

    clickBarThreeTimes();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(700); });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    const score = onComplete.mock.calls[0][0];
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(3);
  });
});
