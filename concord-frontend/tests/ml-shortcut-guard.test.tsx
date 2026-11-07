// S-ML-2 acceptance pin (F3): ML's eleven bare-letter tab shortcuts
// must NOT fire while the user types in a form field — the New
// Experiment dialog's fields are plain inputs, and at the pass,
// typing in that dialog leaked keystrokes to the tab shortcuts and
// destroyed the dialog. The guard lives in useLensCommand's
// per-command form-tag discipline (Q82); this test exercises the
// REAL hook + REAL react-hotkeys-hook with ML's exact tab key set:
// keystrokes inside an input belong to the field; the same keys on
// the page body still switch tabs (the guard must not kill the
// shortcuts themselves).
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useLensCommand } from '@/hooks/useLensCommand';

vi.mock('@/lib/keyboard', () => ({
  useKeyboard: () => ({ registerShortcut: () => {}, unregisterShortcut: () => {}, isShortcutEnabled: () => true }),
}));

const ML_TAB_KEYS = ['h', 'p', 'e', 'd', 'c', 'a', 's', 'b', 'x', 'g', 'n'];

function Harness({ onTab }: { onTab: (k: string) => void }) {
  useLensCommand(
    ML_TAB_KEYS.map((k) => ({ id: `tab-${k}`, keys: k, description: `tab ${k}`, action: () => onTab(k) })),
    { lensId: 'ml' },
  );
  return <input aria-label="Experiment name" defaultValue="" />;
}

describe('ML tab shortcuts vs form fields (F3)', () => {
  it('typing in an input never fires a tab shortcut', () => {
    const onTab = vi.fn();
    const { getByLabelText } = render(<Harness onTab={onTab} />);
    const input = getByLabelText('Experiment name');
    input.focus();
    for (const k of ['e', 'x', 'n', 'a', 's']) {
      fireEvent.keyDown(input, { key: k });
    }
    expect(onTab).not.toHaveBeenCalled();
  });

  it('the same keys still switch tabs when focus is on the page body', () => {
    const onTab = vi.fn();
    render(<Harness onTab={onTab} />);
    fireEvent.keyDown(document, { key: 'e', code: 'KeyE' });
    expect(onTab).toHaveBeenCalledWith('e');
  });
});
