/// <reference types="@testing-library/jest-dom/vitest" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { CraftingMinigame } from './CraftingMinigame';

// CraftingMinigame's release action starts a 900ms setTimeout that fires the
// real backend-mutating onComplete callback. Regression coverage for the
// "cancel doesn't cancel" bug: a cancel click (or any unmount) during that
// window must prevent onComplete from ever firing.

describe('CraftingMinigame — cancel-doesn\'t-cancel regression', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function pressAndRelease() {
    const btn = screen.getByText('Hold to Craft');
    act(() => {
      fireEvent.mouseDown(btn);
      fireEvent.mouseUp(btn);
    });
  }

  it('does NOT call onComplete when cancel is clicked before the completion timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<CraftingMinigame skillLevel={50} itemName="Iron Sword" onComplete={onComplete} onCancel={onCancel} />);

    pressAndRelease();

    act(() => { vi.advanceTimersByTime(400); });
    expect(onComplete).not.toHaveBeenCalled();

    const cancelBtn = screen.getByText('✕');
    act(() => { fireEvent.click(cancelBtn); });
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('does NOT call onComplete when the component unmounts (not via the cancel button) before the timer fires', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    const { unmount } = render(
      <CraftingMinigame skillLevel={50} itemName="Iron Sword" onComplete={onComplete} onCancel={onCancel} />
    );

    pressAndRelease();
    act(() => { vi.advanceTimersByTime(400); });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { unmount(); });

    act(() => { vi.advanceTimersByTime(5000); });
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('positive path: onComplete DOES fire with the multiplier when not cancelled', () => {
    const onComplete = vi.fn();
    const onCancel = vi.fn();
    render(<CraftingMinigame skillLevel={50} itemName="Iron Sword" onComplete={onComplete} onCancel={onCancel} />);

    pressAndRelease();
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(900); });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    const multiplier = onComplete.mock.calls[0][0];
    expect(typeof multiplier).toBe('number');
    expect(multiplier).toBeGreaterThanOrEqual(0.5);
    expect(multiplier).toBeLessThanOrEqual(1.5);
  });
});
