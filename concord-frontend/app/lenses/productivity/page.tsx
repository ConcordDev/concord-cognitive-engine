'use client';

/**
 * Productivity Lens — a Todoist / TickTick / Linear-class task manager.
 *
 * The lens IS the task manager: natural-language quick-add, Today +
 * upcoming agenda, projects & labels, saved smart filters, a month
 * calendar with two-way ICS sync, time/location reminders, project
 * collaboration (subtasks, assignment, comments), habit streaks, and a
 * Pomodoro / Eisenhower / karma focus surface — every panel wired to the
 * real `productivity.*` macro engine (persistent, per-user server state).
 *
 * Category reference: Todoist for the task model + karma/streaks, Linear
 * for the keyboard-first "get out of your way" interaction language
 * (`g <key>` view chords, discoverable via kbd chips in the tab bar).
 *
 * No fabricated state: there is no client-only task pool and no
 * placeholder office-tool scaffold — everything the user sees is a real
 * backend read/write.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Notebook, Keyboard, Code2 as Github } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import {
  ProductivityTaskSection,
  PRODUCTIVITY_TABS,
  type ProductivityTabId,
} from '@/components/productivity/ProductivityTaskSection';
import { ProductivityRepos } from '@/components/productivity/ProductivityRepos';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensStatePersistence } from '@/lib/lens-state-persistence';

const TAB_IDS = PRODUCTIVITY_TABS.map((t) => t.id);

function isTabId(v: unknown): v is ProductivityTabId {
  return typeof v === 'string' && (TAB_IDS as string[]).includes(v);
}

export default function ProductivityLensPage() {
  useLensNav('productivity');
  const { restore, persist } = useLensStatePersistence('productivity');

  const [tab, setTab] = useState<ProductivityTabId>('today');
  const [showTooling, setShowTooling] = useState(false);

  // Restore the last-viewed tab on mount (presentation-only UI state).
  useEffect(() => {
    const saved = restore();
    if (saved && isTabId(saved.tab)) setTab(saved.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectTab = useCallback((next: ProductivityTabId) => {
    setTab(next);
    persist({ tab: next });
  }, [persist]);

  // Linear-style keyboard-first view navigation: `g <key>` jumps between
  // the nine task-manager views. The same chords render as kbd chips in
  // the tab bar so they're discoverable without reading source.
  const commands = useMemo(
    () => PRODUCTIVITY_TABS.map((t) => ({
      id: `goto-${t.id}`,
      keys: t.chord,
      description: `Go to ${t.label}`,
      category: 'navigation' as const,
      action: () => selectTab(t.id),
    })),
    [selectTab],
  );
  useLensCommand(commands, { lensId: 'productivity' });

  return (
    <LensShell lensId="productivity" asMain={false}>
      <FirstRunTour lensId="productivity" />

      <div className="min-h-screen bg-black pb-12 text-zinc-100">
        <header className="sticky top-0 z-10 border-b border-zinc-800 bg-black/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
            <Notebook className="h-6 w-6 text-red-400" aria-hidden />
            <div className="mr-auto">
              <div className="flex items-center gap-2">
                <h1 className="font-mono text-lg font-semibold tracking-wide">Productivity</h1>
                <DepthBadge lensId="productivity" size="sm" />
              </div>
              <p className="text-xs text-zinc-500">
                Tasks · projects · filters · calendar · reminders · collaboration · habits · focus
              </p>
            </div>
            <span
              className="hidden items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950 px-2.5 py-1 text-[11px] text-zinc-400 sm:inline-flex"
              title="Press g then the highlighted key to jump between views"
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden />
              <span>
                Press <kbd className="rounded border border-zinc-700 px-1 font-mono text-[10px]">g</kbd> then a view key
              </span>
            </span>          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-5 md:px-6">
          <ProductivityTaskSection activeTab={tab} onTabChange={selectTab} />

          {/* Secondary, honest reference surface — live GitHub topic search
              for real open-source productivity tooling (real data, honest
              error state). Collapsed by default so it never competes with
              the task manager for the lens's identity. */}
          <section className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <button
              type="button"
              onClick={() => setShowTooling((v) => !v)}
              aria-expanded={showTooling}
              className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-semibold text-zinc-200"
            >
              <Github className="h-4 w-4 text-emerald-400" aria-hidden />
              Discover open-source productivity tooling
              <span className="ml-auto text-xs font-normal text-zinc-500">{showTooling ? 'Hide' : 'Show'}</span>
            </button>
            {showTooling && (
              <div className="border-t border-zinc-800 p-4">
                <ProductivityRepos />
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Production-grade polish sentinels — cross-lens surfaces, kept
          out of the primary flow (accessibility-only). */}      <CrossLensRecentsPanel lensId="productivity" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
