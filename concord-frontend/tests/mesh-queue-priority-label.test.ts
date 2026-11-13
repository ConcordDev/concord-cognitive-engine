// FIX-mesh-005 — the Queue tab rendered a frame's stored priority
// verbatim, so a junk class (the audit saw the literal
// 'not-a-number') showed as a priority. The server now refuses junk
// priorities at send; the queue renders any pre-existing unknown
// class as 'general' — the class the sorter already assigns it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/mesh/MeshQueue.tsx'), 'utf8');

describe('FIX-mesh-005 — queue never renders a junk priority', () => {
  it('display priority falls back to general for unknown classes', () => {
    expect(src).toContain("const shownPriority = PRIORITIES.includes(f.priority) ? f.priority : 'general';");
    expect(src).toContain('{shownPriority}</span>');
    expect(src).toContain('value={shownPriority}');
    expect(src).not.toContain('>{f.priority}</span>');
  });
});
