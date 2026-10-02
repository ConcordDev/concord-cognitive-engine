'use client';

/**
 * Debug — north star (docs/lens-northstar/30): one issue list.
 * Status, traces, metrics and the rest of the desk stay under More.
 */

import { useState, type ComponentType } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { CodeFamilyPill, NorthGreeting, QuietMore } from '@/components/code/CodeFamilyChrome';
import { IssueInbox } from '@/components/debug/IssueInbox';

import { StatusPanel } from '@/components/debug/StatusPanel';
import { TracesPanel } from '@/components/debug/TracesPanel';
import { MetricsPanel } from '@/components/debug/MetricsPanel';
import { ReleasesPanel } from '@/components/debug/ReleasesPanel';
import { EventsPanel } from '@/components/debug/EventsPanel';
import { LogsPanel } from '@/components/debug/LogsPanel';
import { InspectorPanel } from '@/components/debug/InspectorPanel';
import { ContextInspectorPanel } from '@/components/debug/ContextInspectorPanel';
import { MonitoringPanel } from '@/components/debug/MonitoringPanel';
import { ComputeDeskPanel } from '@/components/debug/ComputeDeskPanel';
import { TemplatesPanel } from '@/components/debug/TemplatesPanel';
import { CvePanel } from '@/components/debug/CvePanel';
import { TestConsolePanel } from '@/components/debug/TestConsolePanel';

type DebugView =
  | 'issues'
  | 'status'
  | 'traces'
  | 'metrics'
  | 'releases'
  | 'events'
  | 'logs'
  | 'inspector'
  | 'context'
  | 'monitoring'
  | 'compute'
  | 'templates'
  | 'cve'
  | 'test';

const MORE: { id: Exclude<DebugView, 'issues'>; label: string; key?: string }[] = [
  { id: 'status', label: 'Status', key: 's' },
  { id: 'traces', label: 'Traces', key: 'r' },
  { id: 'metrics', label: 'Metrics', key: 'a' },
  { id: 'releases', label: 'Releases', key: 'd' },
  { id: 'events', label: 'Events', key: 'e' },
  { id: 'logs', label: 'Logs', key: 'l' },
  { id: 'inspector', label: 'Inspector', key: 'i' },
  { id: 'context', label: 'Context', key: 'c' },
  { id: 'monitoring', label: 'Monitoring', key: 'm' },
  { id: 'compute', label: 'Compute', key: 'o' },
  { id: 'templates', label: 'Templates', key: 't' },
  { id: 'cve', label: 'CVE', key: 'v' },
  { id: 'test', label: 'Test', key: '0' },
];

const PANELS: Record<Exclude<DebugView, 'issues'>, ComponentType> = {
  status: StatusPanel,
  traces: TracesPanel,
  metrics: MetricsPanel,
  releases: ReleasesPanel,
  events: EventsPanel,
  logs: LogsPanel,
  inspector: InspectorPanel,
  context: ContextInspectorPanel,
  monitoring: MonitoringPanel,
  compute: ComputeDeskPanel,
  templates: TemplatesPanel,
  cve: CvePanel,
  test: TestConsolePanel,
};

export default function DebugLensPage() {
  useLensNav('debug');
  useLensIdentity('debug');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<DebugView>('issues');

  useLensCommand(
    [
      { id: 'view-issues', keys: 'g', description: 'Issue list', category: 'navigation', action: () => setActive('issues') },
      ...MORE.map((v) => ({
        id: `view-${v.id}`,
        keys: v.key || v.id,
        description: v.label,
        category: 'navigation' as const,
        action: () => setActive(v.id),
      })),
    ],
    { lensId: 'debug' },
  );

  const secondary = MORE.find((v) => v.id === active);
  const Panel = active === 'issues' ? null : PANELS[active];

  return (
    <LensShell lensId="debug" asMain={false} disableAgentFab>
      <div data-lens-theme="debug" className="min-h-[calc(100vh-4rem)] px-8 pb-28 pt-4">
        {active === 'issues' ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <NorthGreeting kicker="Debug" title={who ? `What broke, ${who}` : 'What broke'} />
                <CodeFamilyPill active="debug" />
              </div>
              <QuietMore items={MORE} onPick={(id) => setActive(id as DebugView)} />
            </div>
            <div className="mt-6">
              <IssueInbox quiet />
            </div>
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => setActive('issues')}
              className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
            >
              <ArrowLeft className="h-4 w-4" />
              Debug
            </button>
            <h1 className="mb-4 mt-2 font-vault text-[2.25rem] leading-tight text-zinc-100">{secondary?.label}</h1>
            {Panel && <Panel />}
          </div>
        )}
        <CrossLensRecentsPanel lensId="debug" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />
      </div>
    </LensShell>
  );
}
