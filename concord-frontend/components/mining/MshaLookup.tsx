'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { HardHat as Pickaxe, Loader2, ShieldAlert } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Mine {
  mineId: string; name: string; operator?: string; state?: string; county?: string;
  mineType?: string; status?: string; primaryCommodity?: string;
  employees?: number; hoursWorked?: number; coalProductionTons?: number;
}
interface Violation { citationNumber?: string; issuedDate?: string; section?: string; standard?: string; gravity?: string; proposedPenalty?: number }

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('mining', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function MshaLookup() {
  const [mineId, setMineId] = useState('');
  const [mine, setMine] = useState<Mine | null>(null);
  const [violations, setViolations] = useState<Violation[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      const m = await callMacro<Mine>('msha-mine-lookup', { mineId });
      if (m.ok && m.result) {
        setMine(m.result);
        const v = await callMacro<{ violations: Violation[] }>('msha-violations', { mineId });
        if (v.ok && v.result) setViolations(v.result.violations);
      } else {
        setMine(null); setError(m.error || 'lookup failed');
      }
    },
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Pickaxe className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">MSHA Mine Lookup</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">msha open data</span>
        </div>
      </header>
      <div className="flex items-center gap-2">
        <input type="text" maxLength={7} value={mineId} onChange={(e) => setMineId(e.target.value.replace(/\D/g, ''))} placeholder="7-digit Mine ID" className="w-32 rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
        <button type="button" onClick={() => load.mutate()} disabled={mineId.length !== 7 || load.isPending} className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {load.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pickaxe className="h-3.5 w-3.5" />}
          Lookup
        </button>
      </div>
      {error && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>}
      {mine && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          <div className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-white">{mine.name}</h3>
                <p className="text-xs text-zinc-400">{mine.operator}</p>
                <p className="mt-1 text-[11px] text-zinc-400">Mine ID {mine.mineId} · {mine.county}, {mine.state} · {mine.mineType} · {mine.status}</p>
              </div>
              <SaveAsDtuButton
                compact
                apiSource="msha"
                title={`MSHA ${mine.mineId} — ${mine.name}`}
                content={JSON.stringify({ mine, violationCount: violations.length }, null, 2)}
                extraTags={['mining', 'msha', mine.mineType || 'mine']}
                rawData={{ mine, violations }}
              />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {mine.primaryCommodity && <Cell label="Commodity" value={mine.primaryCommodity} />}
              {mine.employees != null && <Cell label="Employees" value={String(mine.employees)} />}
              {mine.hoursWorked != null && <Cell label="Hours worked" value={mine.hoursWorked.toLocaleString()} />}
              {mine.coalProductionTons != null && <Cell label="Coal (tons)" value={mine.coalProductionTons.toLocaleString()} />}
            </div>
          </div>
          {violations.length > 0 && (
            <div className="rounded-md border border-zinc-800 bg-zinc-950/40 p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-200">
                <ShieldAlert className="h-3.5 w-3.5 text-amber-400" /> {violations.length} recent violations
              </div>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {violations.slice(0, 50).map((v, i) => (
                  <div key={`${v.citationNumber}-${i}`} className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px]">
                    <div className="flex justify-between"><span className="font-mono text-amber-300">{v.citationNumber}</span><span className="text-zinc-400">{v.issuedDate}</span></div>
                    <div className="mt-0.5 text-zinc-400">{v.section} · {v.standard}</div>
                    <div className="mt-0.5 text-[10px] text-zinc-400">Gravity: {v.gravity} · Penalty: ${v.proposedPenalty?.toLocaleString() || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 font-mono text-cyan-300">{value}</div>
    </div>
  );
}
