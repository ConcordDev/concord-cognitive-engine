/**
 * TutorialOverlay used to render a permanent "? Help" pill — both in its
 * "tutorial done, hints off" early-return branch, and again (redundantly)
 * in its main render's bottom-left controls — directly contradicting the
 * zero-permanent-windows principle. Help is now reachable only through the
 * World HUD command palette's "Tutorials & Help" entry (C key), which
 * dispatches `concordia:open-tutorial-help`; TutorialOverlay listens for
 * that event to open the same HelpMenu the old pill opened.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/concordia/onboarding/tutorial', async () => {
  const actual = await vi.importActual<typeof import('@/lib/concordia/onboarding/tutorial')>(
    '@/lib/concordia/onboarding/tutorial',
  );
  return actual;
});

import { tutorialManager } from '@/lib/concordia/onboarding/tutorial';
import { TutorialOverlay } from '@/components/concordia/onboarding/TutorialHint';

describe('TutorialOverlay — Help pill removal', () => {
  beforeEach(() => {
    localStorage.clear();
    tutorialManager.skip(false); // land in the "done, hints off" state
  });
  afterEach(() => {
    localStorage.clear();
  });

  // skip(false) legitimately triggers the one-time "Drop hints?" offer
  // (existing, unrelated behavior) before settling into the true rest
  // state — decline it first so these tests isolate the Help-pill removal.
  function declineDropHintsOffer() {
    const noBtn = screen.getByText('No');
    act(() => { noBtn.click(); });
  }

  it('renders nothing (no permanent pill) at rest — no help affordance without the offer or palette', () => {
    const { container } = render(<TutorialOverlay />);
    declineDropHintsOffer();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Help/)).not.toBeInTheDocument();
  });

  it('opens the HelpMenu when the palette dispatches concordia:open-tutorial-help, with no persistent pill needed to trigger it', () => {
    render(<TutorialOverlay />);
    declineDropHintsOffer();
    expect(screen.queryByText('Tutorials')).not.toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new CustomEvent('concordia:open-tutorial-help'));
    });
    expect(screen.getByText('Tutorials')).toBeInTheDocument();
  });

  it('closing the HelpMenu with nothing else active returns to rendering nothing', () => {
    const { container } = render(<TutorialOverlay />);
    declineDropHintsOffer();
    act(() => { window.dispatchEvent(new CustomEvent('concordia:open-tutorial-help')); });
    expect(screen.getByText('Tutorials')).toBeInTheDocument();
    const closeBtn = screen.getAllByText('✕')[0];
    act(() => { closeBtn.click(); });
    expect(screen.queryByText('Tutorials')).not.toBeInTheDocument();
    expect(container.firstChild).toBeNull();
  });
});
