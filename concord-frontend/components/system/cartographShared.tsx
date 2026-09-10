'use client';

/**
 * Shared cartograph types, helpers, and query hook for the System lens.
 * Extracted from system/page.tsx during consolidation.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { apiHelpers } from '@/lib/api/client';
import {
  AlertTriangle, CheckCircle2, XCircle, type LucideIcon,
} from 'lucide-react';

export interface CartographStats {
  tableCount: number;
  routeCount: number;
  macroCount: number;
  macroDomainCount: number;
  heartbeatCount: number;
  lensCount: number;
  moduleCount: number;
  deadTableCount: number;
  orphanModuleCount: number;
  dormantModuleCount: number;
  coverageInScope: number;
  coveragePresent: number;
}

export interface HeartbeatEntry { id: string; frequency: number; neverDisable?: boolean }
export interface DriftEntry { file: string; line: number; claim: string; actual: number; delta: number }
export interface CoverageEntry {
  category: string;
  status: 'present' | 'partial' | 'missing';
  scope: 'in' | 'out';
  matchedManifests: string[];
  matchedMacroDomains: string[];
  matchedRoutes: string[];
  proposedTargetLens: string | null;
  priority: number | null;
}

export interface SystemsReport {
  generatedAt: string;
  stats: CartographStats;
  static: { heartbeatCallsites?: HeartbeatEntry[] };
  runtime: { booted: boolean; heartbeats: HeartbeatEntry[]; reason?: string };
  crossRef: {
    deadTables: { name: string; migration: string }[];
    dormantModules: { id: string; subsystem: string | null; importedBy: number }[];
    headlessBackends: { domain: string; macroCount: number }[];
    orphanLenses: { frontendDir: string; reason: string }[];
  };
  coverage: CoverageEntry[];
  drift: DriftEntry[];
}

export function useSystemCartograph() {
  const [refreshKey, setRefreshKey] = useState(0);
  const query = useQuery({
    queryKey: ['system-cartograph', refreshKey],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('system', 'cartograph', {});
      const payload = (r.data?.result ?? r.data) as { ok: boolean; systems?: SystemsReport; reason?: string };
      if (!payload?.ok) throw new Error(payload?.reason ?? 'cartograph_unavailable');
      return payload.systems as SystemsReport;
    },
    refetchInterval: 60_000,
    retry: 0,
  });

  const heartbeats = useMemo(() => {
    if (!query.data) return [] as HeartbeatEntry[];
    const src = query.data.runtime.booted && query.data.runtime.heartbeats?.length
      ? query.data.runtime.heartbeats
      : (query.data.static.heartbeatCallsites ?? []);
    return [...src].sort((a, b) => a.frequency - b.frequency);
  }, [query.data]);

  const coveragePct = query.data?.stats.coverageInScope
    ? Math.round((query.data.stats.coveragePresent / query.data.stats.coverageInScope) * 100)
    : 0;

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    setTimeout(() => query.refetch(), 100);
  };

  return { ...query, heartbeats, coveragePct, handleRefresh, refreshKey };
}

export function StatCard({ label, value, sub, icon: Icon, tone = 'ok' }: {
  label: string;
  value: number | string;
  sub?: string;
  icon: LucideIcon;
  tone?: 'ok' | 'warn' | 'bad';
}) {
  const toneCls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
                : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
                : 'border-cyan-900/40 text-cyan-200';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`rounded-lg border bg-cyan-950/10 p-3 ${toneCls}`}
      title={sub}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-cyan-700">
        <span>{label}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-cyan-700">{sub}</div>}
    </motion.div>
  );
}

export function GapCard({ title, count, rows }: {
  title: string;
  count: number;
  rows: { key: string; primary: string; secondary: string }[];
}) {
  return (
    <div className="rounded-lg border border-cyan-900/40 bg-cyan-950/10">
      <div className="flex items-center justify-between border-b border-cyan-900/30 px-3 py-2">
        <h3 className="text-sm font-semibold text-cyan-300">{title}</h3>
        <span className="rounded bg-cyan-800/30 px-2 py-0.5 text-xs font-mono text-cyan-300">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-xs text-cyan-600">None.</p>
      ) : (
        <ul className="max-h-72 overflow-y-auto divide-y divide-cyan-900/20 text-xs">
          {rows.map(r => (
            <li key={r.key} className="px-3 py-1.5">
              <div className="font-mono text-cyan-200">{r.primary}</div>
              <div className="text-[10px] text-cyan-700">{r.secondary}</div>
            </li>
          ))}
          {rows.length >= 20 && <li className="px-3 py-1.5 text-[10px] text-cyan-600">…showing first 20</li>}
        </ul>
      )}
    </div>
  );
}

export function CoverageBadge({ status }: { status: 'present' | 'partial' | 'missing' }) {
  if (status === 'present') return <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-[10px] text-emerald-300"><CheckCircle2 className="h-2.5 w-2.5" aria-hidden />present</span>;
  if (status === 'partial') return <span className="inline-flex items-center gap-1 rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] text-yellow-300"><AlertTriangle className="h-2.5 w-2.5" aria-hidden />partial</span>;
  return <span className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-300"><XCircle className="h-2.5 w-2.5" aria-hidden />missing</span>;
}

export function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-cyan-900/30 bg-cyan-950/10 px-4 py-6 text-center text-sm text-cyan-600">
      {text}
    </div>
  );
}

export function intervalLabel(frequency: number): string {
  const sec = frequency * 15;
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${(sec / 60).toFixed(1)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
