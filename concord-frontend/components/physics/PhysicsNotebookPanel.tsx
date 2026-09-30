'use client';

/**
 * PhysicsNotebookPanel — lab-notebook literature shelf.
 * Real arXiv physics feed + search. No fabricated papers.
 */

import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PhysicsArxiv } from '@/components/physics/PhysicsArxiv';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import { ds } from '@/lib/design-system';

export function PhysicsNotebookPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className={ds.heading2}>Notebook</h2>
        <p className={ds.textMuted}>
          Live arXiv physics + hep-* — cite into DTUs. Related lenses stay one hop away.
        </p>
      </div>
      <SubLensQuickNav lensId="physics" />
      <ArxivPanel domain="physics" title="arXiv · Physics" />
      <PhysicsArxiv />
    </div>
  );
}
