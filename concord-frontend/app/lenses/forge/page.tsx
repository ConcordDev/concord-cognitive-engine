'use client';

/**
 * Forge lens: the north-star look (serif title, teal floating CTA) over the
 * real Forge studio, template catalogue and polyglot workbench. The CTA
 * focuses the studio's app-name field; every tool stays on screen.
 */
// Error handling: LensErrorBoundary (auto-mounted by LensShell) catches render/effect errors. Local fetch errors caught with try/catch where shown.

import { useCallback, useState } from 'react';
import { AlertTriangle, HelpCircle, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { TemplateCatalogue } from '@/components/forge/TemplateCatalogue';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import ForgeWorkbench from '@/components/forge/ForgeWorkbench';
import ForgeStudio from '@/components/forge/ForgeStudio';
import ForgeSharedView from '@/components/forge/ForgeSharedView';

export default function ForgeLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const startApp = useCallback(() => {
    let tries = 0;
    const tick = () => {
      const el = document.getElementById('forge-appname') as HTMLInputElement | null;
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
      } else if (tries++ < 20) requestAnimationFrame(tick);
    };
    tick();
  }, []);

  useLensCommand(
    [
      { id: 'forge-start', keys: 'n', description: 'Start a new app', category: 'actions', action: startApp },
      { id: 'forge-help', keys: '?', description: 'Toggle Forge keyboard help', category: 'navigation', action: () => setShowHelp(v => !v) },
      { id: 'forge-clear-error', keys: 'esc', description: 'Dismiss any visible error', category: 'actions', action: () => setError(null) },
    ],
    { lensId: 'forge' },
  );

  return (
    <LensShell lensId="forge" asMain={false}>
      <FirstRunTour lensId="forge" />
      <DepthBadge lensId="forge" size="sm" className="ml-2" />
      <div data-lens-theme="forge" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Forge</p>
            <h1 className="mb-2 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              What&apos;s in the forge{who ? `, ${who}` : ''}
            </h1>
            <p className="mb-5 max-w-3xl text-[13px] leading-relaxed text-zinc-500">
              Pick a template, configure 13 subsystems, generate a single-file TypeScript app you can publish as a DTU.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowHelp(v => !v)}
            className="mt-3 shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-2 text-zinc-500 transition-colors hover:text-zinc-200"
            aria-label="Toggle keyboard help"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4">
            <div className="flex items-start gap-2 rounded-2xl border border-red-700/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1"><strong>Forge error:</strong> {error}</div>
              <button onClick={() => setError(null)} className="rounded text-xs underline focus:outline-none focus:ring-2 focus:ring-red-400">dismiss</button>
            </div>
          </div>
        )}

        {showHelp && (
          <div className="mb-4 rounded-2xl border border-white/10 bg-[#111] px-4 py-3 text-xs text-zinc-300 space-y-1">
            <div><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-teal-300">N</kbd> start a new app</div>
            <div><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-teal-300">?</kbd> toggle help</div>
            <div><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-teal-300">Esc</kbd> dismiss error</div>
            <div><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-teal-300">⌘K</kbd> template search (inside workbench)</div>
            <div><kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-teal-300">⌘↵</kbd> generate (inside workbench)</div>
          </div>
        )}

        <ForgeSharedView />

        <div className="space-y-6">
          <ForgeStudio />
          <ForgeWorkbench />
        </div>

        <section className="mt-6 max-w-5xl rounded-2xl border border-white/10 bg-[#111] p-4">
          <TemplateCatalogue />
        </section>

        <SessionRail lensId="forge" hideWhenEmpty className="mt-4" />
        <CrossLensRecentsPanel lensId="forge" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={startApp}
          title="Start a new app (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Start
        </button>
      </div>
    </LensShell>
  );
}
