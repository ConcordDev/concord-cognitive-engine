'use client';

/**
 * DreamPanel — surfaces the player's recent dreams and active forward-sim
 * predictions in a single tabbed panel mounted in PanelHost
 * (panelId='dreams'). Read-only.
 *
 * The dream-engine composes one dream DTU per offline pass (~6h cooldown,
 * 12h activity window) so this panel becomes the player's record of
 * what their subconscious did while they were logged out.
 *
 * forward-sim predictions are anticipations the subconscious-brain
 * generated about quests / NPCs / factions / decisions / self. The HUD
 * shows confidence as a colored chip and an expires_at countdown.
 */

import { useCallback, useEffect, useState } from 'react';

type Tab = 'dreams' | 'predictions';

interface DreamRow {
  id: string;
  dream_dtu_id: string;
  fragment_count: number;
  composer: string;
  composed_at: number;
  dtu?: {
    id: string;
    title?: string;
    data?: {
      human_summary?: string;
      core?: { prose?: string; fragments?: string[] };
      machine?: { signature?: string };
    } | string | null;
  } | null;
}

interface PredictionRow {
  id: string;
  subject_kind: string;
  subject_id: string;
  anticipated: string;
  confidence: number;
  composer: string;
  composed_at: number;
  expires_at: number;
}

function fmtAgo(epochS: number): string {
  const dt = Math.floor(Date.now() / 1000) - epochS;
  if (dt < 60) return `${dt}s ago`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m ago`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h ago`;
  return `${Math.floor(dt / 86400)}d ago`;
}

function fmtUntil(epochS: number): string {
  const dt = epochS - Math.floor(Date.now() / 1000);
  if (dt <= 0) return 'expired';
  if (dt < 60) return `${dt}s`;
  if (dt < 3600) return `${Math.floor(dt / 60)}m`;
  if (dt < 86400) return `${Math.floor(dt / 3600)}h`;
  return `${Math.floor(dt / 86400)}d`;
}

function confidenceTone(c: number): string {
  if (c >= 0.7) return 'bg-emerald-900/40 text-emerald-300 border-emerald-700/40';
  if (c >= 0.45) return 'bg-amber-900/40 text-amber-300 border-amber-700/40';
  return 'bg-zinc-900/40 text-zinc-300 border-zinc-700/40';
}

function dreamProse(d: DreamRow): string {
  const data = d.dtu?.data;
  if (!data || typeof data === 'string') return data as string | undefined ?? '';
  return data.human_summary
    ?? data.core?.prose
    ?? (data.core?.fragments ? data.core.fragments.join(' · ') : '')
    ?? '';
}

export function DreamPanel() {
  const [tab, setTab] = useState<Tab>('dreams');
  const [dreams, setDreams] = useState<DreamRow[]>([]);
  const [preds, setPreds] = useState<PredictionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      const macro = t === 'dreams' ? 'recent' : 'predictions';
      const r = await fetch('/api/lens/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: 'dreams', name: macro, input: { limit: 20 } }),
      });
      const j = await r.json();
      if (j?.ok) {
        if (t === 'dreams') setDreams((j.dreams || []) as DreamRow[]);
        else setPreds((j.predictions || []) as PredictionRow[]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchTab(tab); }, [tab, fetchTab]);

  return (
    <div className="text-sm" data-testid="dream-panel">
      <p className="text-xs text-zinc-400 mb-2">
        What your subconscious wrote while you were away — composed by the dream-engine and forward-sim.
      </p>

      <div className="flex gap-1 mb-3 border-b border-zinc-800">
        {(['dreams', 'predictions'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            data-tab={t}
            aria-pressed={tab === t}
            className={`px-3 py-1 text-xs font-medium rounded-t ${
              tab === t ? 'bg-zinc-800 text-amber-200' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t === 'dreams' ? 'Dreams' : 'Anticipations'}
          </button>
        ))}
      </div>

      {loading && <p className="text-xs text-zinc-400">Loading…</p>}

      {tab === 'dreams' && !loading && (
        <div className="space-y-2 max-h-[24rem] overflow-auto">
          {dreams.length === 0 && (
            <p className="text-xs text-zinc-400 italic">No dreams composed yet. The engine waits for ~12h of activity then ~6h offline before composing.</p>
          )}
          {dreams.map((d) => (
            <div
              key={d.id}
              data-dream-id={d.id}
              className="p-2 rounded border bg-zinc-900/40 border-zinc-800"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-zinc-100 truncate">{d.dtu?.title || 'Untitled dream'}</span>
                <span className="text-[10px] font-mono text-zinc-400">{fmtAgo(d.composed_at)}</span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-snug whitespace-pre-line">{dreamProse(d) || '(no prose)'}</p>
              <p className="mt-1 text-[10px] text-zinc-400">{d.fragment_count} fragments · composer: {d.composer}</p>
            </div>
          ))}
        </div>
      )}

      {tab === 'predictions' && !loading && (
        <div className="space-y-2 max-h-[24rem] overflow-auto">
          {preds.length === 0 && (
            <p className="text-xs text-zinc-400 italic">No active anticipations. The forward-sim runs every ~25min for offline players.</p>
          )}
          {preds.map((p) => (
            <div
              key={p.id}
              data-prediction-id={p.id}
              className="p-2 rounded border bg-zinc-900/40 border-zinc-800"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-zinc-100">{p.subject_kind}: <span className="font-mono text-amber-200">{p.subject_id}</span></span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceTone(p.confidence)}`}>
                  conf {(p.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <p className="text-[11px] text-zinc-300 leading-snug">{p.anticipated}</p>
              <p className="mt-1 text-[10px] text-zinc-400">composer: {p.composer} · expires in {fmtUntil(p.expires_at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
