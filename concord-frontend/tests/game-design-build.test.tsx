/**
 * Game-design F5 fix return — source pins (vitest on the Mac lane;
 * node:test fallback via run-vitest-as-node). The design chip's × was
 * a single-click unconfirmed delete of the whole design — the
 * confirmation family's raw form (Masonry F4 · Plumbing F6 · Creative
 * F9 · Gallery F6 are its wired siblings). The family's two-step
 * applies: the first click arms an in-place "Delete?" confirm; the
 * game-delete call fires only from the confirm.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const section = fs.readFileSync(
  path.resolve(__dirname, '../components/game-design/GameDesignSection.tsx'),
  'utf8',
);

describe('game-design F5 — the chip delete confirms first', () => {
  it('the delete goes through a per-chip confirm state', () => {
    expect(section).toContain('const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)');
    expect(section).toContain('onClick={() => setConfirmDeleteId(g.id)}');
  });

  it('the × no longer fires the delete directly', () => {
    expect(section).not.toContain('onClick={() => delGame(g.id)} className="text-zinc-300/70');
  });

  it('the confirm is the chip delete call site, labelled in place', () => {
    expect(section).toContain('confirmDeleteId === g.id ? (');
    expect(section).toContain('onClick={() => delGame(g.id)} className="text-rose-200 font-semibold">Delete?</button>');
  });

  it('a completed delete and a chip switch both clear the arm', () => {
    expect(section).toContain("await lensRun('game-design', 'game-delete', { id });\n    setConfirmDeleteId(null);");
    expect(section).toContain('onClick={() => { setActiveGame(g.id); setConfirmDeleteId(null); }}');
  });
});
