/**
 * H4 — the shared NorthStarFrame view tabs are one Tab stop and the arrow
 * keys / Home / End move between them and open the one they land on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';

vi.mock('@/components/lens/CrossLensRecentsPanel', () => ({ CrossLensRecentsPanel: () => null }));

const TABS = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Beta' },
  { id: 'c', label: 'Gamma' },
];

function setup(active = 'a') {
  const onTab = vi.fn();
  render(
    <NorthStarFrame lensId="x" crumb="X" tabs={TABS} activeTab={active} onTab={onTab} tabsLabel="X views">
      <p>body</p>
    </NorthStarFrame>,
  );
  return { onTab, tab: (n: string) => screen.getByRole('button', { name: n }) };
}

describe('H4 view tabs keyboard', () => {
  it('only the active tab is a Tab stop', () => {
    const { tab } = setup('b');
    expect(tab('Alpha').tabIndex).toBe(-1);
    expect(tab('Beta').tabIndex).toBe(0);
    expect(tab('Gamma').tabIndex).toBe(-1);
  });

  it('ArrowRight focuses and opens the next tab; ArrowLeft wraps', () => {
    const { onTab, tab } = setup('a');
    tab('Alpha').focus();
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('Beta'));
    expect(onTab).toHaveBeenLastCalledWith('b');
    fireEvent.keyDown(tab('Alpha'), { key: 'ArrowLeft' });
    expect(onTab).toHaveBeenLastCalledWith('c');
  });

  it('Home and End jump to the ends', () => {
    const { onTab, tab } = setup('b');
    fireEvent.keyDown(tab('Beta'), { key: 'End' });
    expect(onTab).toHaveBeenLastCalledWith('c');
    fireEvent.keyDown(tab('Beta'), { key: 'Home' });
    expect(onTab).toHaveBeenLastCalledWith('a');
  });
});

describe('H4 lens-local strips use the shared helper', () => {
  it('Left/Right move between buttons of a plain nav strip', async () => {
    const { onRovingTabsKeyDown, rovingTabIndex } = await import('@/lib/a11y/roving-tabs');
    const clicked: string[] = [];
    render(
      <nav aria-label="views" onKeyDown={onRovingTabsKeyDown}>
        {['One', 'Two', 'Three'].map((n, i) => (
          <button key={n} type="button" tabIndex={rovingTabIndex(i === 0, i, true)} onClick={() => clicked.push(n)}>{n}</button>
        ))}
      </nav>,
    );
    const one = screen.getByRole('button', { name: 'One' });
    one.focus();
    fireEvent.keyDown(one, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Two' }));
    expect(clicked).toEqual(['Two']);
    expect(screen.getByRole('button', { name: 'Three' }).tabIndex).toBe(-1);
  });
});
