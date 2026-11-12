/**
 * hotkey-typing-genus.test.ts — CB-0470 guard (B6).
 *
 * A keystroke that lands in a field belongs to the field. The shared
 * guard (lib/a11y/editable-target.ts, from the RCA-form-hotkey-steal fix)
 * covers the palette paths and the lens registry; these pins hold the
 * one listener that routed around it — the ConKay overlay's summon key —
 * and keep the cured paths cured.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FE = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');

describe('CB-0470 hotkeys-while-typing genus', () => {
  it('FIX-linguistics-007: the ConKay summon key stands down on Shift (DevTools) and in fields', () => {
    const src = read('components/conkay/ConKayOverlay.tsx');
    expect(src).toContain('!e.shiftKey');
    expect(src).toContain('shouldIgnoreLensHotkey(e)');
    expect(src).toContain("from '@/lib/a11y/editable-target'");
  });

  it('the shared guard is a real editable-target predicate (not a stub)', () => {
    const src = read('lib/a11y/editable-target.ts');
    expect(src).toContain('export function shouldIgnoreLensHotkey');
    expect(src).toContain('isFormFieldEvent');
    expect(src).toContain('contenteditable');
  });

  it('the global Ctrl/Cmd+K palette paths apply the guard (poetry/creator/energy surfaces)', () => {
    const palette = read('components/common/CommandPalette.tsx');
    expect(palette).toContain('shouldIgnoreLensHotkey(e)');
    const kb = read('lib/keyboard.tsx');
    expect(kb).toContain("useHotkeys('mod+k'");
    expect(kb).toContain('shouldIgnoreLensHotkey(e)');
  });

  it('lens hotkey registrations stand down in form fields unless explicitly global (game surface)', () => {
    const kb = read('lib/keyboard.tsx');
    expect(kb).toContain('if (!global && shouldIgnoreLensHotkey(e)) return;');
    expect(kb).toContain("enableOnFormTags: options.global ? ['INPUT', 'TEXTAREA', 'SELECT'] : false");
  });
});
