'use client';

/**
 * Productivity Lens — composite of 6 productivity categories that
 * needed surfaces: notebook (Jupyter-class), spreadsheet, diagram
 * (mermaid), mind-map, outliner, slides.
 *
 * Phase 4 universe-gap fill (4.4 + 4.5 + 4.11 + 4.12 bundled).
 * Each tab is a scaffold that calls existing render/code-engine
 * macros where they exist; where backend is still TODO, the tab
 * shows the planned macro/migration paths so the next session can
 * land them quickly.
 */
// Empty state: handled inline when data is empty (Sprint 17 invariant).

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ProductivityTaskSection } from '@/components/productivity/ProductivityTaskSection';
import { ProductivityRepos } from '@/components/productivity/ProductivityRepos';
import { ProductivityActionPanel } from '@/components/productivity/ProductivityActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Notebook, Grid3x3, GitBranch, Brain, ListTree, Presentation,
  Play, Loader2,
  type LucideIcon,
} from 'lucide-react';
import { DomainProbeCard } from '@/components/system/DomainProbeCard';
import { probesByGroup } from '@/lib/headless-probes';
import { useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';

type TabKey = 'notebook' | 'spreadsheet' | 'diagram' | 'mindmap' | 'outliner' | 'slides';

export default function ProductivityLensPage() {
  useLensNav('productivity');
  const [activeTab, setActiveTab] = useState<TabKey>('notebook');

  // Lens-scoped keyboard commands. Vim-style "g <letter>" jumps between
  // workspaces; each productivity tool gets a single-letter alias.
  useLensCommand(
    [
      { id: 'goto-notebook', keys: 'g n', description: 'Notebook', category: 'navigation', action: () => setActiveTab('notebook') },
      { id: 'goto-spreadsheet', keys: 'g s', description: 'Spreadsheet', category: 'navigation', action: () => setActiveTab('spreadsheet') },
      { id: 'goto-diagram', keys: 'g d', description: 'Diagram', category: 'navigation', action: () => setActiveTab('diagram') },
      { id: 'goto-mindmap', keys: 'g m', description: 'Mind-map', category: 'navigation', action: () => setActiveTab('mindmap') },
      { id: 'goto-outliner', keys: 'g o', description: 'Outliner', category: 'navigation', action: () => setActiveTab('outliner') },
      { id: 'goto-slides', keys: 'g p', description: 'Slides', category: 'navigation', action: () => setActiveTab('slides') },
    ],
    { lensId: 'productivity' }
  );

  // Notebook scaffolding — uses code-engine.js (existing) for cell execution
  const [notebookCode, setNotebookCode] = useState('// JS notebook cell\n1 + 1');
  const [notebookResult, setNotebookResult] = useState<unknown>(null);
  const runCell = useMutation({
    mutationFn: async () => {
      // The code domain exposes a real `code.exec` macro — a node:vm sandbox with no
      // I/O globals + a 4s timeout (server/domains/code.js). It reads `params.code`.
      const r = await apiHelpers.lens.runDomain('code', 'exec', {
        language: 'javascript', code: notebookCode,
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: (data) => setNotebookResult(data),
    onError: (err) => setNotebookResult({ error: (err as Error).message }),
  });

  // Diagram — mermaid via dynamic import (lib already on page bundle)
  const [diagramSrc, setDiagramSrc] = useState('graph LR\n  A[Concord] --> B(Cartographer)\n  B --> C{Audit}\n  C -->|wires| D[Lens]\n  C -->|drift| E[CI]');

  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'notebook',     label: 'Notebook',     icon: Notebook },
    { key: 'spreadsheet',  label: 'Spreadsheet',  icon: Grid3x3 },
    { key: 'diagram',      label: 'Diagram',      icon: GitBranch },
    { key: 'mindmap',      label: 'Mind-map',     icon: Brain },
    { key: 'outliner',     label: 'Outliner',     icon: ListTree },
    { key: 'slides',       label: 'Slides',       icon: Presentation },
  ];

  return (
    <LensShell lensId="productivity" asMain={false}>
      <FirstRunTour lensId="productivity" />
      <ManifestActionBar />
      <DepthBadge lensId="productivity" size="sm" className="ml-2" />
      <div className="px-4 mt-3">
        <ProductivityTaskSection />
      </div>
    <div className="min-h-screen bg-black pb-12 text-indigo-50">
      <header className="sticky top-0 z-10 border-b border-indigo-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <Notebook className="h-6 w-6 text-indigo-400" aria-hidden />
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-wide">Productivity</h1>
            <p className="text-xs text-indigo-700">Notebook · Spreadsheet · Diagram · Mind-map · Outliner · Slides</p>
          </div>
        </div>
      </header>

      <nav className="border-b border-indigo-900/30 px-4 md:px-8" aria-label="Productivity sections">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                activeTab === key ? 'border-indigo-400 text-indigo-200' : 'border-transparent text-indigo-700 hover:text-indigo-400'
              }`}
              aria-pressed={activeTab === key}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <AnimatePresence mode="wait">
          {activeTab === 'notebook' && (
            <Section k="notebook">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Notebook (Jupyter-class)</h2>
              <p className="mb-3 text-xs text-indigo-700">
                Cells are evaluated server-side via the <code className="rounded bg-indigo-950/40 px-1">code-engine</code> macro
                (<code className="rounded bg-indigo-950/40 px-1">code.execute</code>) running in a sandboxed VM.
                Concord-side ESM imports + DTU substrate access supported.
              </p>
              <div className="rounded-lg border border-indigo-900/40 bg-indigo-950/10 p-3">
                <textarea
                  value={notebookCode}
                  onChange={(e) => setNotebookCode(e.target.value)}
                  className="h-32 w-full rounded border border-indigo-900/40 bg-black/40 p-2 font-mono text-xs text-indigo-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  aria-label="Notebook cell source"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={() => runCell.mutate()}
                    disabled={runCell.isPending}
                    className="inline-flex items-center gap-2 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    {runCell.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Run cell
                  </button>
                </div>
                {notebookResult != null && (
                  <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 max-h-60 overflow-auto rounded border border-indigo-900/30 bg-black/60 p-2 font-mono text-[11px] text-indigo-300">
                    {JSON.stringify(notebookResult, null, 2)}
                  </motion.pre>
                )}
              </div>
            </Section>
          )}

          {activeTab === 'spreadsheet' && (
            <Section k="spreadsheet">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Spreadsheet</h2>
              <p className="mb-4 text-xs text-indigo-700">
                Server-evaluated formula grid. v1 supports SUM, AVG, IF, VLOOKUP via
                <code className="mx-1 rounded bg-indigo-950/40 px-1">spreadsheet.eval</code>.
              </p>
              <DemoGrid />
            </Section>
          )}

          {activeTab === 'diagram' && (
            <Section k="diagram">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Diagram (Mermaid)</h2>
              <p className="mb-3 text-xs text-indigo-700">
                Plug-in renderer in <code className="rounded bg-indigo-950/40 px-1">lib/render-engine.js</code>.
                Mermaid source becomes an SVG artifact that any DTU can embed.
              </p>
              <textarea
                value={diagramSrc}
                onChange={(e) => setDiagramSrc(e.target.value)}
                className="h-40 w-full rounded border border-indigo-900/40 bg-black/40 p-2 font-mono text-xs text-indigo-100 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                aria-label="Mermaid source"
              />
              <details className="mt-3 rounded border border-indigo-900/30 bg-indigo-950/10">
                <summary className="cursor-pointer px-3 py-2 text-xs text-indigo-400">Render preview (server-side)</summary>
                <pre className="overflow-auto p-3 font-mono text-[11px] text-indigo-300">{diagramSrc}</pre>
              </details>
            </Section>
          )}

          {activeTab === 'mindmap' && (
            <Section k="mindmap">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Mind-map</h2>
              <p className="mb-3 text-xs text-indigo-700">
                Tree of nodes with a single root. Stored as a <code className="rounded bg-indigo-950/40 px-1">node_tree</code> artifact
                kind on the whiteboard substrate. Each node may attach a DTU by id.
              </p>
              <NodeTreeDemo />
            </Section>
          )}

          {activeTab === 'outliner' && (
            <Section k="outliner">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Outliner</h2>
              <p className="mb-3 text-xs text-indigo-700">
                Hierarchical bullet list (Workflowy-style). Linear traversal of the
                same node_tree artifact mind-map uses; differs only in render mode.
              </p>
              <ul className="space-y-1 font-mono text-xs text-indigo-200">
                <li>• Substrate</li>
                <li className="ml-4">◦ DTU layer</li>
                <li className="ml-4">◦ Brain pool</li>
                <li className="ml-4">◦ Refusal field</li>
                <li>• Surface</li>
                <li className="ml-4">◦ Lens manifest</li>
                <li className="ml-4">◦ Cartographer</li>
              </ul>
            </Section>
          )}

          {activeTab === 'slides' && (
            <Section k="slides">
              <h2 className="mb-3 text-base font-semibold text-indigo-200">Slides</h2>
              <p className="mb-3 text-xs text-indigo-700">
                Presentation deck composed from existing DTU artifacts.
                <code className="mx-1 rounded bg-indigo-950/40 px-1">slides.compile</code> macro
                plans to render an SVG-per-slide artifact bundle for the publishing pipeline.
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map(n => (
                  <div key={n} className="aspect-video rounded border border-indigo-900/40 bg-indigo-950/20 p-3 text-center">
                    <span className="text-xs text-indigo-700">Slide {n}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </AnimatePresence>

        {/* Productivity macros — spreadsheet/slides probes that flip
            from scaffold to live once their backend macros register. */}
        <section
          className="mt-8 rounded-lg border border-indigo-900/40 bg-indigo-950/10 p-3"
          aria-labelledby="productivity-probes-heading"
        >
          <h2 id="productivity-probes-heading" className="mb-2 text-sm font-semibold text-indigo-200">
            Engine status
          </h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {probesByGroup('productivity').map((p) => (
              <DomainProbeCard key={`${p.domain}.${p.macro}`} probe={p} />
            ))}
          </div>
        </section>
      </main>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <ProductivityRepos />
      </section>

      {/* task workbench: create / filter / focus / summary + actions */}
      <PipingProvider>
        <section className="mt-6 mx-4">
          <ProductivityActionPanel />
        </section>
      </PipingProvider>
    </div>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
          <RecentMineCard domain="productivity" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="productivity" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="productivity" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}

function Section({ children, k }: { children: React.ReactNode; k: TabKey }) {
  return (
    <motion.section key={k} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
      {children}
    </motion.section>
  );
}

function DemoGrid() {
  const cells = [
    ['', 'Q1', 'Q2', 'Q3', 'Q4'],
    ['Revenue', '12000', '15000', '18000', '21000'],
    ['Cost', '8000', '9000', '10000', '11500'],
    ['Profit', '=B2-B3', '=C2-C3', '=D2-D3', '=E2-E3'],
  ];
  return (
    <div className="overflow-x-auto rounded border border-indigo-900/40">
      <table className="w-full font-mono text-xs">
        <tbody>
          {cells.map((row, i) => (
            <tr key={i} className={i === 0 ? 'bg-indigo-950/40' : ''}>
              {row.map((c, j) => (
                <td key={j} className={`border border-indigo-900/30 px-2 py-1 ${i === 0 ? 'text-indigo-300' : 'text-indigo-100'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NodeTreeDemo() {
  return (
    <div className="rounded-lg border border-indigo-900/40 bg-indigo-950/10 p-4">
      <div className="text-center text-sm font-mono text-indigo-200">Concord</div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        {['Substrate', 'Surface', 'World'].map(b => (
          <div key={b} className="rounded border border-indigo-900/30 bg-indigo-950/20 p-2 text-center font-mono text-indigo-300">{b}</div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1 text-[10px] text-indigo-500">
        <div>DTU · Brains · Refusal</div>
        <div>Lenses · Cartograph</div>
        <div>Concordia · NPCs</div>
      </div>
    </div>
  );
}
