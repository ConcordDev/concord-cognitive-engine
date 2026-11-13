// FIX-export-012 — the Help and feedback popover is a role="dialog": focus
// must move inside when it opens, Tab must cycle within it (not escape to
// the page behind), and closing must return focus to the launcher.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/lenses/export',
}));

import { HelpButton } from '@/components/help/HelpButton';

afterEach(() => cleanup());

describe('FIX-export-012 — Help dialog focus contract', () => {
  it('moves focus in, traps Tab, and returns focus on close', () => {
    render(<HelpButton />);
    const launcher = screen.getByLabelText('Help and feedback');
    launcher.focus();
    fireEvent.click(launcher);

    const dialog = screen.getByRole('dialog', { name: 'Help and feedback' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select, textarea, input')
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    // Tab on the last control wraps to the first — focus cannot leave.
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    // Shift+Tab on the first wraps to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    // Esc closes and focus returns to the launcher.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Help and feedback' })).toBeNull();
    expect(document.activeElement).toBe(launcher);
  });
});
