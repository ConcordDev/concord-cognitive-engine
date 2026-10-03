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
import { Plus, Code2 as Github } from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
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
  useLensIdentity('productivity');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
  const quickAdd = useCallback(() => {
    selectTab('quickadd');
    const focus = (tries: number) => {
      const el = document.querySelector<HTMLInputElement>('input[placeholder^="submit report"]');
      if (el) { el.focus(); return; }
      if (tries > 0) requestAnimationFrame(() => focus(tries - 1));
    };
    requestAnimationFrame(() => focus(6));
  }, [selectTab]);

  const commands = useMemo(
    () => [
      ...PRODUCTIVITY_TABS.map((t) => ({
        id: `goto-${t.id}`,
        keys: t.chord,
        description: `Go to ${t.label}`,
        category: 'navigation' as const,
        action: () => selectTab(t.id),
      })),
      { id: 'quick-add', keys: 'n', description: 'Quick add a task', category: 'actions' as const, action: quickAdd },
    ],
    [selectTab, quickAdd],
  );
  useLensCommand(commands, { lensId: 'productivity' });

  const current = PRODUCTIVITY_TABS.find((t) => t.id === tab);

  return (
    <LensShell lensId="productivity" asMain={false}>
      <FirstRunTour lensId="productivity" />
      <DepthBadge lensId="productivity" size="sm" className="ml-2" />
      <div data-lens-theme="productivity" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Productivity{current ? ` · ${current.label}` : ''}</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {tab === 'today' ? `Today${who ? `, ${who}` : ''}` : 'Your work'}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            <DTUExportButton domain="productivity" data={{}} compact />
          </div>
        </div>

        <ProductivityTaskSection activeTab={tab} onTabChange={selectTab} />

        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111]">
          <button
            type="button"
            onClick={() => setShowTooling((v) => !v)}
            aria-expanded={showTooling}
            className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-zinc-200"
          >
            <Github className="h-4 w-4 text-emerald-400" aria-hidden />
            Discover open-source productivity tooling
            <span className="ml-auto text-xs font-normal text-zinc-500">{showTooling ? 'Hide' : 'Show'}</span>
          </button>
          {showTooling && (
            <div className="border-t border-white/10 p-4">
              <ProductivityRepos />
            </div>
          )}
        </section>

        <CrossLensRecentsPanel lensId="productivity" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={quickAdd}
          title="Quick add a task (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          Add a task
        </button>
      </div>
    </LensShell>
  );
}
