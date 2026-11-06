/**
 * Animation F5 fix return — source pins (vitest on the Mac lane;
 * node:test fallback via run-vitest-as-node). The gallery card's
 * Delete was a single-click unconfirmed delete of the whole shot —
 * the confirmation family's raw form, filed the same day as
 * game-design's F5 and routed as one combined family slice with it.
 * The family's two-step applies: the first click arms an in-place
 * "Delete?" confirm; the anim-delete call fires only from the
 * confirm.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const section = fs.readFileSync(
  path.resolve(__dirname, '../components/animation/AnimationStudioSection.tsx'),
  'utf8',
);

describe('animation F5 — the card delete confirms first', () => {
  it('the delete goes through a per-card confirm state', () => {
    expect(section).toContain('const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)');
    expect(section).toContain('onClick={() => setConfirmDeleteId(a.id)}');
  });

  it('the trash icon no longer fires the delete directly', () => {
    expect(section).not.toContain('aria-label="Delete" type="button" onClick={() => del(a.id)}');
  });

  it('the confirm is the card delete call site, labelled in place', () => {
    expect(section).toContain('confirmDeleteId === a.id ? (');
    expect(section).toContain('onClick={() => del(a.id)} className="text-[11px] font-semibold text-rose-300 shrink-0">Delete?</button>');
  });

  it('a completed delete and opening a card both clear the arm', () => {
    expect(section).toContain("await lensRun('animation', 'anim-delete', { id });\n    setConfirmDeleteId(null);");
    expect(section).toContain('onClick={() => { setOpen(a.id); setConfirmDeleteId(null); }}');
  });
});
