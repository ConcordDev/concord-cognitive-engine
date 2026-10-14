import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));

describe('NorthStarFrame CTA — mobile tab bar clearance (F3)', () => {
  it('places the primary CTA above the mobile nav (bottom-20) and restores desktop bottom-8', () => {
    const onClick = vi.fn();
    render(
      <NorthStarFrame
        lensId="announcements"
        crumb="Announcements"
        title="What's new"
        cta={{ label: 'Compose', onClick }}
      >
        <p>feed</p>
      </NorthStarFrame>,
    );

    const btn = screen.getByRole('button', { name: 'Compose' });
    expect(btn.className).toMatch(/bottom-\[calc\(5rem\+env\(safe-area-inset-bottom/);
    expect(btn.className).toMatch(/\bmd:bottom-8\b/);
  });

  it('opens via a real click when the CTA is the hit target', () => {
    const onClick = vi.fn();
    render(
      <NorthStarFrame
        lensId="announcements"
        crumb="Announcements"
        title="What's new"
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
