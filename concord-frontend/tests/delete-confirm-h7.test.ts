/**
 * H7 — saved-record deletes in fashion, home-improvement, observe and the
 * meta dev portal go through the sticky two-step confirm.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (f: string) => readFileSync(resolve(__dirname, `../components/${f}`), 'utf8');

const CASES: Array<[string, string[]]> = [
  ['fashion/FashionClosetPanel.tsx', ['del(i.id)']],
  ['fashion/FashionOutfitsPanel.tsx', ['del(o.id)']],
  ['fashion/FashionCapsulePanel.tsx', ['delCapsule(c.id)']],
  ['fashion/FashionMoodboardPanel.tsx', ['deleteBoard(b.id)']],
  ['fashion/FashionSocialPanel.tsx', ['del(p.id)']],
  ['fashion/FashionWishlistPanel.tsx', ['remove(w.id)']],
  ['home-improvement/PhotoGallery.tsx', ['remove(e.id)']],
  ['home-improvement/ProjectGantt.tsx', ['deletePhase(b.id)']],
  ['home-improvement/ShoppingList.tsx', ['remove(it.id)']],
  ['home-improvement/IdeaBoards.tsx', ['removeBoard(b.id)', 'removeIdea(b.id, idea.id)']],
  ['home-improvement/ContractorDirectory.tsx', ['removePro(p.id)']],
  ['home-improvement/ProjectsPanel.tsx', ['deleteProject(p.id)']],
  ['home-improvement/MaintenanceReminders.tsx', ['remove(r.id)']],
  ['home-improvement/HomeInventory.tsx', ['remove(a.id)']],
  ['observe/ObservePlatform.tsx', ['del(d.id)', 'removeWidget(w.id)', 'del(m.id)', 'del(c.id)']],
  ['meta/DevPortal.tsx', ['remove(svc.id)']],
];

describe('H7 delete confirms', () => {
  it.each(CASES)('%s arms before it deletes', (file, calls) => {
    const s = read(file);
    expect(s).toContain("from '@/components/common/StickyDeleteConfirm'");
    for (const c of calls) {
      expect(s).toContain(`onConfirm={() => ${c}}`);
      // the handler is only reachable through onConfirm, never a bare click
      expect(s).not.toContain(`onClick={() => ${c}}`);
    }
  });
});
