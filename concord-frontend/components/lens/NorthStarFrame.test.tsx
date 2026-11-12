import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('shows no edge fade when the whole strip fits', () => {
    renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Courtship views' }) as HTMLElement;
    expect(nav.style.maskImage ?? '').toBe('');
  });

  it('fades the right edge while tabs sit off-screen to the right', () => {
    renderFrame();
    const nav = screen.getByRole('navigation', { name: 'Courtship views' }) as HTMLElement;
    Object.defineProperty(nav, 'scrollWidth', { value: 640, configurable: true });
    Object.defineProperty(nav, 'clientWidth', { value: 320, configurable: true });
    Object.defineProperty(nav, 'scrollLeft', { value: 0, configurable: true });
    fireEvent(window, new Event('resize'));
    expect(nav.style.maskImage).toContain('linear-gradient');
    // Scrolled to the end: the cue clears.
    Object.defineProperty(nav, 'scrollLeft', { value: 320, configurable: true });
    fireEvent(nav, new Event('scroll'));
    expect(nav.style.maskImage ?? '').toBe('');
  });

  it('clicking a pill still switches the view', () => {
    const onTab = vi.fn();
    renderFrame('current', onTab);
    fireEvent.click(screen.getByRole('button', { name: 'Past' }));
    expect(onTab).toHaveBeenCalledWith('past');
  });
});
