/**
 * Artistry F6 — source pins (vitest on the Mac lane; node:test
 * fallback via run-vitest-as-node). The study card's Delete was a
 * single-click unconfirmed delete — the confirmation family's raw
 * form, filed the same day as game-design F5 and animation F5 and
 * routed into the same combined family slice. The family's two-step
 * applies: the first click arms an in-place "Delete?" confirm; the
 * projectDelete call fires only from the confirm.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const studio = fs.readFileSync(
  path.resolve(__dirname, '../components/artistry/ProjectStudio.tsx'),
  'utf8',
);

describe('artistry F6 — the card delete confirms first', () => {
  it('the delete goes through a per-card confirm state', () => {
    expect(studio).toContain('const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)');
    expect(studio).toContain('onClick={() => setConfirmDeleteId(p.id)}');
  });

  it('the Delete button no longer fires the delete directly', () => {
    expect(studio).not.toContain('<button onClick={() => remove(p.id)} className="text-[11px] text-gray-400 hover:text-red-400');
  });

  it('the confirm is the card delete call site, labelled in place', () => {
    expect(studio).toContain('confirmDeleteId === p.id ? (');
    expect(studio).toContain('onClick={() => remove(p.id)} className="text-[11px] font-semibold text-red-300 flex items-center gap-1"');
    expect(studio).toContain('Delete?');
  });

  it('a completed delete and opening the editor both clear the arm', () => {
    expect(studio).toContain("await lensRun('artistry', 'projectDelete', { projectId: id });\n    setConfirmDeleteId(null);");
    expect(studio).toContain('setEditingId(p.id);\n    setConfirmDeleteId(null);');
  });
});
