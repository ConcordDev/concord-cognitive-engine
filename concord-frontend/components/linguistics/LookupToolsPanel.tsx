'use client';

/**
 * LookupToolsPanel — Datamuse + Free Dictionary + WordLookup.
 * Folded from accordion booleans on the linguistics page.
 */

import { DatamusePanel } from '@/components/linguistics/DatamusePanel';
import { DictionaryPanel } from '@/components/linguistics/DictionaryPanel';
import { WordLookup } from '@/components/linguistics/WordLookup';

export function LookupToolsPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DatamusePanel domain="linguistics" />
        <DictionaryPanel domain="linguistics" />
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Word lookup</h3>
        <WordLookup />
      </div>
    </div>
  );
}
