/// <reference types="@testing-library/jest-dom/vitest" />
// FirstRunTour — per-lens 30-second coachmark tour.
//
// Behavior pinned here (read from components/lens/FirstRunTour.tsx):
//   - no-op when the lens manifest has no firstRunGuide / no steps;
//   - waits for the welcome wizard (isOnboardingComplete) unless `force`;
//   - waits 900ms and refuses to stack on an open dialog unless `force`;
//   - Next/Done walks the steps, Skip / X / backdrop end it early;
//   - completion persists per lensId in localStorage so it never re-fires;
//   - a step with a selector spotlights the target (halo + dim backdrop) and
//     tracks resize/scroll; a missing target degrades to no spotlight.
//
// The manifest is mocked so each test controls the guide's steps — the real
// manifest's copy changes over time and is not what's under test.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

type Step = { caption: string; selector?: string };
const manifests: Record<string, { label?: string; firstRunGuide?: { steps: Step[] } } | undefined> = {};

vi.mock('@/lib/lenses/manifest', () => ({
  getLensManifest: (id: string) => manifests[id],
}));

import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { ONBOARDING_COMPLETE_KEY } from '@/lib/onboarding-state';

const STORAGE_PREFIX = 'concord:first-run-tour:';

function advancePastDelay() {
  act(() => {
    vi.advanceTimersByTime(950);
  });
}

