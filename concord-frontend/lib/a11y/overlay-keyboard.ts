/**
 * One document listener for the dialogs lenses roll themselves.
 *
 * Escape activates the top overlay's Close control (Share, Export, and
 * any role=dialog). Tab stays inside an aria-modal dialog. Arrow keys
 * move across a tablist and activate the next tab.
 */

const OVERLAY_SELECTOR = '[role="dialog"], [data-overlay-open="true"]';
const CLOSE_SELECTOR = [
  'button[data-overlay-close]',
  'button[aria-label="Close"]',
  'button[aria-label="Close modal"]',
  'button[aria-label="Dismiss"]',
].join(', ');

function visible(el: HTMLElement): boolean {
  if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === 'function') return check.call(el);
  return el.isConnected;
}

export function topOverlay(root: ParentNode = document): HTMLElement | null {
  const nodes = [...root.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR)].filter(visible);
  return nodes.length ? nodes[nodes.length - 1] : null;
}

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((el) => visible(el) && el.tabIndex !== -1);
}

// "Close", "close", "Close settings", "Cancel", "Dismiss". A longer Cancel
// name (Cancel install, Cancel subscription) is not treated as the dismiss.
const CLOSE_NAME = /^(close(\b.*)?)|(dismiss)|(cancel)$/i;

function closeName(el: HTMLElement): string {
  return (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
}

function closeOverlay(overlay: HTMLElement): boolean {
  const explicit = overlay.querySelector<HTMLElement>(CLOSE_SELECTOR);
  const named = explicit ?? [...overlay.querySelectorAll<HTMLElement>('button')].find((el) => CLOSE_NAME.test(closeName(el)));
  if (!named) return false;
  named.click();
  return true;
}

function moveTab(list: HTMLElement, from: HTMLElement, key: string): boolean {
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"], button')].filter(visible);
  const index = tabs.indexOf(from);
  if (index < 0 || tabs.length < 2) return false;
  const next = key === 'ArrowRight' || key === 'ArrowDown'
    ? tabs[(index + 1) % tabs.length]
    : tabs[(index - 1 + tabs.length) % tabs.length];
  next.focus();
  if (next.getAttribute('role') === 'tab' || next.tagName === 'BUTTON') next.click();
  return true;
}

export function handleOverlayKeyDown(event: KeyboardEvent): void {
  const target = event.target instanceof HTMLElement ? event.target : null;

  if (target && (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    const list = target.closest<HTMLElement>('[role="tablist"]');
    const tab = target.closest<HTMLElement>('[role="tab"], button');
    if (list && tab && list.contains(tab) && moveTab(list, tab, event.key)) {
      event.preventDefault();
      return;
    }
  }

  const overlay = topOverlay();
  if (!overlay) return;

  if (event.key === 'Escape') {
    if (closeOverlay(overlay)) {
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  if (event.key !== 'Tab') return;
  if (overlay.getAttribute('aria-modal') !== 'true' && overlay.getAttribute('role') !== 'dialog') return;
  const items = focusableIn(overlay);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (!active || !overlay.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  }
}

let installed = false;

export function installOverlayKeyboard(): () => void {
  if (installed || typeof document === 'undefined') return () => {};
  installed = true;
  const listener = (event: KeyboardEvent) => handleOverlayKeyDown(event);
  document.addEventListener('keydown', listener, true);
  return () => {
    document.removeEventListener('keydown', listener, true);
    installed = false;
  };
}
