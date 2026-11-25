// FIX-board-009 — icon-only controls on the Board surface must carry a
// meaningful accessible name: a screen reader announcing "Xcircle" (an
// icon component's name leaked into aria-label) names nothing, and a bare
// "Add" / "Message" beside a field does not say what the control does.
// These pins scan the board components: no aria-label may be a bare
// CamelCase icon name, and the three controls the audit found carry
// their action names.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The Board lens is the Cork Wall now (components/board/wall); scan both folders.
const DIRS = [path.resolve(__dirname, '..', 'components', 'board'), path.resolve(__dirname, '..', 'components', 'board', 'wall')];
const sources = new Map(DIRS.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.tsx')).map((f) => [f, readFileSync(path.join(d, f), 'utf8')] as [string, string])));

describe('FIX-board-009 — board icon-only controls have meaningful names', () => {
  it('the leaked icon-component name is gone from every board file', () => {
    for (const [file, src] of sources) {
      expect(src.includes('aria-label="Xcircle"'), file).toBe(false);
    }
  });

  it('the three audited controls carry their action names', () => {
    // On the card back: the checklist's Add and the comment's Post say what they do.
    expect(sources.get('CardBack.tsx')).toContain('aria-label="Add checklist item"');
    expect(sources.get('CardBack.tsx')).toContain('aria-label="Post comment"');
    expect(sources.get('CardBack.tsx')).toContain('aria-label="Close the card"');
  });
});
