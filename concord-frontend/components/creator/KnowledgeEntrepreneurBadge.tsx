'use client';

/**
 * KnowledgeEntrepreneurBadge — surfaces the player's composite Phase-1
 * Knowledge Entrepreneur tier (Trader / Operator / Entrepreneur / Magnate
 * / Sovereign) as a headline pill on the creator dashboard. Wraps the
 * existing /api/creator/badges/:userId endpoint, which since Phase 1 also
 * computes the new knowledge_entrepreneur category.
 */

import { useEffect, useState } from 'react';

interface Badge {
  key: string;
  category: string;
  tier: string;
  label: string;
  threshold: number;
}

const TIER_COLORS: Record<string, string> = {
  bronze: 'from-amber-700 to-amber-600 border-amber-500 text-amber-50',
  silver: 'from-slate-400 to-slate-300 border-slate-200 text-slate-900',
  gold: 'from-yellow-500 to-yellow-400 border-yellow-300 text-yellow-900',
  platinum: 'from-cyan-400 to-cyan-300 border-cyan-200 text-cyan-900',
  diamond: 'from-purple-500 via-pink-500 to-purple-600 border-purple-200 text-white',
};

export default function KnowledgeEntrepreneurBadge({ userId }: { userId: string }) {
  const [badges, setBadges] = useState<Badge[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    (async () => {
      const r = await fetch(`/api/creator/badges/${encodeURIComponent(userId)}`).catch(() => null);
      const data = r ? await r.json().catch(() => null) : null;
      if (alive && data?.ok) setBadges(data.badges || []);
    })();
    return () => { alive = false; };
  }, [userId]);

  // Find the highest-tier knowledge_entrepreneur badge.
  const ke = badges
    .filter(b => b.category === 'knowledge_entrepreneur')
    .sort((a, b) => b.threshold - a.threshold)[0];

  if (!ke) return null;

  const tierClass = TIER_COLORS[ke.tier] || TIER_COLORS.bronze;
  return (
    <div className={`inline-flex items-center gap-2 bg-gradient-to-br ${tierClass} border rounded-full px-3 py-1 shadow-md text-xs font-bold uppercase tracking-wider`}>
      <span aria-hidden="true">⌬</span>
      <span>{ke.label}</span>
    </div>
  );
}
