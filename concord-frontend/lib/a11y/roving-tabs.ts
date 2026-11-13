import type { KeyboardEvent } from 'react';

/**
 * Keyboard contract for a strip of view-switching buttons (a <nav> of
 * buttons, or a role="tablist"): the strip is one Tab stop, and
 * Left/Right/Home/End move focus to a sibling button and open it.
 * Put on the strip's onKeyDown; give each button tabIndex={rovingTabIndex(...)}.
 */
export function onRovingTabsKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
  const from = items.indexOf(e.target as HTMLButtonElement);
  if (from < 0 || items.length < 2) return;
  e.preventDefault();
  const last = items.length - 1;
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? last
    : e.key === 'ArrowRight' ? (from + 1) % items.length : (from - 1 + items.length) % items.length;
  items[to].focus();
  items[to].click();
}

/** 0 for the active tab (or the first when none is active), -1 for the rest. */
export function rovingTabIndex(isActive: boolean, index: number, anyActive: boolean): 0 | -1 {
  return isActive || (!anyActive && index === 0) ? 0 : -1;
}
