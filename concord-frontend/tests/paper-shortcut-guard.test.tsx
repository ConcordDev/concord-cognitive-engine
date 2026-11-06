// S3 acceptance pin (paper F3): the Manuscript search ejection. The
// lens registers bare-key commands at two levels — the page's view
// keys (1–4) and 'n' ("Add a paper": switches to the Library and
// focuses its title field), plus the EditorPanel's tab letters
// (h/e/s/b). At the pass, typing in the Manuscript's search box fired
// those commands mid-word: the view flipped to the Library and the
// tail of the text landed in its add form. The guard lives in
// useLensCommand (form-field keystrokes do not dispatch unless the
// command is global); this pin exercises the REAL hook with Paper's
// exact key sets, reproducing the pass's sequence: keystrokes inside
// an input belong to the field; the same keys on the page body still
// run their commands.
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useLensCommand } from '@/hooks/useLensCommand';

vi.mock('@/lib/keyboard', () => ({
  useKeyboard: () => ({ registerShortcut: () => {}, unregisterShortcut: () => {}, isShortcutEnabled: () => true }),
}));

const PAGE_KEYS = ['1', '2', '3', '4', 'n'];
const TAB_KEYS = ['h', 'e', 's', 'b'];

function Harness({ onCommand }: { onCommand: (k: string) => void }) {
  useLensCommand(
    [...PAGE_KEYS, ...TAB_KEYS].map((k) => ({ id: `cmd-${k}`, keys: k, description: `command ${k}`, action: () => onCommand(k) })),
    { lensId: 'paper' },
  );
  return <input aria-label="Search papers" defaultValue="" />;
}

describe('paper shortcuts vs form fields (F3)', () => {
  it('typing in the search input never fires a view/tab/add command', () => {
    const onCommand = vi.fn();
    const { getByLabelText } = render(<Harness onCommand={onCommand} />);
    const input = getByLabelText('Search papers');
    input.focus();
    // "persistent" — the pass's shape: p-e-r-s-i-s-t-e-n-t carries
    // 'e', 's', and an 'n' that used to eject the user to the Library.
    for (const k of ['p', 'e', 'r', 's', 'i', 's', 't', 'e', 'n', 't']) {
      fireEvent.keyDown(input, { key: k });
    }
    fireEvent.keyDown(input, { key: '1' });
    expect(onCommand).not.toHaveBeenCalled();
  });

  it('the same keys still run their commands from the page body', () => {
    const onCommand = vi.fn();
    render(<Harness onCommand={onCommand} />);
    fireEvent.keyDown(document, { key: 'n', code: 'KeyN' });
    expect(onCommand).toHaveBeenCalledWith('n');
  });
});
