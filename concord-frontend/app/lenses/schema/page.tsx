'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { LensVerticalHero } from '@/components/lens/LensVerticalHero';
import { SchemaRepos } from '@/components/schema/SchemaRepos';
import { SchemaWorkbench } from '@/components/schema/SchemaWorkbench';
import { FileCode, Database, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

export default function SchemaLensPage() {
  useLensNav('schema');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('schema');
  const [showRepos, setShowRepos] = useState(false);

  return (
    <LensShell lensId="schema" asMain={false}>
      <FirstRunTour lensId="schema" />      <DepthBadge lensId="schema" size="sm" className="ml-2" />
      <LensVerticalHero lensId="schema" className="mx-6 mt-4" />
    <div className="p-6 space-y-6">
      <header className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <FileCode className="w-8 h-8 text-neon-cyan" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Dynamic Schemas</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            </div>
            <p className="text-sm text-gray-400">
              A versioned schema registry, visual editor, sample-data generator, migration
              codegen, breaking-change diff, evolution planning, live-data conformance, ER
              diagrams, and schema inference — dbdiagram.io / DataGrip parity.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DTUExportButton domain="schema" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </header>

      <RealtimeDataPanel data={realtimeInsights} />

      <section className="rounded-xl border border-cyan-500/15 bg-zinc-950/40 p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-cyan-500/15 pb-2">
          <Database className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Schema Workbench</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            registry · editor · codegen · diff · evolution
          </span>
        </div>
        <SchemaWorkbench />
      </section>
      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowRepos(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Schema tooling (GitHub)</span>
          {showRepos ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showRepos && (
          <div className="mt-3">
            <SchemaRepos />
          </div>
        )}
      </section>
    </div>          <CrossLensRecentsPanel lensId="schema" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