describe('FirstRunTour', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    window.localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
    for (const k of Object.keys(manifests)) delete manifests[k];
    manifests.pharmacy = {
      label: 'Pharmacy',
      firstRunGuide: {
        steps: [
          { caption: 'Search the formulary here.' },
          { caption: 'Check interactions before dispensing.' },
          { caption: 'You are all set.' },
        ],
      },
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('renders nothing for a lens with no firstRunGuide', () => {
    manifests.bare = { label: 'Bare' };
    const { container } = render(<FirstRunTour lensId="bare" />);
    advancePastDelay();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a guide with zero steps', () => {
    manifests.empty = { label: 'Empty', firstRunGuide: { steps: [] } };
    const { container } = render(<FirstRunTour lensId="empty" />);
    advancePastDelay();
    expect(container).toBeEmptyDOMElement();
  });

  it('stays hidden for the first 900ms, then shows step 1 of N with the lens label', () => {
    render(<FirstRunTour lensId="pharmacy" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    advancePastDelay();
    const dialog = screen.getByRole('dialog', { name: 'Pharmacy first-run guide' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Pharmacy · quick tour')).toBeInTheDocument();
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('Search the formulary here.')).toBeInTheDocument();
    // No selector on this step → no focus-mode backdrop, not aria-modal.
    expect(dialog).not.toHaveAttribute('aria-modal');
  });

  it('falls back to the lensId when the manifest has no label', () => {
    manifests.nolabel = { firstRunGuide: { steps: [{ caption: 'Only step.' }] } };
    render(<FirstRunTour lensId="nolabel" />);
    advancePastDelay();
    expect(screen.getByText('nolabel · quick tour')).toBeInTheDocument();
  });

  it('Next walks the steps, the last step says Done, and Done finishes + persists', () => {
    const onComplete = vi.fn();
    render(<FirstRunTour lensId="pharmacy" onComplete={onComplete} />);
    advancePastDelay();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('Check interactions before dispensing.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Next/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith('finished');
    expect(window.localStorage.getItem(STORAGE_PREFIX + 'pharmacy')).toBe('1');
  });

  it('Skip ends the tour early, reports "skipped", and persists the dismissal', () => {
    const onComplete = vi.fn();
    render(<FirstRunTour lensId="pharmacy" onComplete={onComplete} />);
    advancePastDelay();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith('skipped');
    expect(window.localStorage.getItem(STORAGE_PREFIX + 'pharmacy')).toBe('1');
  });

  it('the header X (aria "Skip tour") also skips', () => {
    const onComplete = vi.fn();
    render(<FirstRunTour lensId="pharmacy" onComplete={onComplete} />);
    advancePastDelay();
    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }));
    expect(onComplete).toHaveBeenCalledWith('skipped');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never re-fires once completed for that lens — but other lenses still show', () => {
    window.localStorage.setItem(STORAGE_PREFIX + 'pharmacy', '1');
    manifests.retail = { label: 'Retail', firstRunGuide: { steps: [{ caption: 'Retail step.' }] } };
    render(
      <>
        <FirstRunTour lensId="pharmacy" />
        <FirstRunTour lensId="retail" />
      </>,
    );
    advancePastDelay();
    expect(screen.queryByText('Search the formulary here.')).not.toBeInTheDocument();
    expect(screen.getByText('Retail step.')).toBeInTheDocument();
  });

  it('force re-shows a completed tour', () => {
    window.localStorage.setItem(STORAGE_PREFIX + 'pharmacy', '1');
    render(<FirstRunTour lensId="pharmacy" force />);
    advancePastDelay();
    expect(screen.getByText('Search the formulary here.')).toBeInTheDocument();
  });

  it('waits for the welcome wizard: no tour while onboarding is incomplete', () => {
    window.localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
    const { container } = render(<FirstRunTour lensId="pharmacy" />);
    advancePastDelay();
    expect(container).toBeEmptyDOMElement();
  });

  it('force bypasses the onboarding gate', () => {
    window.localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
    render(<FirstRunTour lensId="pharmacy" force />);
    advancePastDelay();
    expect(screen.getByText('Search the formulary here.')).toBeInTheDocument();
  });

  it('does not stack on top of an already-open modal dialog', () => {
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    document.body.appendChild(modal);
    render(<FirstRunTour lensId="pharmacy" />);
    advancePastDelay();
    expect(screen.queryByText('Search the formulary here.')).not.toBeInTheDocument();
  });

  it('unmounting before the delay cancels the pending activation', () => {
    const { unmount } = render(<FirstRunTour lensId="pharmacy" />);
    unmount();
    expect(() => advancePastDelay()).not.toThrow();
  });

  describe('spotlight steps', () => {
    let target: HTMLElement;
    let rect: { top: number; left: number; width: number; height: number };

    beforeEach(() => {
      rect = { top: 100, left: 50, width: 200, height: 40 };
      target = document.createElement('button');
      target.id = 'search-box';
      target.getBoundingClientRect = () =>
        ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
      target.scrollIntoView = vi.fn();
      document.body.appendChild(target);
      manifests.focus = {
        label: 'Focus',
        firstRunGuide: {
          steps: [
            { caption: 'Look at the search box.', selector: '#search-box' },
            { caption: 'This target does not exist.', selector: '#missing' },
            { caption: 'Plain step.' },
          ],
        },
      };
    });

    function halo(): HTMLElement | null {
      return document.querySelector('[aria-hidden="true"].ring-4');
    }

    it('spotlights the selector target with a padded halo and scrolls it into view', () => {
      render(<FirstRunTour lensId="focus" />);
      advancePastDelay();
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      const h = halo();
      expect(h).not.toBeNull();
      // 6px of padding each side around the real rect.
      expect(h!.style.top).toBe('94px');
      expect(h!.style.left).toBe('44px');
      expect(h!.style.width).toBe('212px');
      expect(h!.style.height).toBe('52px');
      expect(target.scrollIntoView).toHaveBeenCalled();
    });

    it('re-tracks the target on resize', () => {
      render(<FirstRunTour lensId="focus" />);
      advancePastDelay();
      rect = { top: 300, left: 10, width: 100, height: 20 };
      act(() => {
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(50); // rAF under fake timers
      });
      expect(halo()!.style.top).toBe('294px');
      expect(halo()!.style.left).toBe('4px');
    });

    it('re-tracks the target on scroll', () => {
      render(<FirstRunTour lensId="focus" />);
      advancePastDelay();
      rect = { top: 20, left: 20, width: 50, height: 50 };
      act(() => {
        window.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(50);
      });
      expect(halo()!.style.top).toBe('14px');
    });

    it('a missing target degrades to no spotlight; a plain step has none either', () => {
      render(<FirstRunTour lensId="focus" />);
      advancePastDelay();
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(screen.getByText('This target does not exist.')).toBeInTheDocument();
      expect(halo()).toBeNull();
      // resize while on a step whose target is missing is a safe no-op
      act(() => {
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(50);
      });
      expect(halo()).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: /Next/ }));
      expect(screen.getByText('Plain step.')).toBeInTheDocument();
      act(() => {
        window.dispatchEvent(new Event('resize'));
        vi.advanceTimersByTime(50);
      });
      expect(halo()).toBeNull();
    });

    it('clicking the dimmed backdrop skips the tour', () => {
      const onComplete = vi.fn();
      render(<FirstRunTour lensId="focus" onComplete={onComplete} />);
      advancePastDelay();
      const backdrop = document.querySelector('[role="button"][aria-label="Skip tour"]') as HTMLElement;
      expect(backdrop).not.toBeNull();
      fireEvent.click(backdrop);
      expect(onComplete).toHaveBeenCalledWith('skipped');
      expect(window.localStorage.getItem(STORAGE_PREFIX + 'focus')).toBe('1');
    });

    it('the backdrop is keyboard-operable (Enter skips)', () => {
      const onComplete = vi.fn();
      render(<FirstRunTour lensId="focus" onComplete={onComplete} />);
      advancePastDelay();
      const backdrop = document.querySelector('[role="button"][aria-label="Skip tour"]') as HTMLElement;
      fireEvent.keyDown(backdrop, { key: 'Enter' });
      expect(onComplete).toHaveBeenCalledWith('skipped');
    });

    it('other keys on the backdrop do nothing', () => {
      const onComplete = vi.fn();
      render(<FirstRunTour lensId="focus" onComplete={onComplete} />);
      advancePastDelay();
      const backdrop = document.querySelector('[role="button"][aria-label="Skip tour"]') as HTMLElement;
      fireEvent.keyDown(backdrop, { key: 'a' });
      expect(onComplete).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('survives a localStorage that throws (private mode) — shows, and finishing does not crash', () => {
    const getSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k: string) => {
      if (k === ONBOARDING_COMPLETE_KEY) return 'true';
      throw new Error('denied');
    });
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const onComplete = vi.fn();
    render(<FirstRunTour lensId="pharmacy" onComplete={onComplete} />);
    advancePastDelay();
    expect(screen.getByText('Search the formulary here.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onComplete).toHaveBeenCalledWith('skipped');
    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});
