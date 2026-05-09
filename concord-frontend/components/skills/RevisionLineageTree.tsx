'use client';

// Phase 1: a vertical lineage tree showing each prior skill revision.
// Used inside EvolutionModal AND on the NamedEncounterHUD when the player
// inspects an authored NPC's skill.

import React from 'react';
import { GitBranch, ArrowDown } from 'lucide-react';

interface Revision {
  revision_num?: number;
  level_at_revision?: number;
  name_before?: string;
  name_after?: string;
  max_damage_before?: number;
  max_damage_after?: number;
  description?: string;
  composer?: string;
  author_kind?: string;
  created_at?: number;
}

interface Props {
  revisions: unknown[];
  maxRows?: number;
}

export default function RevisionLineageTree({ revisions, maxRows = 6 }: Props) {
  const rows = (revisions as Revision[]).slice(-maxRows);
  if (rows.length === 0) {
    return <p className="text-xs text-gray-500 italic">No prior revisions — this is the original.</p>;
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => (
        <div key={`${r.revision_num}-${i}`} className="relative">
          <div className="flex items-start gap-2 p-2 rounded bg-zinc-800/40 border border-zinc-700/60">
            <GitBranch className="w-3.5 h-3.5 text-gray-500 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono text-gray-400">rev {r.revision_num}</span>
                <span className="text-gray-500">·</span>
                <span className="font-mono text-gray-300">lvl {Math.round(r.level_at_revision || 0)}</span>
                {r.composer && (
                  <>
                    <span className="text-gray-500">·</span>
                    <span className="text-gray-500 italic">{r.composer.replace('_', ' ')}</span>
                  </>
                )}
                {r.author_kind === 'npc' && (
                  <span className="px-1 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30">NPC</span>
                )}
              </div>
              <p className="text-sm font-mono text-gray-100 truncate">
                {r.name_before} → <span className="text-neon-blue">{r.name_after}</span>
              </p>
              {r.description && (
                <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{r.description}</p>
              )}
              {Number.isFinite(r.max_damage_before) && Number.isFinite(r.max_damage_after) && (
                <p className="text-[11px] text-gray-500 mt-0.5">
                  max damage {r.max_damage_before} → {r.max_damage_after}
                </p>
              )}
            </div>
          </div>
          {i < rows.length - 1 && (
            <ArrowDown className="w-3 h-3 text-gray-600 mx-auto -mb-0.5" />
          )}
        </div>
      ))}
    </div>
  );
}
