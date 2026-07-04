import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

const settingsRef: { screenReader: boolean } = { screenReader: true };
vi.mock('@/hooks/useAccessibilitySettings', () => ({
  useAccessibilitySettings: () => settingsRef,
}));

import ScreenReaderAnnouncer from '@/components/accessibility/ScreenReaderAnnouncer';

function fire(name: string, detail?: unknown) {
  act(() => {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  });
}

describe('ScreenReaderAnnouncer', () => {
  beforeEach(() => {
    settingsRef.screenReader = true;
  });

  afterEach(() => {
    cleanup();
  });

  it('renders two empty aria-live regions on mount', () => {
    render(<ScreenReaderAnnouncer />);
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('');
    expect(screen.getByTestId('sr-assertive')).toHaveTextContent('');
  });

  it('speaks a world event into the polite region', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:world-event-scheduled', { name: 'Harvest Fair' });
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('Event starting: Harvest Fair');
  });

  it('speaks an assertive world event (plague) into the assertive region', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:world-plague-declared', {});
    expect(screen.getByTestId('sr-assertive')).toHaveTextContent('A plague has been declared in this world.');
  });

  it('speaks a combat cue', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:combat-kill', {});
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('Enemy defeated.');
  });

  it('ignores events that format to null (e.g. calm horror tension)', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:horror-tension', { band: 'calm' });
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('');
    expect(screen.getByTestId('sr-assertive')).toHaveTextContent('');
  });

  it('supports the generic concordia:announce escape hatch', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:announce', { text: 'Custom message', priority: 'assertive' });
    expect(screen.getByTestId('sr-assertive')).toHaveTextContent('Custom message');
  });

  it('generic escape hatch defaults to polite priority when unspecified', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:announce', { text: 'Default priority' });
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('Default priority');
  });

  it('re-announces identical consecutive messages by toggling a trailing space', () => {
    render(<ScreenReaderAnnouncer />);
    fire('concordia:combat-kill', {});
    const first = screen.getByTestId('sr-polite').textContent;
    fire('concordia:combat-kill', {});
    const second = screen.getByTestId('sr-polite').textContent;
    expect(first).not.toBe(second);
    expect(first?.trim()).toBe('Enemy defeated.');
    expect(second?.trim()).toBe('Enemy defeated.');
  });

  it('does nothing when screenReader accessibility setting is off', () => {
    settingsRef.screenReader = false;
    render(<ScreenReaderAnnouncer />);
    fire('concordia:combat-kill', {});
    expect(screen.getByTestId('sr-polite')).toHaveTextContent('');
  });

  it('removes all listeners on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ScreenReaderAnnouncer />);
    unmount();
    // 7 world events + 5 combat cues + 1 generic escape hatch = 13 listeners.
    expect(removeSpy).toHaveBeenCalledTimes(13);
    removeSpy.mockRestore();
  });
});
