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
  Database, Plug, Terminal, Table2, Layers, PenLine, Key, BarChart3, History, FolderGit2,
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
  const [active, setActive] = useState<DbView>('live');
  const [seedSql, setSeedSql] = useState<string | null>(null);

  const go = useCallback((id: DbView) => setActive(id), []);
  const loadSql = useCallback((sql: string) => {
    setSeedSql(sql);
    setActive('query');
  }, []);
  const onSeedConsumed = useCallback(() => setSeedSql(null), []);

  useLensCommand(
    TABS.map((t) => ({
      id: `tab-${t.id}`,
      keys: t.keys,
      description: t.label,
      category: 'navigation' as const,
      action: () => go(t.id),
    })),
    { lensId: 'database' },
  );

  return (
    <LensShell lensId="database" asMain={false}>
      <FirstRunTour lensId="database" />
      <DepthBadge lensId="database" size="sm" className="ml-2" />
      <div data-lens-theme="database" className="p-6 space-y-6 bg-lattice-bg min-h-screen">
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Database className="w-8 h-8 text-neon-orange shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">Database Administration</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="database" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400">
                Query editor, schema browser, and performance monitoring — DBeaver density.
              </p>
            </div>
          </div>
        </header>

        <ConnectionStrip />

        <nav
          className="flex gap-1 border-b border-lattice-border flex-wrap pb-px"
          aria-label="Database views"
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const on = active === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => go(tab.id)}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t transition-colors whitespace-nowrap',
                  on
                    ? 'bg-lattice-surface text-neon-cyan border border-lattice-border border-b-transparent -mb-px'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-lattice-surface/50',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {tab.keys}
                </kbd>
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

        <CrossLensRecentsPanel lensId="database" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
