/**
 * RCA-form-hotkey-steal: bare-letter lens shortcuts must not run while
 * a create form has focus, including when the key event is retargeted
 * away from the input or when focus sits on modal role="button" chrome
 * that contains the field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const registerShortcut = vi.fn();
const unregisterShortcut = vi.fn();
const useHotkeysSpy = vi.fn();

vi.mock('@/lib/keyboard', () => ({
  useKeyboard: () => ({ registerShortcut, unregisterShortcut, isShortcutEnabled: () => true }),
}));

vi.mock('react-hotkeys-hook', () => ({
  useHotkeys: (...args: unknown[]) => useHotkeysSpy(...args),
}));

import { useLensCommand } from '@/hooks/useLensCommand';

describe('useLensCommand hotkey steal guard', () => {
  beforeEach(() => {
    registerShortcut.mockClear();
    unregisterShortcut.mockClear();
    useHotkeysSpy.mockClear();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });

  function bind() {
    const onTab = vi.fn();
    renderHook(() =>
      useLensCommand(
        [
          { id: 'dispatch', keys: 'd', description: 'Dispatch', action: () => onTab('d') },
          { id: 'meals', keys: 'm', description: 'Meals', action: () => onTab('m') },
        ],
        { lensId: 'household' },
      ),
    );
    const call = useHotkeysSpy.mock.calls[useHotkeysSpy.mock.calls.length - 1] as [
      string,
      (event: KeyboardEvent, handler: { hotkey?: string }) => void,
      { ignoreEventWhen?: (event: KeyboardEvent) => boolean },
    ];
    return { onTab, handler: call[1], options: call[2] };
  }

  it('does not switch tabs when the library retargets the event but the field is focused', () => {
    const { onTab, handler } = bind();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
    Object.defineProperty(event, 'target', { value: document.body });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    handler(event, { hotkey: 'd' });
    expect(onTab).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
    input.remove();
  });

  it('does not switch tabs when focus is on modal chrome that contains a field', () => {
    const { onTab, handler } = bind();
    const chrome = document.createElement('div');
    chrome.setAttribute('role', 'button');
    chrome.tabIndex = 0;
    const input = document.createElement('input');
    chrome.appendChild(input);
    document.body.appendChild(chrome);
    chrome.focus();
    const event = new KeyboardEvent('keydown', { key: 'm', bubbles: true });
    Object.defineProperty(event, 'target', { value: chrome });
    handler(event, { hotkey: 'm' });
    expect(onTab).not.toHaveBeenCalled();
    chrome.remove();
  });

  it('still switches tabs from a button that contains no field', () => {
    const { onTab, handler } = bind();
    const button = document.createElement('div');
    button.setAttribute('role', 'button');
    document.body.appendChild(button);
    button.focus();
    const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
    Object.defineProperty(event, 'target', { value: button });
    handler(event, { hotkey: 'd' });
    expect(onTab).toHaveBeenCalledWith('d');
    button.remove();
  });

  it('ignores field keystrokes before dispatch when the binding has no global command', () => {
    const { options } = bind();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent('keydown', { key: 'd', bubbles: true });
    Object.defineProperty(event, 'target', { value: input });
    expect(options.ignoreEventWhen?.(event)).toBe(true);
    input.remove();
  });
});
