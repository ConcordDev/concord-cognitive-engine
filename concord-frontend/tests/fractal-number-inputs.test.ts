// FIX-fractal-003 — the coordinate fields rewrote typed input on every
// keystroke (parseFloat(x) || 0 bound straight to state): an
// intermediate '-' snapped to 0, '-1' became '01', clearing forced 0.
// The fields now go through ViewNumberInput, which keeps the typed
// text while editing and commits only values that parse.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/fractal/FractalRenderer.tsx'), 'utf8');

describe('FIX-fractal-003 — coordinate inputs do not rewrite typing', () => {
  it('no coordinate field parses with the || 0 snap anymore', () => {
    expect(src).not.toContain('parseFloat(e.target.value) || 0');
  });
  it('all four coordinate fields use the draft-text input', () => {
    for (const field of ['juliaRe', 'juliaIm', 'centerX', 'centerY']) {
      expect(src).toContain(`onCommit={(n) => setView(v => ({ ...v, ${field}: n }))}`);
    }
    expect(src).toContain('function ViewNumberInput');
    expect(src).toContain('value={text ?? String(value)}');
  });
});
