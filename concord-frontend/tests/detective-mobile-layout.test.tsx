/**
 * FIX-detective-003 — Detective at 390px.
 *
 * The NorthStar floating "Find a case" CTA only switches to the Open
 * cases view; on that view (the default) it floated over the detail
 * card's lower text. The page now passes the CTA only from My case
 * file, where jumping to open cases is a real action.
 *
 * The ticket's title-truncation half was not locatable in the lens's
 * code: no title element in the detective components or the shell
 * carries a truncation utility and the card headings wrap — recorded
 * on the ticket row for the desk's live re-walk.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));
vi.mock('@/components/lens/LensShell', () => ({
  LensShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/hooks/useLensCommand', () => ({ useLensCommand: () => {} }));
vi.mock('@/components/detective/DetectiveBoardPanel', () => ({
  DetectiveBoardPanel: ({ active }: { active: string }) => <div>board:{active}</div>,
}));

import DetectiveLensPage from '@/app/lenses/detective/page';

describe('FIX-detective-003 — floating CTA vs the detail card', () => {
  it('shows no floating CTA on Open cases, and restores it from My case file', () => {
    render(<DetectiveLensPage />);
    expect(screen.getByText('board:open')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /My case file/ }));
    expect(screen.getByText('board:mine')).toBeTruthy();
    const cta = screen.getByTestId('north-star-cta');
    expect(cta.textContent).toContain('Find a case');
    fireEvent.click(cta);
    expect(screen.getByText('board:open')).toBeTruthy();
    expect(screen.queryByTestId('north-star-cta')).toBeNull();
  });
});
