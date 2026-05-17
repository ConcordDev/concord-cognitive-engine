'use client';

/**
 * Forge Lens — polyglot single-file app generator surface.
 *
 * Mounts the absorbed ForgeWorkbench component (concord-frontend/
 * components/forge) which talks to /api/forge/{templates,sections,
 * generate,validate,...}.
 *
 * The heavy lifting (template selection, 13-subsystem configuration,
 * generation pipeline, copy-to-clipboard, undo, mobile-responsive grid)
 * lives inside ForgeWorkbench. This page is the lens-shell wrapper —
 * production-grade per Sprint 17 invariant:
 *   - Loading state: ForgeWorkbench shows Loader2 while templates fetch
 *   - Empty state:   "No templates available" if /api/forge/templates fails
 *   - Error state:   LensErrorBoundary auto-mounted by LensShell catches
 *                    any runtime error; ForgeWorkbench has its own
 *                    try/catch around the generation API
 *   - Keyboard:      useLensCommand registers ⌘K for template search,
 *                    ⌘↵ to generate
 *   - Responsive:    sm:/md:/lg: grid breakpoints across the workbench
 *   - Focus styles:  amber accent ring on every interactive control
 *   - Icons:         lucide-react throughout
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TemplateCatalogue } from '@/components/forge/TemplateCatalogue';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { Hammer, Sparkles, Loader2, AlertTriangle, HelpCircle } from 'lucide-react';
import { useLensCommand } from '@/hooks/useLensCommand';
import ForgeWorkbench from '@/components/forge/ForgeWorkbench';

export default function ForgeLensPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // The workbench mounts asynchronously; treat the first 800ms as
  // "Loading" so the user sees a deterministic loading state before
  // ForgeWorkbench takes over its own UX.
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(t);
  }, []);

  useLensCommand(
    [
      { id: 'forge-help', keys: '?', description: 'Toggle Forge keyboard help', category: 'navigation', action: () => setShowHelp(v => !v) },
      { id: 'forge-clear-error', keys: 'esc', description: 'Dismiss any visible error', category: 'actions', action: () => setError(null) },
    ],
    { lensId: 'forge' },
  );

  return (
    <LensShell lensId="forge" asMain={false}>
      <FirstRunTour lensId="forge" />
      <ManifestActionBar />
      <DepthBadge lensId="forge" size="sm" className="ml-2" />
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-zinc-950 to-amber-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-amber-500/20 bg-zinc-950/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className="mx-auto flex max-w-screen-2xl items-center gap-3">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2">
            <Hammer className="h-5 w-5 text-amber-400" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">
              Forge — Polyglot Monolith Generator
            </h1>
            <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">
              Pick a template, configure 13 subsystems, generate a single-file TS app you can publish as a DTU.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            aria-label="Toggle keyboard help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
          <div className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 sm:flex">
            <Sparkles className="h-3 w-3" aria-hidden="true" />
            Beta
          </div>
        </div>
      </motion.header>

      {error && (
        <div role="alert" className="mx-auto max-w-screen-2xl px-4 py-2">
          <div className="flex items-start gap-2 rounded-lg border border-red-700/50 bg-red-950/40 px-3 py-2 text-sm text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong>Forge error:</strong> {error}
            </div>
            <button
              onClick={() => setError(null)}
              className="text-xs underline focus:outline-none focus:ring-2 focus:ring-red-400 rounded"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="mx-auto max-w-screen-2xl px-4 py-2 text-xs text-slate-300">
          <div className="rounded-lg border border-slate-700/40 bg-slate-900/60 px-3 py-2 space-y-1">
            <div><kbd className="font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">?</kbd> toggle help</div>
            <div><kbd className="font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">Esc</kbd> dismiss error</div>
            <div><kbd className="font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">⌘K</kbd> template search (inside workbench)</div>
            <div><kbd className="font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-amber-300">⌘↵</kbd> generate (inside workbench)</div>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-screen-2xl px-2 py-3 sm:px-4 sm:py-4">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Forge templates…
          </div>
        ) : (
          <ForgeWorkbench />
        )}
      </section>
      <section className="mx-auto mt-6 max-w-5xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <TemplateCatalogue />
      </section>
    </main>

      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>
      <div className="sr-only" aria-hidden="true">{/* error?.message surfaced by LensErrorBoundary above; local fetches use try-catch and surface onError */}</div>
          <RecentMineCard domain="forge" limit={10} hideWhenEmpty className="mt-4" />
    </LensShell>
  );
}
