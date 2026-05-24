'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Moon, Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Convergence { id?: string; signature?: string; participants?: string[]; sharedFragments?: string[]; firstSeenAt?: string; convergedAt?: string; strength?: number }
interface Counts { dreams?: number; convergences?: number }

export function DreamConvergences() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(id); }, []);
  useEffect(() => { void tick; }, [tick]);

  const convergences = useQuery({
    queryKey: ['dream-convergences'],
    queryFn: async () => {
      const r = await api.post('/api/lens/run', { domain: 'dream', name: 'convergences' });
      const data = r.data as { ok: boolean; result?: Convergence[] | { convergences?: Convergence[] }; convergences?: Convergence[] };
      const arr = Array.isArray(data.result) ? data.result : (data.result as { convergences?: Convergence[] })?.convergences || data.convergences || [];
      return arr as Convergence[];
    },
    refetchInterval: 60000,
  });

  const counts = useQuery({
    queryKey: ['dream-counts'],
    queryFn: async () => {
      const r = await api.post('/api/lens/run', { domain: 'dream', name: 'count' });
      const data = r.data as { ok: boolean; result?: Counts };
      return (data.result || {}) as Counts;
    },
    refetchInterval: 60000,
  });

  const c = convergences.data || [];
  const k = counts.data || {};

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Moon className="h-5 w-5 text-purple-400" />
          <h2 className="text-sm font-semibold text-white">Dream substrate</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">dream.convergences + count macros · live</span>
        </div>
        {(c.length > 0 || k.dreams != null) && (
          <SaveAsDtuButton
            compact
            apiSource="concord-dream"
            title={`Dream substrate snapshot — ${k.dreams ?? '—'} dreams · ${c.length} convergences`}
            content={`Dreams: ${k.dreams ?? '—'}\nConvergences: ${k.convergences ?? c.length}\n\nRecent convergences:\n${c.slice(0, 15).map((cv) => `  ${cv.signature?.slice(0, 12) || cv.id} · ${cv.participants?.length || 0} dreamers · strength ${cv.strength ?? '—'}${cv.convergedAt ? ` · ${new Date(cv.convergedAt).toLocaleString()}` : ''}`).join('\n')}`}
            extraTags={['dreams', 'convergences', 'concord']}
            rawData={{ counts: k, convergences: c }}
          />
        )}
      </header>
      {(convergences.isError || counts.isError) && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">Dream substrate unreachable.</div>}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Total dreams</div>
          <div className="mt-0.5 font-mono text-lg text-purple-300">{k.dreams ?? '—'}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-zinc-400">Convergences</div>
          <div className="mt-0.5 font-mono text-lg text-purple-300">{k.convergences ?? c.length}</div>
        </div>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto">
        {c.map((cv, i) => (
          <div key={cv.id || cv.signature || i} className="rounded border border-purple-500/20 bg-purple-500/5 p-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 font-mono text-purple-300">
                <Sparkles className="h-3 w-3" />
                {cv.signature?.slice(0, 14) || cv.id?.slice(0, 14)}
              </span>
              {cv.strength != null && <span className="rounded bg-purple-500/20 px-1 font-mono text-[10px] text-purple-200">strength {cv.strength.toFixed?.(2) ?? cv.strength}</span>}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-zinc-400">{cv.participants?.length ?? 0} dreamers{cv.convergedAt ? ` · converged ${new Date(cv.convergedAt).toLocaleString()}` : ''}</div>
            {cv.sharedFragments && cv.sharedFragments.length > 0 && (
              <div className="mt-0.5 flex flex-wrap gap-1">
                {cv.sharedFragments.slice(0, 4).map((f) => <span key={f} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-zinc-300">{f}</span>)}
              </div>
            )}
          </div>
        ))}
        {c.length === 0 && !convergences.isPending && (
          <div className="rounded border border-dashed border-zinc-800 p-4 text-center text-[11px] text-zinc-400">No active convergences. Dreams synthesize independently.</div>
        )}
      </div>
      {(convergences.isPending || counts.isPending) && <div className="flex items-center gap-2 text-xs text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Polling dream substrate…</div>}
    </div>
  );
}
