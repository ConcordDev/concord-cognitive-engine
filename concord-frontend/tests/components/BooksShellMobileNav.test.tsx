/// <reference types="@testing-library/jest-dom/vitest" />
// Pins the BooksShell mobile-nav affordance (Wave 4 — the follow-up
// docs/lens-specs/accounting-capability-map.md flagged after MobileTabBar
// was removed with the generic-scaffold cleanup): a hamburger in the
// mobile header opens the sidebar nav as a slide-over drawer; selecting a
// destination both navigates (onNavChange) and closes the drawer; the
// desktop sidebar markup is untouched (hidden md:flex).

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { BooksShell } from '@/components/accounting/BooksShell';

function renderShell(onNavChange = vi.fn()) {
  render(
    <BooksShell activeNav="dashboard" onNavChange={onNavChange}>
      <div>content</div>
    </BooksShell>,
  );
  return onNavChange;
}

describe('BooksShell mobile navigation', () => {
  it('offers a hamburger that opens the nav drawer with the full grouped nav', () => {
    renderShell();
    // Drawer content absent until opened.
    expect(screen.queryByLabelText('Close navigation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open navigation'));

    expect(screen.getByLabelText('Close navigation')).toBeInTheDocument();
    // Drawer carries the same real nav (grouped) — spot-check one entry per group.
    // Entries render twice (desktop aside + drawer), so use getAllByText.
    for (const label of ['Banking', 'Invoices', 'Bills', 'P&L']) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('selecting a destination navigates AND closes the drawer', () => {
    const onNavChange = renderShell();
    fireEvent.click(screen.getByLabelText('Open navigation'));

    // The drawer's copy is the last-rendered instance of the label.
    const bankingButtons = screen.getAllByText('Banking');
    fireEvent.click(bankingButtons[bankingButtons.length - 1]);

    expect(onNavChange).toHaveBeenCalledWith('banking');
    expect(screen.queryByLabelText('Close navigation')).not.toBeInTheDocument();
  });

  it('the close button and backdrop dismiss the drawer without navigating', () => {
    const onNavChange = renderShell();

    fireEvent.click(screen.getByLabelText('Open navigation'));
    fireEvent.click(screen.getByLabelText('Close navigation'));
    expect(screen.queryByLabelText('Close navigation')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Open navigation'));
    fireEvent.click(screen.getByLabelText('Close navigation overlay'));
    expect(screen.queryByLabelText('Close navigation overlay')).not.toBeInTheDocument();

    expect(onNavChange).not.toHaveBeenCalled();
  });

  it('mobile header shows the active destination label', () => {
    renderShell();
    // activeNav="dashboard" → mobile header echoes "Dashboard".
    expect(screen.getAllByText('Dashboard').length).toBeGreaterThanOrEqual(2);
  });
});
