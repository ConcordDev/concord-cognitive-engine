/**
 * useLensCommand — form-field discipline regression (Graph #1706, F8/S10).
 *
 * The hook binds ALL of a lens's commands through one react-hotkeys-hook
 * binding whose enableOnFormTags is an aggregate: if ANY command is
 * `global`, form tags are enabled for the whole binding. The dispatch
 * callback used to preventDefault + fire whatever matched — so while
 * typing in an input, every shortcut key was swallowed by its command
 * instead of reaching the field (typing "Alpha" into the Explorer's
 * Add Node field lost "p" to the pathfinder shortcut and the spaces to
 * the pause shortcut, producing the saved node "Alha"). Non-global
 * commands must not fire — or eat keystrokes — from form fields;
 * `global` is the documented opt-in.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardProvider } from '@/lib/keyboard';
import { useLensCommand } from '@/hooks/useLensCommand';

function Harness({ onAction }: { onAction: (id: string) => void }) {
  useLensCommand(
    [
      { id: 'pathfinder', keys: 'p', description: 'Pathfinder', category: 'actions', action: () => onAction('p') },
      // A global command in the same lens is what arms the aggregate
      // enableOnFormTags path — without it the bug does not reproduce.
      { id: 'zoom-in', keys: 'mod+=', description: 'Zoom in', category: 'view', global: true, action: () => onAction('zoom') },
    ],
    { lensId: 'graph' },
  );
  return <input aria-label="Node label" />;
}

describe('useLensCommand form-field discipline', () => {
  it('does not fire a non-global shortcut typed into an input', () => {
    const onAction = vi.fn();
    render(
      <KeyboardProvider>
        <Harness onAction={onAction} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText('Node label'), { key: 'p', code: 'KeyP' });
    expect(onAction).not.toHaveBeenCalled();
  });

  it('still fires the same shortcut outside form fields', () => {
    const onAction = vi.fn();
    render(
      <KeyboardProvider>
        <Harness onAction={onAction} />
      </KeyboardProvider>,
    );
    fireEvent.keyDown(document.body, { key: 'p', code: 'KeyP' });
    expect(onAction).toHaveBeenCalledWith('p');
  });
});
