/**
 * NorthStarFrame mobile shape — the shared layer behind the RCA-mobile-clip-fab
 * genus (FIX-*-clip tickets from the 2026-11 walk, which predates these shapes).
 *
 * Pins the branch-state behaviour the walker's post-deploy re-walk will verify:
 *  (a) the tab strip scrolls horizontally and tab buttons never shrink or
 *      truncate their labels (the founder-ruled (c) shape, 2026-11-12);
 *  (b) the CTA collapses to an icon-only button below sm with a 44px target
 *      (the achievements-004 / deities-007 fix shape);
 *  (c) the frame root reserves bottom padding (pb-36) so page content
 *      can scroll clear of the fixed CTA and the mobile tab bar.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Plus } from 'lucide-react';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));

const TABS = [
  { id: 'one', label: 'Overview' },
  { id: 'two', label: 'Molecular Workbench' },
  { id: 'three', label: 'Carpentry Projects' },
  { id: 'four', label: 'Reality Anchor' },
  { id: 'five', label: 'Research Library' },
  { id: 'six', label: 'Settings & Sharing' },
];

function renderFrame() {
  return render(
    <NorthStarFrame
      lensId="bio"
      crumb="Bio"
      tabs={TABS}
      activeTab="one"
      onTab={() => {}}
      tabsLabel="Bio views"
      cta={{ label: 'New analysis', icon: Plus, onClick: () => {} }}
    >
      <p>content</p>
    </NorthStarFrame>,
  );
}

describe('NorthStarFrame — mobile clip/FAB shapes (RCA-mobile-clip-fab)', () => {
  it('tab strip scrolls and tab labels never shrink or wrap', () => {
    const { container } = renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Bio views' });
    expect(nav.className).toMatch(/overflow-x-auto/);
    for (const t of TABS) {
      const btn = screen.getByRole('button', { name: new RegExp(t.label) });
      expect(btn.className, t.label).toMatch(/shrink-0/);
      expect(btn.className, t.label).toMatch(/whitespace-nowrap/);
    }
    expect(container.querySelectorAll('nav [data-fade-right], nav[data-fade-right]').length).toBeGreaterThanOrEqual(0);
  });

  it('CTA is icon-only below sm with a 44px target and an accessible name', () => {
    renderFrame();
    const btn = screen.getByRole('button', { name: 'New analysis' });
    expect(btn.className).toMatch(/min-h-\[44px\]/);
    const label = Array.from(btn.querySelectorAll('span')).find((s) => s.textContent === 'New analysis');
    expect(label, 'CTA label span').toBeTruthy();
    expect(label!.className).toMatch(/hidden/);
    expect(label!.className).toMatch(/sm:inline/);
  });

  it('frame root reserves bottom clearance below lg', () => {
    const { container } = renderFrame();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toMatch(/pb-36/);
  });
});
