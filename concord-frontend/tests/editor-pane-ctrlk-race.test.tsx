// Verification-audit fix — duplicate-handler-race pinning test.
//
// EditorPane.tsx binds Cmd/Ctrl+K globally to open its inline-edit modal
// when a selection is active. CommandPalette.tsx (mounted app-wide via
// AppShell) ALSO binds Cmd/Ctrl+K globally, on `document` in the bubble
// phase. Before the fix, pressing Cmd/Ctrl+K while editing code with a
// selection opened BOTH the inline-edit modal AND the command palette
// simultaneously. The fix registers EditorPane's listener on `window` in
// the CAPTURE phase and only calls stopPropagation() when it actually
// consumes the combo (a selection is present) — so the palette's binding
// (documented as sacred, never rebind) stays untouched but doesn't fire
// when EditorPane claims the shortcut, and still fires normally when
// EditorPane has nothing selected.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

Element.prototype.scrollIntoView = vi.fn();

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lenses/code',
}));

let capturedOnSelectionChange: ((sel: { text: string }) => void) | null = null;
vi.mock('next/dynamic', () => ({
  default: () => (props: Record<string, unknown>) => {
    capturedOnSelectionChange = props.onSelectionChange as (sel: { text: string }) => void;
    return React.createElement('div', { 'data-testid': 'fake-monaco' });
  },
}));

vi.mock('@/lib/api/client', () => ({
  lensRun: vi.fn(async ({ action }: { action: string }) => {
    if (action === 'files-read') {
      return { data: { ok: true, result: { content: 'const x = 1;', language: 'typescript' } } };
    }
    return { data: { ok: true, result: {} } };
  }),
}));

import { EditorPane } from '@/components/code/EditorPane';
import { CommandPalette } from '@/components/common/CommandPalette';

// Dispatch on document.body (not window directly) so the event follows the
// real browser propagation path — target -> ... -> document -> window —
// and both document-level (CommandPalette) and window-level (EditorPane)
// listeners see it, exactly as a real keypress would.
function pressCtrlK() {
  fireEvent(document.body, new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
}

describe('EditorPane vs CommandPalette — Cmd/Ctrl+K duplicate-handler race', () => {
  beforeEach(() => {
    mockPush.mockClear();
    capturedOnSelectionChange = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('with an active selection: Ctrl+K opens inline-edit and does NOT also open the command palette', async () => {
    const onPaletteClose = vi.fn();
    render(
      <>
        <EditorPane projectId="proj-1" openPath="/index.ts" onOpenChange={vi.fn()} />
        <CommandPalette onClose={onPaletteClose} />
      </>
    );

    await waitFor(() => expect(screen.getByTestId('fake-monaco')).toBeInTheDocument());
    act(() => { capturedOnSelectionChange?.({ text: 'const x = 1;' }); });

    pressCtrlK();

    await waitFor(() => expect(screen.getByPlaceholderText(/Inline edit/)).toBeInTheDocument());
    // CommandPalette must not have been toggled open by the same keypress.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('with no selection: Ctrl+K does not open inline-edit and lets the event reach the command palette', async () => {
    render(
      <>
        <EditorPane projectId="proj-1" openPath="/index.ts" onOpenChange={vi.fn()} />
        <CommandPalette onClose={vi.fn()} />
      </>
    );

    await waitFor(() => expect(screen.getByTestId('fake-monaco')).toBeInTheDocument());
    // No onSelectionChange call — selection stays empty.

    pressCtrlK();

    expect(screen.queryByPlaceholderText(/Inline edit/)).not.toBeInTheDocument();
    // The command palette's own document-level listener must still have
    // received the event (not swallowed) — it opens on Ctrl+K.
    await waitFor(() => expect(screen.getByRole('combobox')).toBeInTheDocument());
  });
});
