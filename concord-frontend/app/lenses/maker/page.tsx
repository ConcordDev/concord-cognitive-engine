'use client';

/**
 * Maker Lens — composite of `apps` (App Maker) + `quest` (Quest Engine)
 * macro domains, plus a Creative Generation panel calling
 * `creative.generate` macros.
 *
 * Phase 3.5 wire-the-Lost. Replaces three planned wires (3.5: quest,
 * 3.6: app-maker, 3.7: creative-generation in the original 8-wire list)
 * with one composite lens. Each is observation + simple action.
 *
 * Market parallels: Retool/Bubble (apps), Inkle/Twine (quest scripting),
 * DALL-E / Midjourney (creative generation).
 */

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AppWindow, Wand2, Sparkles, Loader2, Plus, CheckCircle2, ArrowUpRight,
  type LucideIcon,
} from 'lucide-react';

type TabKey = 'apps' | 'quests' | 'creative';

export default function MakerLensPage() {
  useLensNav('maker');
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('apps');

  useLensCommand(
    [
      { id: 'tab-apps', keys: 'a', description: 'Apps', category: 'navigation', action: () => setActiveTab('apps') },
      { id: 'tab-quests', keys: 'q', description: 'Quests', category: 'navigation', action: () => setActiveTab('quests') },
      { id: 'tab-creative', keys: 'c', description: 'Creative', category: 'navigation', action: () => setActiveTab('creative') },
    ],
    { lensId: 'maker' }
  );

  // ── Apps ──────────────────────────────────────────────────────────────
  const apps = useQuery({
    queryKey: ['maker-apps'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('apps', 'list', {});
      return (r.data?.result ?? r.data) as { apps?: Array<{ id: string; name?: string; status?: string; spec?: unknown }> };
    },
  });
  const appMetrics = useQuery({
    queryKey: ['maker-apps-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('apps', 'metrics', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });
  const promoteApp = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiHelpers.lens.runDomain('apps', 'promote', { id });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maker-apps'] }),
  });

  // ── Quests ────────────────────────────────────────────────────────────
  const quests = useQuery({
    queryKey: ['maker-quests'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'list', {});
      return (r.data?.result ?? r.data) as { quests?: Array<{ id: string; title?: string; status?: string; domain?: string }> };
    },
  });
  const questActive = useQuery({
    queryKey: ['maker-quest-active'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'active', {});
      return (r.data?.result ?? r.data) as { active?: number; quests?: unknown[] };
    },
    refetchInterval: 30_000,
  });
  const questMetrics = useQuery({
    queryKey: ['maker-quest-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'metrics', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });

  const [questTitle, setQuestTitle] = useState('');
  const createQuest = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'create', {
        title: questTitle, config: {},
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maker-quests'] });
      setQuestTitle('');
    },
  });

  // ── Creative ──────────────────────────────────────────────────────────
  const [creativePrompt, setCreativePrompt] = useState('');
  const [creativeKind, setCreativeKind] = useState<'image' | 'text' | 'melody'>('text');
  const [creativeResult, setCreativeResult] = useState<unknown>(null);
  const generateCreative = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('creative', 'generate', {
        kind: creativeKind, prompt: creativePrompt,
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setCreativeResult(data),
    onError: (err) => setCreativeResult({ error: (err as Error).message }),
  });

  const tabs: { key: TabKey; label: string; icon: LucideIcon; count?: number }[] = [
    { key: 'apps',     label: 'Apps',     icon: AppWindow, count: apps.data?.apps?.length },
    { key: 'quests',   label: 'Quests',   icon: Wand2,     count: quests.data?.quests?.length },
    { key: 'creative', label: 'Creative', icon: Sparkles },
  ];

  return (
    <LensShell lensId="maker" asMain={false}>
      <ManifestActionBar />
    <div className="min-h-screen bg-black pb-12 text-pink-50">
      <header className="sticky top-0 z-10 border-b border-pink-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Wand2 className="h-6 w-6 text-pink-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Maker</h1>
            <p className="text-xs text-pink-700">Apps · Quests · Creative generation</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-pink-900/30 px-4 md:px-8" aria-label="Maker sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-pink-400 ${
                activeTab === key ? 'border-pink-400 text-pink-200' : 'border-transparent text-pink-700 hover:text-pink-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              {count != null && <span className="rounded bg-pink-900/40 px-1.5 py-0.5 text-[10px] text-pink-300">{count}</span>}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'apps' && (
            <motion.section key="apps" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              {appMetrics.data && (
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                  {Object.entries(appMetrics.data).slice(0, 4).map(([k, v]) => (
                    <Stat key={k} label={k} value={typeof v === 'number' ? v : String(v)} />
                  ))}
                </div>
              )}
              <h2 className="mb-3 text-base font-semibold text-pink-200">Apps</h2>
              {apps.isLoading && <Loader2 className="h-4 w-4 animate-spin text-pink-500" />}
              {(apps.data?.apps ?? []).length === 0 && !apps.isLoading && (
                <Empty>No apps yet — create one via the App Maker macros.</Empty>
              )}
              <ul className="space-y-1">
                {(apps.data?.apps ?? []).map(a => (
                  <li key={a.id} className="flex items-center gap-3 rounded border border-pink-900/30 bg-pink-950/10 px-3 py-2 text-xs">
                    <AppWindow className="h-3.5 w-3.5 text-pink-500" aria-hidden />
                    <span className="font-mono text-pink-300">{a.id}</span>
                    {a.name && <span className="text-pink-100">{a.name}</span>}
                    <span className="ml-auto rounded bg-pink-800/30 px-1.5 py-0.5 text-[10px]">{a.status ?? '—'}</span>
                    {a.status !== 'promoted' && (
                      <button
                        onClick={() => promoteApp.mutate(a.id)}
                        disabled={promoteApp.isPending}
                        className="inline-flex items-center gap-1 rounded bg-pink-700/50 px-1.5 py-0.5 text-[10px] hover:bg-pink-600/60 disabled:opacity-40"
                        aria-label={`Promote app ${a.id}`}
                      >
                        <ArrowUpRight className="h-2.5 w-2.5" aria-hidden /> Promote
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </motion.section>
          )}

          {activeTab === 'quests' && (
            <motion.section key="quests" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
                <Stat label="Active" value={questActive.data?.active ?? 0} />
                <Stat label="Total" value={quests.data?.quests?.length ?? 0} />
                {questMetrics.data?.completed != null && <Stat label="Completed" value={questMetrics.data.completed} />}
              </div>

              <div className="mb-4 rounded-lg border border-pink-900/40 bg-pink-950/10 p-3">
                <h3 className="mb-2 text-sm font-semibold text-pink-300">Create quest</h3>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={questTitle}
                    onChange={(e) => setQuestTitle(e.target.value)}
                    placeholder="Quest title"
                    className="flex-1 rounded border border-pink-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-pink-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                    aria-label="Quest title"
                  />
                  <button
                    onClick={() => createQuest.mutate()}
                    disabled={!questTitle || createQuest.isPending}
                    className="inline-flex items-center gap-1 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-pink-400"
                  >
                    {createQuest.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Create
                  </button>
                </div>
              </div>

              <h2 className="mb-3 text-base font-semibold text-pink-200">Quests</h2>
              {(quests.data?.quests ?? []).length === 0 && !quests.isLoading ? (
                <Empty>No quests yet.</Empty>
              ) : (
                <ul className="space-y-1">
                  {(quests.data?.quests ?? []).map(q => (
                    <li key={q.id} className="flex items-center gap-3 rounded border border-pink-900/30 bg-pink-950/10 px-3 py-2 text-xs">
                      <Wand2 className="h-3.5 w-3.5 text-pink-500" aria-hidden />
                      <span className="font-mono text-pink-300">{q.id}</span>
                      {q.title && <span className="text-pink-100">{q.title}</span>}
                      {q.domain && <span className="rounded bg-pink-800/30 px-1.5 py-0.5 text-[10px]">{q.domain}</span>}
                      <span className="ml-auto text-[10px] text-pink-700">{q.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>
          )}

          {activeTab === 'creative' && (
            <motion.section key="creative" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
              <div className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-4">
                <h3 className="mb-2 text-sm font-semibold text-pink-300">Creative generation</h3>
                <div className="mb-3 flex gap-1 rounded border border-pink-900/40 bg-pink-950/30 p-0.5 text-xs">
                  {(['text', 'image', 'melody'] as const).map(k => (
                    <button
                      key={k}
                      onClick={() => setCreativeKind(k)}
                      aria-pressed={creativeKind === k}
                      className={`rounded px-2 py-1 ${creativeKind === k ? 'bg-pink-700/40 text-pink-100' : 'text-pink-600 hover:text-pink-400'}`}
                    >{k}</button>
                  ))}
                </div>
                <textarea
                  value={creativePrompt}
                  onChange={(e) => setCreativePrompt(e.target.value)}
                  className="h-24 w-full rounded border border-pink-900/40 bg-black/40 p-2 font-mono text-sm text-pink-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
                  placeholder={`Describe the ${creativeKind} you want generated…`}
                  aria-label="Creative prompt"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={() => generateCreative.mutate()}
                    disabled={!creativePrompt || generateCreative.isPending}
                    className="inline-flex items-center gap-2 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-pink-400"
                  >
                    {generateCreative.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Generate
                  </button>
                </div>
                {creativeResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 max-h-80 overflow-auto rounded border border-pink-900/40 bg-black/60 p-3 font-mono text-[11px] text-pink-300">
                    {JSON.stringify(creativeResult, null, 2)}
                  </motion.pre>
                )}
                {generateCreative.isSuccess && (
                  <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3 w-3" aria-hidden /> Generated
                  </p>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
    </LensShell>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-3 text-pink-200">
      <div className="mb-1 text-[11px] uppercase tracking-wider text-pink-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-pink-900/30 bg-pink-950/10 px-4 py-6 text-center text-xs text-pink-600">{children}</p>;
}
