/**
 * FIX-expert-mode-006 — the Expert Mode lens's Lighthouse bundle:
 * contrast and touch targets (no selects exist in this tree; the
 * bundle's Tab leg is satisfied by the shell skip link, which the
 * ticket's own evidence records as present).
 *
 * Heading order, verified against the page's DOM composition:
 * h1 → rail h2s (Threads / Uploads / Spaces, siblings) → turn h3 →
 * turn h4s (Sources / Related) and the Answer-actions h3.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('FIX-expert-mode-006 — expert-mode contrast + targets', () => {
  it('no zinc-600 text or glyph remains in the expert-mode tree', () => {
    for (const f of ['AnswerActionPanel.tsx', 'BrainPoolStatus.tsx', 'ConversationTurn.tsx', 'FocusModeBar.tsx', 'SpacesPanel.tsx', 'ThreadSidebar.tsx', 'UploadSourcePanel.tsx']) {
      expect(read(`components/expert-mode/${f}`).includes('text-zinc-600'), f).toBe(false);
    }
    expect(read('app/lenses/expert-mode/page.tsx').includes('text-zinc-500')).toBe(false);
  });

  it('rail panel titles are h2; the turn-level h3/h4 structure stands', () => {
    expect(read('components/expert-mode/UploadSourcePanel.tsx')).toContain('<h2');
    expect(read('components/expert-mode/SpacesPanel.tsx')).toContain('<h2');
    expect(read('components/expert-mode/ThreadSidebar.tsx')).toContain('<h2');
    expect(read('components/expert-mode/ConversationTurn.tsx')).toContain('<h3');
    expect(read('components/expert-mode/ConversationTurn.tsx')).toContain('<h4');
  });

  it('the bare icon buttons and small action chips carry the target floor', () => {
    const spaces = read('components/expert-mode/SpacesPanel.tsx');
    expect(spaces).toContain('min-w-11');
    const threads = read('components/expert-mode/ThreadSidebar.tsx');
    expect(threads).toContain('min-w-11');
    expect(read('components/expert-mode/FocusModeBar.tsx')).toContain('min-h-11');
    expect(read('components/expert-mode/ConversationTurn.tsx')).toContain('min-h-11');
  });
});
