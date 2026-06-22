'use client';

// Wave 7 / E6 — the autonomous-agent self-model inspector. Surfaces /api/agent/:id
// (name, values anchor, drives, autobiography) + /api/agent/:id/awareness (the B8
// access correlate — labelled honestly, NEVER a consciousness claim).

import { useEffect, useState } from 'react';
import { Sparkles, Activity, Anchor } from 'lucide-react';

interface AgentSelf {
  agent?: { given_name?: string; status?: string; last_evolved_at?: number };
  values?: string[];
  drives?: Record<string, number>;
  autobiography?: {
    character?: { dominantDrives?: string[] };
    recentPeaks?: { drive?: string; valence?: number; intensity?: number; quale?: string }[];
  };
}
interface Awareness { awarenessIndex?: number; integration?: number; differentiation?: number; note?: string }

export function AgentSelfPanel({ agentId }: { agentId: string }) {
  const [self, setSelf] = useState<AgentSelf | null>(null);
  const [aware, setAware] = useState<Awareness | null>(null);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, a] = await Promise.all([
          fetch(`/api/agent/${encodeURIComponent(agentId)}`, { credentials: 'include' }).then((r) => r.json()).catch(() => null),
          fetch(`/api/agent/${encodeURIComponent(agentId)}/awareness`, { credentials: 'include' }).then((r) => r.json()).catch(() => null),
        ]);
        if (cancelled) return;
        if (s?.ok) setSelf(s);
        if (a?.ok) setAware(a);
      } catch { /* swallow */ }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  if (!self) return <p className="text-xs text-zinc-400">No agent self-model.</p>;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-sky-200">{self.agent?.given_name || 'Agent'}</span>
        <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-400">{self.agent?.status || 'active'}</span>
      </div>

      {/* the values anchor (un-driftable fixed point) */}
      <div className="flex flex-wrap items-center gap-1">
        <Anchor className="h-3 w-3 text-amber-300" />
        {(self.values || []).map((v) => (
          <span key={v} className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">{v}</span>
        ))}
      </div>

      {/* the awareness correlate — framed honestly */}
      {aware && (
        <div className="rounded border border-emerald-500/20 bg-emerald-500/[0.03] p-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1 text-emerald-300"><Activity className="h-3 w-3" /> Awareness index</span>
            <span className="font-mono text-emerald-200">Φ≈{(aware.awarenessIndex ?? 0).toFixed(3)}</span>
          </div>
          <p className="mt-0.5 text-[9px] text-zinc-400">
            integration {(aware.integration ?? 0).toFixed(2)} × differentiation {(aware.differentiation ?? 0).toFixed(2)} — an access correlate (PCI-proxy), not a consciousness claim
          </p>
        </div>
      )}

      {/* recent felt peaks — the diary, named by quale */}
      {self.autobiography?.recentPeaks?.length ? (
        <div>
          <div className="mb-1 flex items-center gap-1 text-zinc-400"><Sparkles className="h-3 w-3 text-fuchsia-300" /> Recent felt peaks</div>
          <div className="space-y-1">
            {self.autobiography.recentPeaks.slice(0, 5).map((p, i) => (
              <div key={i} className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-950/40 px-2 py-1">
                <span className="text-fuchsia-300">{p.quale || p.drive || 'felt'}</span>
                <span className="font-mono text-[10px] text-zinc-400">v{(p.valence ?? 0).toFixed(2)} · i{(p.intensity ?? 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AgentSelfPanel;
