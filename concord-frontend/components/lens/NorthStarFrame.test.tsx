import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefreshCw } from 'lucide-react';
import { NorthStarFrame } from './NorthStarFrame';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({
  CrossLensRecentsPanel: () => null,
}));

const TABS = [
  { id: 'current', label: 'Current' },
  { id: 'matches', label: 'Matches' },
  { id: 'marriages', label: 'Marriages' },
  { id: 'past', label: 'Past' },
];

let scrollIntoViewMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollIntoViewMock = vi.fn();
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    value: scrollIntoViewMock,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  // @ts-expect-error cleanup of the prototype stub
  delete HTMLElement.prototype.scrollIntoView;
});

function renderFrame(activeTab = 'current', onTab = vi.fn()) {
  return render(
    <NorthStarFrame
      lensId="courtship"
      crumb="Courtship"
      tabs={TABS}
      activeTab={activeTab}
      onTab={onTab}
      tabsLabel="Courtship views"
    >
      <p>panel body</p>
    </NorthStarFrame>,
  );
}

describe('NorthStarFrame tab strip (mobile 390 genus)', () => {
  it('renders every tab and the strip scrolls sideways with no native scrollbar bar', () => {
    renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Courtship views' });
    for (const t of TABS) expect(screen.getByRole('button', { name: t.label })).toBeTruthy();
    expect(nav.className).toContain('overflow-x-auto');
    expect(nav.className).toContain('no-scrollbar');
  });

  it('scrolls the active pill into view on mount (an off-screen active tab stays reachable)', () => {
    renderFrame('past');
    expect(scrollIntoViewMock).toHaveBeenCalled();
    const target = scrollIntoViewMock.mock.instances[0] as HTMLElement;
    expect(target.getAttribute('aria-current')).toBe('page');
    expect(target.textContent).toContain('Past');
  });

  // The fade state is asserted through the nav's data-fade-right attribute,
  // not style.maskImage: jsdom's cssstyle drops mask properties in some
  // versions, which made this test fail in other environments while the
  // component behaviour (mask applied from the same state) was identical.
  it('shows no edge fade when the whole strip fits', () => {
    renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Courtship views' }) as HTMLElement;
    expect(nav.getAttribute('data-fade-right')).toBeNull();
  });

  it('fades the right edge while tabs sit off-screen to the right', () => {
    renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Courtship views' }) as HTMLElement;
    Object.defineProperty(nav, 'scrollWidth', { value: 640, configurable: true });
    Object.defineProperty(nav, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(nav, 'scrollLeft', { value: 0, configurable: true });
    fireEvent(window, new Event('resize'));
    expect(nav.getAttribute('data-fade-right')).toBe('true');
    // Scrolled to the end: the cue clears.
    Object.defineProperty(nav, 'scrollLeft', { value: 320, configurable: true });
    fireEvent(nav, new Event('scroll'));
    expect(nav.getAttribute('data-fade-right')).toBeNull();
  });

  it('clicking a pill still switches the view', () => {
    const onTab = vi.fn();
    renderFrame('current', onTab);
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(onTab).toHaveBeenCalledWith('past');
  });
});

describe('NorthStarFrame CTA at phone width (FIX-achievements-004 · FIX-deities-007)', () => {
  it('collapses the CTA label below sm and keeps it as the accessible name', () => {
    const onClick = vi.fn();
    render(
      <NorthStarFrame
        lensId="achievements"
        crumb="Achievements"
        cta={{ label: 'Sync unlocks', icon: RefreshCw, onClick, title: 'Sync' }}
      >
        <p>body</p>
      </NorthStarFrame>,
    );
    const btn = screen.getByTestId('north-star-cta');
    expect(btn.getAttribute('aria-label')).toBe('Sync unlocks');
    const label = screen.getByText('Sync unlocks');
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});
