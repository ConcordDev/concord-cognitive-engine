'use client';

// Phase F3.2 — DreamReader morning brief.
//
// Layer 9 (embodied-dream-cycle) composes one dream DTU per offline
// player per ~6h. Until now those dreams existed in the dreams table
// but no UI surface read them. This component is the morning-brief
// surface: shows last 24h dreams as a dismissible floating card.
//
// Dismiss is per-dream (localStorage 'concordia:dream:seen' set), so
// a player who's seen yesterday's dream doesn't see it again tomorrow,
// but a freshly-composed dream surfaces immediately.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Moon, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useClientConfig } from '@/hooks/useClientConfig';

interface DreamRow {
  id: string;
  user_id: string;
  world_id: string | null;
  dream_dtu_id: string | null;
  fragment_count: number;
  composer: string;
  composed_at: number; // unix seconds
  human_summary?: string | null;
  title?: string | null;
}

const SEEN_KEY = 'concordia:dream:seen';

function loadSeen(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]'));
  } catch { return new Set(); }
}

function saveSeen(seen: Set<string>) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch { /* swallow */ }
}

export function DreamReader() {
  const POLL_MS = useClientConfig().poll.dreamReaderMs; // E0 — server-tunable
  const [dreams, setDreams] = useState<DreamRow[]>([]);
  const [seenIds, setSeenIds] = useState<Set<string>>(() => loadSeen());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/dreams/recent?limit=3', { credentials: 'include' });
      const j = await r.json();
      if (j?.ok && Array.isArray(j.dreams)) setDreams(j.dreams);
    } catch { /* swallow */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh, POLL_MS]);

  // Also refresh on the dream:composed socket event.
  useEffect(() => {
    const onComposed = () => refresh();
    window.addEventListener('concordia:dream-composed', onComposed);
    return () => window.removeEventListener('concordia:dream-composed', onComposed);
  }, [refresh]);

  const unseen = useMemo(
    () => dreams.filter((d) => !seenIds.has(d.id)),
    [dreams, seenIds],
  );

  const markSeen = useCallback((id: string) => {
    const next = new Set(seenIds);
    next.add(id);
    setSeenIds(next);
    saveSeen(next);
  }, [seenIds]);

  const dismiss = useCallback((id: string) => {
    markSeen(id);
    if (expandedId === id) setExpandedId(null);
  }, [markSeen, expandedId]);

  if (unseen.length === 0) return null;

  const formatAgo = (composedAt: number) => {
    const ageSec = Math.floor(Date.now() / 1000) - composedAt;
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
    if (ageSec < 86400) return `${Math.floor(ageSec / 3600)}h ago`;
    return `${Math.floor(ageSec / 86400)}d ago`;
  };

  return (
    <div className="concordia-hud-slide-right pointer-events-auto fixed top-20 right-4 z-30 w-80 rounded-lg border border-indigo-500/40 bg-zinc-950/95 shadow-xl backdrop-blur">
      <header className="flex items-center justify-between border-b border-indigo-500/20 px-3 py-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold text-indigo-200">
          <Moon size={12} /> Last night's dreams
          <span className="ml-1 rounded bg-indigo-500/40 px-1.5 py-0.5 text-[9px] text-indigo-50">{unseen.length}</span>
        </h2>
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
        </button>
      </header>

      {!collapsed && (
        <div className="max-h-96 space-y-2 overflow-y-auto p-2">
          {unseen.map((d) => {
            const isExpanded = expandedId === d.id;
            return (
              <div key={d.id} className="rounded border border-indigo-500/30 bg-indigo-950/30 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 text-xs text-indigo-100">
                    <div className="font-medium">{d.title || 'Dream'}</div>
                    <div className="text-[10px] text-indigo-300/70">
                      {formatAgo(d.composed_at)} · {d.fragment_count} fragments
                      {d.world_id && ` · ${d.world_id}`}
                    </div>
                  </div>
                  <button
                    onClick={() => dismiss(d.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800"
                    aria-label="Mark as seen"
                  >
                    <X size={10} />
                  </button>
                </div>
                {d.human_summary && (
                  <div className="mt-2 text-[11px] leading-relaxed text-zinc-300">
                    {isExpanded
                      ? d.human_summary
                      : d.human_summary.length > 140
                        ? d.human_summary.slice(0, 140) + '…'
                        : d.human_summary}
                  </div>
                )}
                {d.human_summary && d.human_summary.length > 140 && (
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : d.id)}
                    className="mt-1 text-[10px] text-indigo-300 hover:text-indigo-100"
                  >
                    {isExpanded ? 'Show less' : 'Read full'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
