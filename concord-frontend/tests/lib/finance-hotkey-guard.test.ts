/**
 * GB-1538 / FIX-finance-010 — evidence pin for a verdict closure.
 * The ticket: the cash-flow form intermittently clears and the view
 * jumps to the Planning tab while entering fields across sessions. The
 * one in-code mechanism matching both symptoms is the finance page's
 * digit hotkeys (1–8 switch groups; Planning is '5', an amount digit):
 * a digit typed into a field would switch the group and unmount the
 * form. That path is guarded at this head by the shared
 * shouldIgnoreLensHotkey discipline (RCA-form-hotkey-steal): non-global
 * lens commands yield whenever the keystroke belongs to an editable —
 * by event target, focused element, or composed path. These pins hold
 * the guard to the ticket's exact shape.
 */
import { describe, it, expect } from 'vitest';
import { shouldIgnoreLensHotkey } from '@/lib/a11y/editable-target';

function keyOn(target: EventTarget): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: '5', bubbles: true });
  Object.defineProperty(e, 'target', { value: target });
  return e;
}

describe('finance digit-hotkey guard (FIX-finance-010 evidence)', () => {
  it("typing '5' inside an amount input is ignored by the hotkey layer", () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(shouldIgnoreLensHotkey(keyOn(input))).toBe(true);
    input.remove();
  });

  it("typing '5' inside a textarea or select is likewise ignored", () => {
    const ta = document.createElement('textarea');
    const sel = document.createElement('select');
    document.body.append(ta, sel);
    expect(shouldIgnoreLensHotkey(keyOn(ta))).toBe(true);
    expect(shouldIgnoreLensHotkey(keyOn(sel))).toBe(true);
    ta.remove(); sel.remove();
  });

  it("a '5' keystroke on plain page chrome is NOT ignored (hotkeys still work)", () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    expect(shouldIgnoreLensHotkey(keyOn(div))).toBe(false);
    div.remove();
  });
});
