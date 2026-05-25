'use client';

/**
 * ClimateShell — Watershed + Persefoni-shape silhouette.
 *
 * Top metric strip with YTD total + scope breakdown + YoY delta +
 * net-after-offsets + supplier response rate + target progress.
 * Below: scope-1/2/3 stacked bar visualisation + emissions-by-month
 * line; right column: supplier-engagement card with portal status,
 * and active target progress tracker.
 */

import React from 'react';
import {
  Leaf, Factory, Zap, Plane, TrendingDown, TrendingUp, Building2, Target,
  CheckCircle, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ClimateShellProps {
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
  scopeMonthly?: Array<{ month: string; scope1: number; scope2: number; scope3: number }>;
  topTargets?: Array<{ id: string; name: string; baseYear: number; targetYear: number; reductionPct: number; onTrack: boolean; achievedPct: number; expectedPct: number }>;
  className?: string;
}

export function ClimateShell({
  currentYear, ytdTotalCo2eTonnes, ytdScope1, ytdScope2, ytdScope3,
  yoyPct, supplierCount, supplierResponseRate, supplierReportedTonnes,
  activeTargets, activeProjects, recsRetiredMwh, offsetsRetiredTonnes,
  netEmissionsTonnes,
  scopeMonthly = [], topTargets = [], className,
}: ClimateShellProps) {
  const total = Math.max(0.01, ytdTotalCo2eTonnes);
  const s1Pct = (ytdScope1 / total) * 100;
  const s2Pct = (ytdScope2 / total) * 100;
  const s3Pct = (ytdScope3 / total) * 100;
  const yoyDown = yoyPct < 0;
  return (
    <div className={cn('flex flex-col gap-3 p-4 bg-[#0d1117] text-gray-100', className)}>
      {/* Metric strip */}
      <div className="grid grid-cols-5 gap-2">
        <Metric icon={Leaf} label={`${currentYear} YTD`} value={`${ytdTotalCo2eTonnes.toLocaleString(undefined, { maximumFractionDigits: 0 })} tCO₂e`} caption={`${yoyDown ? '↓' : '↑'} ${Math.abs(yoyPct).toFixed(1)}% YoY`} tone={yoyDown ? 'emerald' : 'rose'} />
        <Metric icon={Factory} label="Scope 1" value={`${ytdScope1.toFixed(0)} t`} caption={`${s1Pct.toFixed(0)}% of total`} tone="rose" />
        <Metric icon={Zap} label="Scope 2" value={`${ytdScope2.toFixed(0)} t`} caption={`${s2Pct.toFixed(0)}% of total`} tone="amber" />
        <Metric icon={Plane} label="Scope 3" value={`${ytdScope3.toFixed(0)} t`} caption={`${s3Pct.toFixed(0)}% of total`} tone="cyan" />
        <Metric icon={Leaf} label="Net after offsets" value={`${netEmissionsTonnes.toFixed(0)} t`} caption={`${offsetsRetiredTonnes.toFixed(0)} t retired`} tone="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Stacked bar by month */}
        <section className="lg:col-span-2 rounded-lg border border-emerald-500/20 overflow-hidden">
          <header className="px-3 py-2 bg-emerald-500/5 border-b border-emerald-500/20 flex items-center gap-2">
            <Leaf className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Emissions by month · {currentYear}</span>
            <span className="ml-auto text-[10px] text-gray-400">scope breakdown</span>
          </header>
          {scopeMonthly.length === 0 ? (
            <ScopeBar s1={ytdScope1} s2={ytdScope2} s3={ytdScope3} />
          ) : (
            <div className="p-3">
              <div className="flex items-end gap-1 h-32">
                {scopeMonthly.map((m, i) => {
                  const sum = m.scope1 + m.scope2 + m.scope3 || 1;
                  const max = Math.max(...scopeMonthly.map(x => (x.scope1 + x.scope2 + x.scope3)));
                  const hScale = max > 0 ? (sum / max) * 100 : 0;
                  return (
                    <div key={i} className="flex-1 flex flex-col-reverse" style={{ height: `${hScale}%` }} title={`${m.month}: ${sum.toFixed(0)}t`}>
                      <div style={{ height: `${(m.scope1 / sum) * 100}%` }} className="bg-rose-400/70" />
                      <div style={{ height: `${(m.scope2 / sum) * 100}%` }} className="bg-amber-400/70" />
                      <div style={{ height: `${(m.scope3 / sum) * 100}%` }} className="bg-cyan-400/70" />
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-gray-400">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-rose-400" /> Scope 1</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-amber-400" /> Scope 2</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-cyan-400" /> Scope 3</span>
              </div>
            </div>
          )}
        </section>

        {/* Supplier + targets right column */}
        <aside className="space-y-3">
          <section className="rounded-lg border border-violet-500/20 overflow-hidden">
            <header className="px-3 py-2 bg-violet-500/5 border-b border-violet-500/20 flex items-center gap-2">
              <Building2 className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Supplier engagement</span>
              <span className="ml-auto text-[10px] text-gray-400">{supplierCount}</span>
            </header>
            <div className="p-3">
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-2xl font-mono tabular-nums text-violet-300">{supplierResponseRate}%</span>
                <span className="text-[11px] text-gray-400">response rate</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-violet-400" style={{ width: `${supplierResponseRate}%` }} />
              </div>
              <div className="mt-2 text-[10px] text-gray-400">
                {supplierReportedTonnes.toLocaleString(undefined, { maximumFractionDigits: 0 })} tCO₂e reported by suppliers
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-cyan-500/20 overflow-hidden">
            <header className="px-3 py-2 bg-cyan-500/5 border-b border-cyan-500/20 flex items-center gap-2">
              <Target className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Targets · {activeTargets} active</span>
              <span className="ml-auto text-[10px] text-gray-400">{activeProjects} projects</span>
            </header>
            {topTargets.length === 0 ? (
              <div className="p-4 text-center text-xs text-gray-400">No targets yet.</div>
            ) : (
              <ul className="divide-y divide-white/5">
                {topTargets.slice(0, 3).map(t => (
                  <li key={t.id} className="px-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      {t.onTrack ? <CheckCircle className="w-3 h-3 text-emerald-400" /> : <AlertCircle className="w-3 h-3 text-amber-400" />}
                      <span className="text-xs text-white truncate flex-1">{t.name}</span>
                      <span className="text-[10px] text-cyan-300 font-mono">{t.reductionPct}% by {t.targetYear}</span>
                    </div>
                    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className={cn('h-full transition-all', t.onTrack ? 'bg-emerald-400' : 'bg-amber-400')} style={{ width: `${Math.min(100, Math.max(0, t.achievedPct))}%` }} />
                    </div>
                    <div className="mt-0.5 flex justify-between text-[9px] text-gray-400">
                      <span>{t.achievedPct.toFixed(1)}% achieved</span>
                      <span>vs {t.expectedPct.toFixed(1)}% expected</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-amber-500/20 overflow-hidden">
            <header className="px-3 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2">
              {yoyDown ? <TrendingDown className="w-3.5 h-3.5 text-emerald-400" /> : <TrendingUp className="w-3.5 h-3.5 text-rose-400" />}
              <span className="text-xs uppercase font-semibold tracking-wider text-gray-300">Decarbonisation moves</span>
            </header>
            <div className="p-3 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-white/[0.03] p-2">
                <div className="text-[10px] uppercase tracking-wider text-emerald-300">RECs retired</div>
                <div className="text-lg font-mono tabular-nums text-emerald-300">{recsRetiredMwh.toFixed(0)} MWh</div>
              </div>
              <div className="rounded bg-white/[0.03] p-2">
                <div className="text-[10px] uppercase tracking-wider text-amber-300">Offsets retired</div>
                <div className="text-lg font-mono tabular-nums text-amber-300">{offsetsRetiredTonnes.toFixed(0)} t</div>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function ScopeBar({ s1, s2, s3 }: { s1: number; s2: number; s3: number }) {
  const total = Math.max(0.01, s1 + s2 + s3);
  return (
    <div className="p-3">
      <div className="h-8 flex rounded overflow-hidden">
        <div style={{ width: `${(s1 / total) * 100}%` }} className="bg-rose-400/70" title={`Scope 1: ${s1.toFixed(0)}t`} />
        <div style={{ width: `${(s2 / total) * 100}%` }} className="bg-amber-400/70" title={`Scope 2: ${s2.toFixed(0)}t`} />
        <div style={{ width: `${(s3 / total) * 100}%` }} className="bg-cyan-400/70" title={`Scope 3: ${s3.toFixed(0)}t`} />
      </div>
      <div className="mt-2 flex items-center gap-3 text-[10px] text-gray-400">
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-rose-400" /> Scope 1: {s1.toFixed(0)}t</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-amber-400" /> Scope 2: {s2.toFixed(0)}t</span>
        <span className="inline-flex items-center gap-1"><span className="w-2 h-2 bg-cyan-400" /> Scope 3: {s3.toFixed(0)}t</span>
      </div>
    </div>
  );
}

const TILE_TONE: Record<string, string> = {
  emerald: 'border-emerald-500/20 text-emerald-300',
  cyan: 'border-cyan-500/20 text-cyan-300',
  amber: 'border-amber-500/20 text-amber-300',
  rose: 'border-rose-500/20 text-rose-300',
  violet: 'border-violet-500/20 text-violet-300',
};

function Metric({ icon: Icon, label, value, caption, tone }: { icon: typeof Leaf; label: string; value: string; caption: string; tone: string }) {
  return (
    <div className={cn('rounded-lg border bg-white/[0.02] p-2.5', TILE_TONE[tone])}>
      <div className="flex items-center gap-1.5 mb-0.5">
        <Icon className="w-3 h-3" />
        <span className="text-[10px] uppercase tracking-wider text-gray-400">{label}</span>
      </div>
      <div className="text-base font-mono font-bold tabular-nums text-white">{value}</div>
      <div className="text-[10px] text-gray-400">{caption}</div>
    </div>
  );
}

export default ClimateShell;
