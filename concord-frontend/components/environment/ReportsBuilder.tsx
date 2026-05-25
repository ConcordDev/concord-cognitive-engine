'use client';

import { useEffect, useState } from 'react';
import { FileText, Loader2, Download, FileCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Summary {
  currentYear: string;
  ytdTotalCo2eTonnes: number;
  ytdScope1: number;
  ytdScope2: number;
  ytdScope3: number;
  lastYearTotal: number;
  yoyPct: number;
  activityCount: number;
  supplierCount: number;
  supplierResponseRate: number;
  supplierReportedTonnes: number;
  activeTargets: number;
  activeProjects: number;
  recsRetiredMwh: number;
  offsetsRetiredTonnes: number;
  netEmissionsTonnes: number;
}

type Framework = 'CDP' | 'CSRD' | 'GRI' | 'TCFD' | 'SBTi';

const FRAMEWORK_NOTES: Record<Framework, string[]> = {
  CDP: ['Climate Change full questionnaire', 'C4 — Targets and performance', 'C6 — Scope 1+2 emissions', 'C7 — Scope 3 emissions', 'C8 — Emissions performance'],
  CSRD: ['ESRS E1 Climate Change disclosure', 'E1-4 Targets', 'E1-5 Energy', 'E1-6 Gross Scope 1/2/3', 'E1-7 GHG removals + offsets'],
  GRI: ['GRI 305: Emissions 2016', '305-1 Direct (Scope 1)', '305-2 Energy indirect (Scope 2)', '305-3 Other indirect (Scope 3)', '305-4 Intensity', '305-5 Reduction'],
  TCFD: ['Governance disclosures', 'Strategy under climate scenarios', 'Risk management', 'Metrics & targets (Scope 1/2/3)'],
  SBTi: ['Near-term target validation', 'Net-zero target submission', 'Annual progress disclosure'],
};

export function ReportsBuilder() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [framework, setFramework] = useState<Framework>('CDP');

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'environment', action: 'dashboard-summary', input: {} });
        setSummary(r.data?.result as Summary);
      } catch (e) { console.error('[Reports] failed', e); }
      finally { setLoading(false); }
    })();
  }, []);

  function downloadCsv() {
    if (!summary) return;
    const rows = [
      ['Framework', framework],
      ['Reporting year', summary.currentYear],
      ['Scope 1 (tCO2e)', summary.ytdScope1.toFixed(2)],
      ['Scope 2 (tCO2e)', summary.ytdScope2.toFixed(2)],
      ['Scope 3 (tCO2e)', summary.ytdScope3.toFixed(2)],
      ['Total gross emissions (tCO2e)', summary.ytdTotalCo2eTonnes.toFixed(2)],
      ['Prior year (tCO2e)', summary.lastYearTotal.toFixed(2)],
      ['YoY change %', summary.yoyPct.toFixed(1)],
      ['Activity line items', String(summary.activityCount)],
      ['Suppliers engaged', String(summary.supplierCount)],
      ['Supplier response rate %', String(summary.supplierResponseRate)],
      ['Supplier-reported (tCO2e)', summary.supplierReportedTonnes.toFixed(2)],
      ['Active reduction targets', String(summary.activeTargets)],
      ['Active reduction projects', String(summary.activeProjects)],
      ['RECs retired (MWh)', summary.recsRetiredMwh.toFixed(0)],
      ['Offsets retired (tCO2e)', summary.offsetsRetiredTonnes.toFixed(2)],
      ['Net emissions after retired offsets (tCO2e)', summary.netEmissionsTonnes.toFixed(2)],
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${framework}-disclosure-${summary.currentYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <FileText className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Disclosure reports</span>
      </header>
      <div className="p-3 border-b border-white/10 flex items-center gap-2">
        <span className="text-xs text-gray-400">Framework:</span>
        {(['CDP', 'CSRD', 'GRI', 'TCFD', 'SBTi'] as Framework[]).map(f => (
          <button key={f} onClick={() => setFramework(f)} className={cn('px-2 py-1 text-xs rounded font-mono', framework === f ? 'bg-cyan-500/30 text-cyan-300' : 'bg-white/5 text-gray-400 hover:bg-white/10')}>{f}</button>
        ))}
        <button onClick={downloadCsv} disabled={!summary} className="ml-auto px-3 py-1 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"><Download className="w-3 h-3" />Export CSV</button>
      </div>
      <div className="p-3">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : !summary ? (
          <div className="text-center text-xs text-gray-400 py-6">No data yet.</div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <Tile label="Scope 1" value={`${summary.ytdScope1.toFixed(1)} t`} />
              <Tile label="Scope 2" value={`${summary.ytdScope2.toFixed(1)} t`} />
              <Tile label="Scope 3" value={`${summary.ytdScope3.toFixed(1)} t`} />
              <Tile label="Total" value={`${summary.ytdTotalCo2eTonnes.toFixed(1)} t`} />
              <Tile label="YoY" value={`${summary.yoyPct > 0 ? '+' : ''}${summary.yoyPct.toFixed(1)}%`} tone={summary.yoyPct < 0 ? 'emerald' : 'rose'} />
              <Tile label="Net after offsets" value={`${summary.netEmissionsTonnes.toFixed(1)} t`} />
            </div>
            <div className="rounded-md border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300 mb-2">{framework} disclosure sections covered by your inventory</div>
              <ul className="space-y-1">
                {FRAMEWORK_NOTES[framework].map(n => (
                  <li key={n} className="flex items-center gap-2 text-xs">
                    <FileCheck className="w-3 h-3 text-emerald-400" />
                    <span className="text-gray-300">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const colour = tone === 'emerald' ? 'text-emerald-300' : tone === 'rose' ? 'text-rose-300' : 'text-cyan-300';
  return (
    <div className="rounded border border-white/10 bg-white/[0.03] p-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-400">{label}</div>
      <div className={cn('text-base font-mono tabular-nums', colour)}>{value}</div>
    </div>
  );
}

export default ReportsBuilder;
