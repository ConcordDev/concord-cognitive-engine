'use client';

import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

export interface CorpusTable { name: string; total: number; consented: number; ratio: number; regime: string }
export interface CorpusStats { ok: boolean; tables: CorpusTable[]; totals: { total: number; consented: number; ratio: number } }
export interface MineSummary { ok: boolean; userId?: string; total: number; consented: number; ratio: number }
export interface BrainStat { brainId: string; total: number; positive: number; consented: number; pending: number }
export interface BrainStats { ok: boolean; brains: BrainStat[] }
export interface ActiveModel { brain_id: string; model_name: string; base_model?: string; corpus_size?: number; eval_score?: number; created_at?: number }
export interface ActiveModels { ok: boolean; active: ActiveModel[] }

export async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 px-1 py-4 text-xs text-fuchsia-600">
      <Loader2 className="h-4 w-4 animate-spin text-fuchsia-500" aria-hidden /> {label}
    </p>
  );
}

export function ErrorState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-200">
      <AlertTriangle className="h-4 w-4 text-rose-400" aria-hidden />
      <span className="flex-1">{message}</span>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="inline-flex items-center gap-1 rounded bg-rose-900/40 px-2 py-1 font-medium hover:bg-rose-800/60 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-rose-400"
      >
        {retrying ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <RefreshCw className="h-3 w-3" aria-hidden />}
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-fuchsia-900/40 bg-fuchsia-950/10 p-3 text-fuchsia-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-fuchsia-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-fuchsia-900/30 bg-fuchsia-950/10 px-4 py-6 text-center text-xs text-fuchsia-600">{children}</p>;
}
