'use client';

// Phase 1: Named-encounter HUD.
//
// When a player engages a named NPC (Sovereign, Concordia goddess, faction
// leaders), this widget reads the NPC's primary skill lineage and shows a
// compressed depth indicator: "Sovereign — primary skill: Refusal-Verb
// Mark IX, lineage 2,047 revisions, max_damage 12,840". Tells the player
// at a glance how far the NPC has evolved their craft.
//
// Mounted alongside the dialogue HUD; opens on first interaction with a
// named NPC. Read-only.

import React, { useEffect, useState } from 'react';
import { api } from '@/lib/api/client';
import { Crown } from 'lucide-react';
import RevisionLineageTree from '../skills/RevisionLineageTree';

interface Props {
  npcId: string | null;
  npcName?: string;
  onDismiss?: () => void;
}

interface SkillRow { id: string; current_name?: string; max_damage?: number; revision_num?: number }

async function postLensRun<T>(domain: string, name: string, input: object): Promise<T> {
  const res = await api.post('/api/lens/run', { domain, name, input });
  return res.data as T;
}

export default function NamedEncounterHUD({ npcId, npcName, onDismiss }: Props) {
  const [skill, setSkill] = useState<SkillRow | null>(null);
  const [history, setHistory] = useState<unknown[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!npcId) return;
    setLoading(true);
    (async () => {
      try {
        // Find NPC's primary recipe via the marketplace lens listing.
        // For now, we do a simple lookup via dtu list scoped to the NPC creator.
        const listRes = await postLensRun<{ ok: boolean; dtus?: SkillRow[] }>(
          'dtu', 'list', { creator_id: npcId, kind: 'fighting_style_recipe', limit: 1 },
        );
        const top = listRes?.dtus?.[0];
        if (!top) {
          setSkill(null);
          setHistory([]);
          setTotal(0);
          return;
        }
        setSkill(top);
        const histRes = await postLensRun<{ ok: boolean; rows?: unknown[]; total?: number }>(
          'skill_evolution', 'history', { recipeId: top.id, limit: 8 },
        );
        setHistory(histRes.rows || []);
        setTotal(histRes.total || 0);
      } catch {
        // tolerant — named-encounter HUD is decorative
      } finally {
        setLoading(false);
      }
    })();
  }, [npcId]);

  if (!npcId) return null;

  return (
    <div className="absolute top-4 right-4 w-[360px] bg-zinc-900/95 border border-amber-500/40 rounded-lg shadow-xl backdrop-blur-sm">
      <header className="flex items-center justify-between p-3 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <Crown className="w-4 h-4 text-amber-400" />
          <p className="text-sm font-semibold text-gray-100">{npcName || 'Named Encounter'}</p>
        </div>
        {onDismiss && (
          <button onClick={onDismiss} className="text-xs text-gray-500 hover:text-gray-300">×</button>
        )}
      </header>
      <div className="p-3 space-y-2">
        {loading && <p className="text-xs text-gray-500">Reading lineage…</p>}
        {!loading && !skill && (
          <p className="text-xs text-gray-500 italic">No authored skill on record.</p>
        )}
        {skill && (
          <>
            <div className="text-xs text-gray-400">Primary skill</div>
            <p className="font-mono text-sm text-amber-200">{skill.current_name || 'unnamed'}</p>
            <div className="flex gap-3 text-xs text-gray-300">
              <span>lineage <strong>{total}</strong> revisions</span>
              <span>max damage <strong>{skill.max_damage ?? '—'}</strong></span>
            </div>
            {history.length > 0 && (
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">Recent revisions</p>
                <RevisionLineageTree revisions={history} maxRows={4} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
