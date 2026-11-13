/**
 * FIX-graph-004 — the Graph field (default view) had no pan/zoom:
 * dragging did nothing, the wheel scrolled the page, and dense
 * fields overlapped at 390px. The field now wraps in a view
 * transform with background-drag pan, non-passive wheel zoom at the
 * pointer, and explicit zoom controls.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-graph-004 — field pan/zoom', () => {
  const s = read('components/graph/GraphField.tsx');

  it('wraps the field in a view transform with pan, wheel zoom, and buttons', () => {
    expect(s).toContain('translate(${view.x},${view.y}) scale(${view.k})');
    expect(s).toContain("addEventListener('wheel'");
    expect(s).toContain('onPointerDown');
    expect(s).toContain('aria-label="Zoom in"');
    expect(s).toContain('aria-label="Reset view"');
    expect(s).toContain('Drag to pan · scroll to zoom');
  });
});
