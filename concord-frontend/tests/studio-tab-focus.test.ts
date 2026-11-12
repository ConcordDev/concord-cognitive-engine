// FIX-music-006 — Tab was trapped on the Studio transport's Saved badge:
// the DAW keyboard effect bound Tab itself (preventDefault + Arrange/
// Session view toggle), so sequential focus could never advance past
// whatever control held it. The binding was removed on this branch in
// ca9a0179a ("keep studio focus"); the Editor's handler now handles Space,
// undo/redo, save, duplicate, delete and the R/L/K letters — and leaves
// Tab to the browser. These pins keep it that way, in the source-shape
// style of tests/command-palette-wired.test.tsx: if a Tab binding (or a
// focus-hoarding badge) returns, this file fails before a walker has to.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITOR = path.resolve(__dirname, '..', 'components', 'studio', 'daw', 'Editor.tsx');
const TRANSPORT = path.resolve(__dirname, '..', 'components', 'studio', 'daw', 'TransportBar.tsx');

const editor = readFileSync(EDITOR, 'utf8');
const transport = readFileSync(TRANSPORT, 'utf8');

describe('FIX-music-006 — Tab moves through the Studio', () => {
  it('the DAW keyboard effect does not bind Tab', () => {
    // No key comparison may claim 'tab' (the pre-fix shape was
    // `else if (k === 'tab') { e.preventDefault(); setView(...) }`).
    expect(editor).not.toMatch(/['"]tab['"]\s*\)|===\s*['"]Tab['"]|key\s*===\s*['"]Tab['"]/);
    // The standing comment documents the contract — it must stay with the code.
    expect(editor).toMatch(/Tab and Shift\+Tab move focus/);
  });

  it('the keyboard effect never preventDefaults a Tab keydown', () => {
    const effectStart = editor.indexOf('// ── keyboard ──');
    expect(effectStart).toBeGreaterThan(-1);
    const effect = editor.slice(effectStart, editor.indexOf('addEventListener', effectStart));
    // The contract comment may mention Tab; a key comparison may not.
    expect(effect).not.toMatch(/e\.key[^;\n]*['"]Tab['"]|k\s*===\s*['"]tab['"]/);
  });

  it('the Saved badge stays a plain button in the natural tab order', () => {
    expect(transport).toMatch(/data-testid="studio-save-status"/);
    const badge = transport.slice(transport.indexOf('function SaveBadge'), transport.indexOf('function formatClock'));
    expect(badge).toContain('<button');
    expect(badge).not.toMatch(/tabIndex/);
    expect(badge).not.toMatch(/onKeyDown|onKeyUp/);
  });
});
