'use client';

import { useState } from 'react';
import { CloudRain, Loader2, Cloud, Wind } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Briefing {
  metars: Array<Record<string, unknown>>;
  tafs: Array<Record<string, unknown>>;
  pireps: Array<Record<string, unknown>>;
  airmets: Array<Record<string, unknown>>;
  fetchedAt: string;
  source: string;
}

export function BriefingPanel() {
  const [icaos, setIcaos] = useState('KSJC,KSFO');
  const [data, setData] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fetchBriefing() {
    const list = icaos.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (list.length === 0) return;
    setLoading(true); setError(null);
    try {
      const res = await lensRun({ domain: 'aviation', action: 'briefing-graphical', input: { icaos: list } });
      if (res.data?.ok === false) setError((res.data?.error as string) || 'briefing failed');
      else setData(res.data?.result as Briefing);
    } catch (e) { setError(e instanceof Error ? e.message : 'failed'); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <CloudRain className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Graphical weather briefing</span>
        <span className="ml-auto text-[10px] text-gray-400">aviationweather.gov NWS</span>
      </header>
      <form onSubmit={(e) => { e.preventDefault(); fetchBriefing(); }} className="p-3 border-b border-white/10 flex items-center gap-2">
        <input value={icaos} onChange={e => setIcaos(e.target.value.toUpperCase())} placeholder="ICAO codes, comma-separated (KSJC,KSFO)" className="flex-1 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <button type="submit" disabled={loading} className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Cloud className="w-3 h-3" />} Fetch
        </button>
      </form>
      <div className="max-h-96 overflow-y-auto p-3 space-y-3">
        {error && <div className="px-3 py-3 text-center text-xs text-rose-300">{error}</div>}
        {!loading && !data && !error && (
          <div className="px-3 py-8 text-center text-xs text-gray-400"><CloudRain className="w-6 h-6 mx-auto mb-2 opacity-30" />Enter ICAO codes above to pull a live brief.</div>
        )}
        {data && (
          <>
            <Section title={`METARs (${data.metars.length})`}>
              {data.metars.slice(0, 8).map((m, i) => (
                <div key={i} className="px-2 py-1 text-[11px] font-mono text-cyan-200 rounded bg-white/[0.03]">{String((m as { rawOb?: string }).rawOb || JSON.stringify(m).slice(0, 100))}</div>
              ))}
            </Section>
            <Section title={`TAFs (${data.tafs.length})`}>
              {data.tafs.slice(0, 6).map((t, i) => (
                <div key={i} className="px-2 py-1 text-[11px] font-mono text-violet-200 rounded bg-white/[0.03] whitespace-pre-wrap">{String((t as { rawTAF?: string }).rawTAF || JSON.stringify(t).slice(0, 120))}</div>
              ))}
            </Section>
            <Section title={`PIREPs (${data.pireps.length})`}>
              {data.pireps.slice(0, 6).map((p, i) => (
                <div key={i} className="px-2 py-1 text-[11px] text-amber-200 rounded bg-white/[0.03] inline-flex items-center gap-1"><Wind className="w-3 h-3" />{String((p as { rawOb?: string }).rawOb || JSON.stringify(p).slice(0, 100))}</div>
              ))}
            </Section>
            <Section title={`AIR/SIGMETs (${data.airmets.length})`}>
              {data.airmets.slice(0, 4).map((a, i) => (
                <div key={i} className="px-2 py-1 text-[11px] text-rose-200 rounded bg-white/[0.03]">{String((a as { hazard?: string; severity?: string }).hazard || 'hazard')} · {String((a as { severity?: string }).severity || '')}</div>
              ))}
            </Section>
            <div className="text-[10px] text-gray-400 text-right">Fetched {new Date(data.fetchedAt).toLocaleTimeString()} · {data.source}</div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className={cn('text-[10px] uppercase tracking-wider text-gray-400 mb-1')}>{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export default BriefingPanel;
