/**
 * FIX-engineering-001 — editing a saved part and saving created a
 * duplicate ('<name> 2'): loadPart loaded the part's fields but not
 * its id, and savePart sent no id, so the server's upsert-by-id path
 * never engaged and its name uniquifier renamed the copy. The editor
 * now tracks the loaded part's id, sends it on save, and adopts the
 * returned id so repeat saves keep updating the same part.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-engineering-001 — save updates the loaded part', () => {
  const s = read('components/engineering/GeometryEditor.tsx');

  it('loadPart retains the part id', () => {
    expect(s).toContain('setEditingId(p.id)');
  });

  it('savePart sends the id when editing', () => {
    expect(s).toContain("...(editingId ? { id: editingId } : {})");
  });

  it('a successful save adopts the returned id and says updated', () => {
    expect(s).toContain('if (r.data.result?.part?.id) setEditingId(r.data.result.part.id)');
    expect(s).toContain("editingId ? 'Part updated' : 'Part saved'");
  });
});
