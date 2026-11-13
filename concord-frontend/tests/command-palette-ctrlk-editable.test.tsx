// FIX-understanding-001 — Ctrl+K inside a note body must NOT open the
// global Search (command palette) and steal focus. The palette's global
// keydown listener defers to shouldIgnoreLensHotkey (lib/a11y/editable-
// target): a keystroke whose target / focus / composed path sits in an
// editable belongs to the field. This pins both directions with the real
// palette mounted: Ctrl+K from a textarea leaves it closed; the same
// chord from a non-editable surface still opens it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

Element.prototype.scrollIntoView = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lenses/understanding',
}));

import { CommandPalette } from '@/components/common/CommandPalette';

afterEach(() => cleanup());

describe('FIX-understanding-001 — Ctrl+K in an editable keeps the field', () => {
  it('does not open from a textarea (the Understanding note body shape)', () => {
    render(
      <>
        <textarea data-testid="note-body" defaultValue="draft" />
        <CommandPalette />
      </>,
    );
    const note = screen.getByTestId('note-body');
    note.focus();
    expect(document.activeElement).toBe(note);
    fireEvent.keyDown(note, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Search lenses...')).toBeNull();
    expect(document.activeElement).toBe(note);
  });

  it('does not open from a contentEditable note body', () => {
    render(
      <>
        <div data-testid="rich-note" contentEditable suppressContentEditableWarning tabIndex={0}>
          draft
        </div>
        <CommandPalette />
      </>,
    );
    const note = screen.getByTestId('rich-note');
    note.focus();
    fireEvent.keyDown(note, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Search lenses...')).toBeNull();
  });

  it('still opens from a non-editable surface (positive control)', () => {
    render(
      <>
        <div data-testid="plain" tabIndex={0}>board</div>
        <CommandPalette />
      </>,
    );
    const plain = screen.getByTestId('plain');
    plain.focus();
    fireEvent.keyDown(plain, { key: 'k', ctrlKey: true });
    expect(screen.queryByPlaceholderText('Search lenses...')).not.toBeNull();
  });
});
