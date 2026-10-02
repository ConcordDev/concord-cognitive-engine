'use client';

/**
 * Database — north star (docs/lens-northstar/32): one query and its rows.
 * Table browser, schema, designer and the rest stay under More.
 */

import { useCallback, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { CodeFamilyPill, NorthGreeting, QuietMore } from '@/components/code/CodeFamilyChrome';
import { QuerySurface } from '@/components/database/QuerySurface';
import { LiveClientPanel } from '@/components/database/LiveClientPanel';
import { TableBrowserPanel } from '@/components/database/TableBrowserPanel';
import { SchemaMapPanel } from '@/components/database/SchemaMapPanel';
import { DesignerPanel } from '@/components/database/DesignerPanel';
import { IndexesPanel } from '@/components/database/IndexesPanel';
import { MonitoringPanel } from '@/components/database/MonitoringPanel';
import { HistoryPanel } from '@/components/database/HistoryPanel';
import { ProjectsPanel } from '@/components/database/ProjectsPanel';

type DbView =
  | 'query'
  | 'live'
  | 'tables'
  | 'schema'
  | 'designer'
  | 'indexes'
  | 'monitor'
  | 'history'
  | 'projects';

const MORE: { id: Exclude<DbView, 'query'>; label: string; key?: string }[] = [
  { id: 'live', label: 'Live client', key: 'l' },
  { id: 'tables', label: 'Tables', key: 't' },
  { id: 'schema', label: 'Schema map', key: 'm' },
  { id: 'designer', label: 'Designer', key: 'd' },
  { id: 'indexes', label: 'Indexes', key: 'i' },
  { id: 'monitor', label: 'Monitoring', key: 'o' },
  { id: 'history', label: 'History', key: 'h' },
  { id: 'projects', label: 'Projects', key: 'p' },
];

export default function DatabaseLensPage() {
  useLensNav('database');
  useLensIdentity('database');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DbView>('query');
  const [seedSql, setSeedSql] = useState<string | null>(null);

  const loadSql = useCallback((sql: string) => {
    setSeedSql(sql);
    setActive('query');
  }, []);

  useLensCommand(
    [
      { id: 'tab-query', keys: 'q', description: 'Query', category: 'navigation', action: () => setActive('query') },
      ...MORE.map((t) => ({
        id: `tab-${t.id}`,
        keys: t.key || t.id,
        description: t.label,
        category: 'navigation' as const,
        action: () => setActive(t.id),
      })),
    ],
    { lensId: 'database' },
  );

  const secondary = MORE.find((v) => v.id === active);

  return (
    <LensShell lensId="database" asMain={false} disableAgentFab>
      <div data-lens-theme="database" className="min-h-[calc(100vh-4rem)] px-8 pb-28 pt-4">
        {active === 'query' ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <NorthGreeting kicker="Database" title={who ? `Ask the data, ${who}` : 'Ask the data'} />
                <CodeFamilyPill active="database" />
              </div>
              <QuietMore items={MORE} onPick={(id) => setActive(id as DbView)} />
            </div>
            <QuerySurface key={seedSql ?? 'draft'} initialSql={seedSql ?? ''} />
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActive('query')}
              className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Database
            </button>
            <h1 className="mb-4 mt-2 font-vault text-[2.25rem] leading-tight text-zinc-100">{secondary?.label}</h1>
            {active === 'live' && <LiveClientPanel />}
            {active === 'tables' && <TableBrowserPanel onQueryTable={loadSql} />}
            {active === 'schema' && <SchemaMapPanel />}
            {active === 'designer' && <DesignerPanel />}
            {active === 'indexes' && <IndexesPanel />}
            {active === 'monitor' && <MonitoringPanel />}
            {active === 'history' && <HistoryPanel onLoadQuery={loadSql} />}
            {active === 'projects' && <ProjectsPanel />}
          </div>
        )}
        <CrossLensRecentsPanel lensId="database" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />
      </div>
    </LensShell>
  );
}
