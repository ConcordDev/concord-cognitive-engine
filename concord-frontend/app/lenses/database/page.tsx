'use client';

/**
 * Database — one DBeaver/TablePlus tool-shaped app.
 *
 * Single `active` union drives the tab bar. Each screen owns its hooks in
 * components/database/*Panel.tsx. Page is a thin shell.
 */

import { useCallback, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Database, Plus, Plug, Terminal, Table2, Layers, PenLine, Key, BarChart3, History, FolderGit2,
} from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { ConnectionStrip } from '@/components/database/ConnectionStrip';
import { LiveClientPanel } from '@/components/database/LiveClientPanel';
import { QueryEditorPanel } from '@/components/database/QueryEditorPanel';
import { TableBrowserPanel } from '@/components/database/TableBrowserPanel';
import { SchemaMapPanel } from '@/components/database/SchemaMapPanel';
import { DesignerPanel } from '@/components/database/DesignerPanel';
import { IndexesPanel } from '@/components/database/IndexesPanel';
import { MonitoringPanel } from '@/components/database/MonitoringPanel';
import { HistoryPanel } from '@/components/database/HistoryPanel';
import { ProjectsPanel } from '@/components/database/ProjectsPanel';

export type DbView =
  | 'live'
  | 'query'
  | 'tables'
  | 'schema'
  | 'designer'
  | 'indexes'
  | 'monitor'
  | 'history'
  | 'projects';

const TABS: { id: DbView; label: string; icon: typeof Database; keys: string }[] = [
  { id: 'live', label: 'Live Client', icon: Plug, keys: 'l' },
  { id: 'query', label: 'Query Editor', icon: Terminal, keys: 'q' },
  { id: 'tables', label: 'Table Browser', icon: Table2, keys: 't' },
  { id: 'schema', label: 'Schema Map', icon: Layers, keys: 'm' },
  { id: 'designer', label: 'Designer', icon: PenLine, keys: 'd' },
  { id: 'indexes', label: 'Indexes', icon: Key, keys: 'i' },
  { id: 'monitor', label: 'Monitoring', icon: BarChart3, keys: 'o' },
  { id: 'history', label: 'History', icon: History, keys: 'h' },
  { id: 'projects', label: 'Projects', icon: FolderGit2, keys: 'p' },
];

export default function DatabaseLensPage() {
  useLensNav('database');
  useLensIdentity('database');
  const { latestData: realtimeData, alerts: realtimeAlerts, isLive, lastUpdated } = useRealtimeLens('database');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DbView>('live');
  const [seedSql, setSeedSql] = useState<string | null>(null);

  const go = useCallback((id: DbView) => setActive(id), []);
  const loadSql = useCallback((sql: string) => {
    setSeedSql(sql);
    setActive('query');
  }, []);
  const onSeedConsumed = useCallback(() => setSeedSql(null), []);

  useLensCommand(
    [
      ...TABS.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.keys,
        description: t.label,
        category: 'navigation' as const,
        action: () => go(t.id),
      })),
      { id: 'db-new-query', keys: 'n', description: 'New query', category: 'actions' as const, action: () => go('query') },
    ],
    { lensId: 'database' },
  );

  const current = TABS.find((t) => t.id === active)!;

  return (
    <LensShell lensId="database" asMain={false}>
      <FirstRunTour lensId="database" />
      <DepthBadge lensId="database" size="sm" className="ml-2" />
      <div data-lens-theme="database" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Database</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {active === 'live' ? `What are we querying${who ? `, ${who}` : ''}` : current.label}
            </h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="database" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded bg-yellow-500/10 px-2 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="mb-5"><ConnectionStrip /></div>

        <nav className="mb-6 inline-flex max-w-full flex-wrap items-center gap-1 rounded-3xl border border-white/10 bg-white/[0.03] p-1" aria-label="Database views">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => go(tab.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                <kbd aria-hidden="true" className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{tab.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {active === 'live' && <LiveClientPanel />}
            {active === 'query' && <QueryEditorPanel seedSql={seedSql} onSeedConsumed={onSeedConsumed} />}
            {active === 'tables' && <TableBrowserPanel onQueryTable={loadSql} />}
            {active === 'schema' && <SchemaMapPanel />}
            {active === 'designer' && <DesignerPanel />}
            {active === 'indexes' && <IndexesPanel />}
            {active === 'monitor' && <MonitoringPanel />}
            {active === 'history' && <HistoryPanel onLoadQuery={loadSql} />}
            {active === 'projects' && <ProjectsPanel />}
          </motion.div>
        </AnimatePresence>

        <CrossLensRecentsPanel lensId="database" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={() => go('query')}
          title="New query (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Plus className="h-4 w-4" />
          New query
        </button>
      </div>
    </LensShell>
  );
}
