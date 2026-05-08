'use client';

/**
 * Sentinel Lens — surfaces the security + intel + semantic substrate
 * (intel 14 macros, shield 11, semantic 7). Composite of three macro
 * domains that lived headlessly via Ghost Fleet.
 *
 * Phase 3.7 wire-the-Lost. Market parallels: Snyk/Veracode (shield),
 * Maltego/OpenCTI (intel), Pinecone/Weaviate (semantic).
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, Radio, Search, Loader2, ScanLine, AlertOctagon,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'shield' | 'intel' | 'semantic';

export default function SentinelLensPage() {
  useLensNav('sentinel');
  const [activeTab, setActiveTab] = useState<TabKey>('shield');

  // ── Shield ────────────────────────────────────────────────────────────
  const shieldStatus = useQuery({
    queryKey: ['sentinel-shield-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('shield', 'status', {});
      return (r.data?.result ?? r.data) as { active?: boolean; threatLevel?: string; firewallEnabled?: boolean };
    },
    refetchInterval: 30_000,
  });
  const shieldThreats = useQuery({
    queryKey: ['sentinel-shield-threats'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('shield', 'threats', {});
      return (r.data?.result ?? r.data) as { threats?: Array<{ id: string; severity?: string; description?: string; detectedAt?: string }> };
    },
    refetchInterval: 30_000,
  });
  const shieldMetrics = useQuery({
    queryKey: ['sentinel-shield-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('shield', 'metrics', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });
  const runScan = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('shield', 'scan', {});
      return r.data?.result ?? r.data;
    },
  });

  // ── Intel ────────────────────────────────────────────────────────────
  const [intelDomain, setIntelDomain] = useState<'weather' | 'geology' | 'energy' | 'ocean' | 'seismic' | 'agriculture' | 'environment'>('weather');
  const [intelResult, setIntelResult] = useState<unknown>(null);
  const fetchIntel = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('intel', intelDomain, {});
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setIntelResult(data),
    onError: (err) => setIntelResult({ error: (err as Error).message }),
  });

  // ── Semantic ─────────────────────────────────────────────────────────
  const semanticStatus = useQuery({
    queryKey: ['sentinel-semantic-status'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('semantic', 'status', {});
      return (r.data?.result ?? r.data) as Record<string, unknown>;
    },
  });
  const [semanticQuery, setSemanticQuery] = useState('');
  const [semanticMode, setSemanticMode] = useState<'similar' | 'classify_intent' | 'extract_entities'>('similar');
  const [semanticResult, setSemanticResult] = useState<unknown>(null);
  const runSemantic = useMutation({
    mutationFn: async () => {
      const input = semanticMode === 'similar'
        ? { query: semanticQuery, limit: 10 }
        : { text: semanticQuery };
      const r = await apiHelpers.lens.runDomain('semantic', semanticMode, input);
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setSemanticResult(data),
    onError: (err) => setSemanticResult({ error: (err as Error).message }),
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'shield',   label: 'Shield',   icon: Shield, count: shieldThreats.data?.threats?.length },
    { key: 'intel',    label: 'Intel',    icon: Radio },
    { key: 'semantic', label: 'Semantic', icon: Search },
  ];

  return (
    <div className="min-h-screen bg-black pb-12 text-blue-50">
      <header className="sticky top-0 z-10 border-b border-blue-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Shield className="h-6 w-6 text-blue-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Sentinel</h1>
            <p className="text-xs text-blue-700">Shield · Intel · Semantic</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-blue-900/30 px-4 md:px-8" aria-label="Sentinel sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                activeTab === key ? 'border-blue-400 text-blue-200' : 'border-transparent text-blue-700 hover:text-blue-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-blue-900/40 px-1.5 py-0.5 text-[10px] text-blue-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'shield' && (
            <motion.section key="shield" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {shieldStatus.data && (
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Active" value={shieldStatus.data.active ? 'yes' : 'no'} />
                  <Stat label="Threat level" value={shieldStatus.data.threatLevel ?? '—'} />
                  <Stat label="Firewall" value={shieldStatus.data.firewallEnabled ? 'on' : 'off'} />
                  <Stat label="Threats" value={shieldThreats.data?.threats?.length ?? 0} />
                </div>
              )}
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-blue-200">Active threats</h2>
                <button
                  onClick={() => runScan.mutate()}
                  disabled={runScan.isPending}
                  className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {runScan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanLine className="h-3 w-3" />} Run scan
                </button>
              </div>
              {(shieldThreats.data?.threats ?? []).length === 0 ? (
                <Empty>No active threats. Shield is observing.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(shieldThreats.data?.threats ?? []).map(t => (
                    <li key={t.id} className="flex items-center gap-3 rounded border border-blue-900/30 bg-blue-950/10 px-3 py-2 text-xs">
                      <AlertOctagon className="h-3.5 w-3.5 text-rose-400" aria-hidden />
                      <span className="font-mono text-blue-300">{t.id}</span>
                      <span className="rounded bg-rose-900/40 px-1.5 py-0.5 text-[10px] text-rose-300">{t.severity ?? 'unknown'}</span>
                      {t.description && <span className="text-blue-100">{t.description}</span>}
                      {t.detectedAt && <span className="ml-auto text-[10px] text-blue-700">{new Date(t.detectedAt).toLocaleString()}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {shieldMetrics.data && (
                <details className="mt-4 rounded border border-blue-900/30 bg-blue-950/10">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-blue-400">Shield metrics</summary>
                  <pre className="overflow-auto p-3 font-mono text-[11px] text-blue-500">{JSON.stringify(shieldMetrics.data, null, 2)}</pre>
                </details>
              )}
            </motion.section>
          )}

          {activeTab === 'intel' && (
            <motion.section key="intel" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
                <h3 className="mb-3 text-sm font-semibold text-blue-300">Real-world intel feeds</h3>
                <div className="mb-3 flex flex-wrap gap-1">
                  {(['weather', 'geology', 'energy', 'ocean', 'seismic', 'agriculture', 'environment'] as const).map(d => (
                    <button
                      key={d}
                      onClick={() => setIntelDomain(d)}
                      className={`rounded px-2 py-1 text-xs ${intelDomain === d ? 'bg-blue-700/40 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'}`}
                      aria-pressed={intelDomain === d}
                    >{d}</button>
                  ))}
                </div>
                <button
                  onClick={() => fetchIntel.mutate()}
                  disabled={fetchIntel.isPending}
                  className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {fetchIntel.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Radio className="h-3.5 w-3.5" />} Fetch {intelDomain}
                </button>
                {intelResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-h-80 overflow-auto rounded border border-blue-900/40 bg-black/60 p-3 font-mono text-[11px] text-blue-300">
                    {JSON.stringify(intelResult, null, 2)}
                  </motion.pre>
                )}
              </div>
            </motion.section>
          )}

          {activeTab === 'semantic' && (
            <motion.section key="semantic" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-4">
                <h3 className="mb-3 text-sm font-semibold text-blue-300">Semantic substrate</h3>
                <div className="mb-3 flex flex-wrap gap-1">
                  {(['similar', 'classify_intent', 'extract_entities'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setSemanticMode(m)}
                      className={`rounded px-2 py-1 text-xs ${semanticMode === m ? 'bg-blue-700/40 text-blue-100' : 'bg-blue-950/30 text-blue-500 hover:text-blue-300'}`}
                      aria-pressed={semanticMode === m}
                    >{m.replace('_', ' ')}</button>
                  ))}
                </div>
                <textarea
                  value={semanticQuery}
                  onChange={(e) => setSemanticQuery(e.target.value)}
                  className="h-24 w-full rounded border border-blue-900/40 bg-black/40 p-2 font-mono text-sm text-blue-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder={semanticMode === 'similar' ? 'Query DTU corpus for similar content…' : 'Text to classify or extract from…'}
                  aria-label="Semantic query"
                />
                <div className="mt-3 flex justify-between">
                  {semanticStatus.data && <span className="text-[10px] text-blue-700">embed backend ready</span>}
                  <button
                    onClick={() => runSemantic.mutate()}
                    disabled={!semanticQuery || runSemantic.isPending}
                    className="inline-flex items-center gap-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {runSemantic.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Run
                  </button>
                </div>
                {semanticResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-h-80 overflow-auto rounded border border-blue-900/40 bg-black/60 p-3 font-mono text-[11px] text-blue-300">
                    {JSON.stringify(semanticResult, null, 2)}
                  </motion.pre>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-blue-900/40 bg-blue-950/10 p-3 text-blue-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-blue-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-blue-900/30 bg-blue-950/10 px-4 py-6 text-center text-xs text-blue-600">{children}</p>;
}
