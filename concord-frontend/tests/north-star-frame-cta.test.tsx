import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));

describe('NorthStarFrame CTA — mobile tab bar clearance (F3)', () => {
  it('clears the mobile nav on the HelpButton line, left of it, and restores desktop bottom-8/right-8', () => {
    const onClick = vi.fn();
    render(
      <NorthStarFrame
        lensId="announcements"
        crumb="Announcements"
        cta={{ label: 'Compose', onClick }}
      >
        <p>feed</p>
      </NorthStarFrame>,
    );

    const btn = screen.getByRole('button', { name: 'Compose' });
    // Same bottom offset as HelpButton (4rem + safe area, above the h-14 bar) and
    // pushed left of its 44px circle (right-4) so the two never overlap.
    expect(btn.className).toMatch(/bottom-\[calc\(4rem\+env\(safe-area-inset-bottom/);
    expect(btn.className).toMatch(/\bright-\[4\.75rem\]/);
    expect(btn.className).toMatch(/\bmd:bottom-8\b/);
    expect(btn.className).toMatch(/\blg:right-8\b/);
  });

  it('opens via a real click when the CTA is the hit target', () => {
    const onClick = vi.fn();
    render(
      <NorthStarFrame
        lensId="announcements"
        crumb="Announcements"
        cta={{ label: 'Compose', onClick }}
      >
        <p>feed</p>
      </NorthStarFrame>,
    );

    const btn = screen.getByTestId('north-star-cta');
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
