'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, Loader2, Swords, Activity } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface ActiveWar { id?: string; warId?: string; aggressorFaction?: string; defenderFaction?: string; phase?: string; startedAt?: string | number; momentum?: number; casualties?: number; outcome?: string; [k: string]: unknown }

export function FactionWarIntel() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const wars = useQuery({
    queryKey: ['faction-war-active'],
    queryFn: async () => {
      const r = await api.get('/api/faction-war/active');
      const data = r.data as { wars?: ActiveWar[]; activeWars?: ActiveWar[] } | ActiveWar[];
      return (Array.isArray(data) ? data : (data.wars || data.activeWars || [])) as ActiveWar[];
    },
    refetchInterval: 30000,
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Faction war intel</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">/api/faction-war/active · live</span>
        </div>
        {(wars.data?.length ?? 0) > 0 && (
          <SaveAsDtuButton
            compact
            apiSource="concord-faction-war"
            title={`Active faction wars — ${wars.data?.length}`}
            content={(wars.data || []).map((w, i) => `${i + 1}. ${w.aggressorFaction || '?'} → ${w.defenderFaction || '?'} · phase ${w.phase || '?'} · momentum ${w.momentum ?? '—'} · casualties ${w.casualties ?? 0}`).join('\n')}
            extraTags={['alliance', 'faction-war', 'concord']}
            rawData={{ wars: wars.data }}
          />
        )}
      </header>

      {wars.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Faction-war runtime unreachable.</div>}
      {wars.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Polling faction wars…</div>}

      <div className="space-y-2">
        {(wars.data || []).map((w, i) => (
          <div key={w.id || w.warId || i} className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Swords className="h-4 w-4 text-red-300" />
                <span className="font-mono text-sm text-white">{w.aggressorFaction || '?'}</span>
                <span className="text-zinc-500">vs</span>
                <span className="font-mono text-sm text-white">{w.defenderFaction || '?'}</span>
              </div>
              {w.phase && <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-200">{w.phase}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-400">
              {w.momentum != null && <span className="flex items-center gap-1"><Activity className="h-3 w-3" /> momentum {w.momentum.toFixed?.(2) ?? w.momentum}</span>}
              {w.casualties != null && <span>casualties {w.casualties}</span>}
              {w.startedAt && <span>since {new Date(typeof w.startedAt === 'number' ? w.startedAt * 1000 : w.startedAt).toLocaleString()}</span>}
              {w.outcome && <span className="text-cyan-300">{w.outcome}</span>}
            </div>
          </div>
        ))}
        {wars.data && wars.data.length === 0 && (
          <div className="rounded border border-dashed border-zinc-800 p-6 text-center text-[11px] text-zinc-500">No active wars. Alliances are stable — for now.</div>
        )}
      </div>
    </div>
  );
}
