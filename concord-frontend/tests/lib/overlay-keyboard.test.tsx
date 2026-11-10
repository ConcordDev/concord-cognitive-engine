/**
 * Escape closes the top dialog, Tab wraps inside it, and arrow keys
 * move a tablist. One listener covers Share, Export, and lens dialogs.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { handleOverlayKeyDown, installOverlayKeyboard } from '@/lib/a11y/overlay-keyboard';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('overlay keyboard', () => {
  it('Escape clicks Close on the top dialog and leaves a lower one', () => {
    const low = vi.fn();
    const high = vi.fn();
    render(
      <>
        <div role="dialog" aria-modal="true" aria-label="Lower">
          <button type="button" aria-label="Close" onClick={low}>Close lower</button>
        </div>
        <div role="dialog" aria-modal="true" aria-label="Upper">
          <button type="button" aria-label="Close" onClick={high}>Close upper</button>
        </div>
      </>,
    );
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    handleOverlayKeyDown(event);
    expect(high).toHaveBeenCalledTimes(1);
    expect(low).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Tab wraps from the last control back to the first', () => {
    render(
      <div role="dialog" aria-modal="true" aria-label="Form">
        <button type="button">One</button>
        <button type="button">Two</button>
      </div>,
    );
    const two = screen.getByRole('button', { name: 'Two' });
    two.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    handleOverlayKeyDown(event);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'One' }));
    expect(event.defaultPrevented).toBe(true);
  });

  it('ArrowRight moves to the next tab and activates it', () => {
    const onSecond = vi.fn();
    render(
      <div role="tablist" aria-label="Views">
        <button type="button" role="tab" onClick={() => {}}>Library</button>
        <button type="button" role="tab" onClick={onSecond}>Studio</button>
      </div>,
    );
    screen.getByRole('tab', { name: 'Library' }).focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'target', { value: screen.getByRole('tab', { name: 'Library' }) });
    handleOverlayKeyDown(event);
    expect(onSecond).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Studio' }));
  });

  it('installs a single capture listener', () => {
    const removeA = installOverlayKeyboard();
    const removeB = installOverlayKeyboard();
    removeB();
    removeA();
    const high = vi.fn();
    render(
      <div role="dialog" aria-label="After">
        <button type="button" aria-label="Close" onClick={high}>Close</button>
      </div>,
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(high).not.toHaveBeenCalled();
  });
});
