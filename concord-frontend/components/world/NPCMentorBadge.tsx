'use client';

// Phase BC2 — NPC mentor crown overlay.
//
// Renders a floating crown icon above any NPC whose
// npc_mentor_profiles row exists and is available. Mounted alongside
// the NPC activity tags. The lens passes in the visible NPC list +
// the active world id; the component fetches the mentor list once,
// caches by world, and looks up each NPC against the cached set.

import { useEffect, useMemo, useState } from 'react';
import { Crown } from 'lucide-react';

interface MentorRow {
  npc_id: string;
  skill_category: string;
  depth: number;
  fee_cc: number;
}

interface NPCMentorBadgeProps {
  worldId: string;
  npcId: string;
  projectedX: number;  // screen-space x (px) of the NPC head
  projectedY: number;  // screen-space y (px) of the NPC head
  onClick?: (mentor: MentorRow) => void;
}

const _cache = new Map<string, { ts: number; rows: MentorRow[] }>();
const TTL_MS = 30_000;

async function loadMentors(worldId: string): Promise<MentorRow[]> {
  const cached = _cache.get(worldId);
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.rows;
  try {
    const r = await fetch(`/api/mentors/world/${encodeURIComponent(worldId)}`);
    const j = await r.json();
    if (j?.ok) {
      const rows: MentorRow[] = j.mentors || [];
      _cache.set(worldId, { ts: Date.now(), rows });
      return rows;
    }
  } catch { /* network blip */ }
  return [];
}

export function NPCMentorBadge({ worldId, npcId, projectedX, projectedY, onClick }: NPCMentorBadgeProps) {
  const [mentors, setMentors] = useState<MentorRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadMentors(worldId).then((rows) => { if (!cancelled) setMentors(rows); });
    return () => { cancelled = true; };
  }, [worldId]);

  const mentor = useMemo(() => mentors.find((m) => m.npc_id === npcId), [mentors, npcId]);
  if (!mentor) return null;

  return (
    <button
      onClick={() => onClick?.(mentor)}
      title={`Mentor: ${mentor.skill_category} (depth ${mentor.depth})`}
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-full rounded-full border border-amber-400/60 bg-amber-500/30 p-1 text-amber-200 shadow-lg backdrop-blur hover:bg-amber-500/50"
      style={{ left: projectedX, top: projectedY - 4 }}
    >
      <Crown size={12} />
    </button>
  );
}
