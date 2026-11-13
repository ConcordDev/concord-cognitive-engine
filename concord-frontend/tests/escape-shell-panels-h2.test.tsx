/**
 * H2 — Escape closes Agent mode and the Activity timeline, and focus
 * returns to the Lens tools trigger that opened them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { handleOverlayKeyDown, rememberOverlayOpener } from '@/lib/a11y/overlay-keyboard';
import LensAgentPanel from '@/components/lens/LensAgentPanel';

vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: vi.fn() },
  apiHelpers: {},
}));

afterEach(() => {
  document.body.innerHTML = '';
});

const esc = () => new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

describe('H2 Escape on shell panels', () => {
  it('Agent mode panel closes on Escape', () => {
    const onClose = vi.fn();
    render(<LensAgentPanel lensId="docs" open onClose={onClose} />);
    handleOverlayKeyDown(esc());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape hands focus back to the remembered trigger', async () => {
    render(
      <>
        <button type="button" data-testid="trigger">Lens tools</button>
        <div data-overlay-open="true" role="region" aria-label="Activity timeline">
          <button type="button" data-overlay-close="" onClick={() => {}}>Close activity timeline</button>
        </div>
      </>,
    );
    rememberOverlayOpener(screen.getByTestId('trigger'));
    handleOverlayKeyDown(esc());
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(document.activeElement).toBe(screen.getByTestId('trigger'));
  });
});
