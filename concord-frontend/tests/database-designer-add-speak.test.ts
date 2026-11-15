// FIX-database-003 — the Designer's Add table returned in silence on
// an empty name and announced 'Table added' without ever checking
// the result, so a refused create (name past the 200-char input cap)
// showed success and the refusal side by side and created nothing.
// Both Add paths now speak on blank and on refusal, and announce
// success only on ok — the createSchema (FIX-schema-003) shape.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(__dirname, '..', 'components/database/SchemaDesigner.tsx'), 'utf8');

describe('FIX-database-003 — designer Add speaks and checks its result', () => {
  it('empty table Add names the blocker instead of returning silently', () => {
    expect(src).toContain("say('Name the table first — Add needs a name to create it.')");
    expect(src).not.toContain('if (!active || !newTable.trim()) return;');
  });
  it('a refused table create speaks the refusal; success only on ok', () => {
    expect(src).toContain('Table not added:');
    const addTableAt = src.indexOf('async function addTable()');
    const okCheckAt = src.indexOf('if (!r.data?.ok)', addTableAt);
    const successAt = src.indexOf("say('Table added')", addTableAt);
    expect(okCheckAt).toBeGreaterThan(addTableAt);
    expect(successAt).toBeGreaterThan(okCheckAt);
  });
  it('the sibling column Add carries the same shape', () => {
    expect(src).toContain("say('Name the column first — Add needs a name to create it.')");
    expect(src).toContain('Column not added:');
  });
});
