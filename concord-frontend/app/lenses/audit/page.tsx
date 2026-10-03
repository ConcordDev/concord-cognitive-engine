'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useRef } from 'react';
import { FileSearch, AlertTriangle, Check, X, Eye, Link2, ClipboardList, ArrowRight, Hash, ShieldCheck, Bug, Wrench, LayoutList, ScrollText } from 'lucide-react';
import { CveSearch } from '@/components/audit/CveSearch';
import { AuditActionPanel } from '@/components/audit/AuditActionPanel';
import { ComplianceSuite } from '@/components/audit/ComplianceSuite';
import { PipingProvider } from '@/components/panel-polish';
import { ConnectiveTissueBar } from '@/components/lens/ConnectiveTissueBar';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

interface RawEvent {
  id: string;
  type: string;
  payload?: { entityId?: string };
  at: string;
}

interface AuditEntry {
  id: string;
  type: 'terminal' | 'tick' | 'verifier' | 'invariant' | 'dtu';
  action: string;
  status: 'success' | 'warning' | 'error';
  entityId?: string;
  details: string;
  timestamp: string;
}

type AuditView = 'overview' | 'log' | 'compliance' | 'vulns' | 'bench';

const VIEWS: { id: AuditView; label: string; keys: string; title: string; hint: string; icon: typeof Eye }[] = [
  { id: 'overview', label: 'Overview', keys: 'g o', title: 'Everything the system did', hint: 'Event totals, immutable chain and recent entries', icon: LayoutList },
  { id: 'log', label: 'Log', keys: 'g l', title: 'The full audit log', hint: 'Searchable, filterable event log', icon: ScrollText },
  { id: 'compliance', label: 'Compliance', keys: 'g c', title: 'Controls, evidence and findings', hint: 'Frameworks, evidence, monitoring, policies and vendors', icon: ShieldCheck },
  { id: 'vulns', label: 'Vulnerabilities', keys: 'g v', title: 'Look up a CVE', hint: 'CVE search', icon: Bug },
  { id: 'bench', label: 'Auditor bench', keys: 'g b', title: 'Run the auditor tools', hint: 'Compliance check, trail analysis, risk score, sampling plan', icon: Wrench },
];

const CARD = 'rounded-2xl border border-white/10 bg-[#111] p-4';

export default function AuditLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<AuditView>('overview');
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => { setView((v) => (v === 'log' ? v : 'overview')); requestAnimationFrame(() => searchInputRef.current?.focus()); } },
      ...VIEWS.map((v) => ({
        id: `audit-${v.id}`,
        keys: v.keys,
        description: `${v.label} — ${v.hint}`,
        category: 'navigation' as const,
        action: () => setView(v.id),
      })),
    ],
    { lensId: "audit" }
  );

  useLensNav('audit');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('audit');
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Backend: GET /api/events
  const { data: events, isLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['events'],
    queryFn: () => api.get('/api/events').then((r) => r.data),
  });

  // Transform events to audit entries
  const auditEntries: AuditEntry[] = (events?.events || []).slice(0, 100).map((e: RawEvent) => ({
    id: e.id,
    type: e.type?.includes('dtu') ? 'dtu' : e.type?.includes('tick') ? 'tick' : 'terminal',
    action: e.type || 'unknown',
    status: 'success',
    entityId: e.payload?.entityId,
    details: JSON.stringify(e.payload || {}),
    timestamp: e.at,
  }));

  const allEntries = [...auditEntries];

  const filteredEntries = allEntries.filter((entry) => {
    if (filter !== 'all' && entry.type !== filter) return false;
    if (searchQuery && !entry.action.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !entry.details.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const statusColors = {
    success: 'text-neon-green bg-neon-green/20',
    warning: 'text-yellow-500 bg-yellow-500/20',
    error: 'text-neon-pink bg-neon-pink/20',
  };

  const typeColors = {
    terminal: 'text-neon-cyan',
    tick: 'text-neon-blue',
    verifier: 'text-neon-purple',
    invariant: 'text-neon-green',
    dtu: 'text-neon-pink',
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8" role="status" aria-live="polite">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    // role=alert surfaces a failed /api/events feed loudly with a WORKING Retry —
    // never a swallowed-fetch silent-empty page.
    return (
      <div className="flex items-center justify-center h-full p-8" role="alert">
        <ErrorState error={(error as Error)?.message} onRetry={refetch} />
      </div>
    );
  }
  const current = VIEWS.find((v) => v.id === view)!;
  const showEntries = view === 'overview' || view === 'log';

  const stats = [
    { icon: FileSearch, value: allEntries.length, label: 'Total events', color: 'text-neon-blue' },
    { icon: Check, value: allEntries.filter((e) => e.status === 'success').length, label: 'Success', color: 'text-neon-green' },
    { icon: AlertTriangle, value: allEntries.filter((e) => e.status === 'warning').length, label: 'Warnings', color: 'text-yellow-500' },
    { icon: X, value: allEntries.filter((e) => e.status === 'error').length, label: 'Errors', color: 'text-neon-pink' },
  ];

  return (
    <LensShell lensId="audit" asMain={false}>
      <FirstRunTour lensId="audit" />
      <DepthBadge lensId="audit" size="sm" className="ml-2" />
      <a href="#audit-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to audit content</a>
      <NorthStarFrame
        lensId="audit"
        crumb="Audit"
        title={`${current.title}${view === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Searchable log of shadow DTUs, terminal audits and verifier events, with compliance automation and an auditor bench."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="audit" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-0.5 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as AuditView)}
        tabsLabel="Audit views"
        cta={{ label: 'Run an audit', icon: Wrench, onClick: () => setView('bench'), title: 'Open the auditor bench' }}
      >
        <div id="audit-skip" data-lens-theme="audit" className="space-y-5">
          {view === 'overview' && (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {stats.map((stat) => (
                <div key={stat.label} className={CARD}>
                  <stat.icon className={`mb-2 h-5 w-5 ${stat.color}`} />
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-gray-400">{stat.label}</p>
                </div>
              ))}
            </div>
          )}

          {showEntries && (
            <div className={CARD}>
              <div className="flex flex-wrap gap-4">
                <div className="min-w-[200px] flex-1">
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search actions, details..."
                    className="input-lattice w-full"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {['all', 'terminal', 'tick', 'verifier', 'invariant', 'dtu'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`rounded-full px-3 py-2 capitalize ${
                        filter === f
                          ? 'border border-neon-purple/30 bg-neon-purple/20 text-neon-purple'
                          : 'bg-white/[0.04] text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {view === 'log' && (
            <div className={CARD}>
              <h2 className="mb-4 flex items-center gap-2 font-semibold">
                <Eye className="h-4 w-4 text-neon-blue" />
                Audit Log ({filteredEntries.length} entries)
              </h2>
              <div className="max-h-[70vh] space-y-2 overflow-auto">
                {filteredEntries.map((entry) => (
                  <details key={entry.id} className="group rounded-xl bg-white/[0.03]">
                    <summary className="flex cursor-pointer list-none items-center justify-between p-4">
                      <div className="flex items-center gap-4">
                        <span className={`h-2 w-2 rounded-full ${
                          entry.status === 'success' ? 'bg-neon-green' :
                          entry.status === 'warning' ? 'bg-yellow-500' : 'bg-neon-pink'
                        }`} />
                        <div>
                          <p className={`font-mono text-sm ${typeColors[entry.type]}`}>{entry.action}</p>
                          <p className="text-xs text-gray-500">
                            {entry.type} • {new Date(entry.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <span className={`rounded px-2 py-0.5 text-xs ${statusColors[entry.status]}`}>{entry.status}</span>
                    </summary>
                    <div className="px-4 pb-4">
                      <pre className="max-h-40 overflow-auto rounded bg-black/40 p-3 text-xs text-gray-400">{entry.details}</pre>
                      {entry.entityId && <p className="mt-2 text-xs text-gray-500">Entity: {entry.entityId}</p>}
                    </div>
                  </details>
                ))}
                {filteredEntries.length === 0 && (
                  <p className="py-8 text-center text-sm text-gray-500">No audit entries found</p>
                )}
              </div>
            </div>
          )}

          {view === 'overview' && (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                <div className={CARD}>
                  <h2 className="mb-4 flex items-center gap-2 font-semibold">
                    <Link2 className="h-4 w-4 text-neon-cyan" />
                    Immutable DTU Chain
                  </h2>
                  {/* Real events only; an empty chain is an honest empty state, never a fabricated genesis node. */}
                  {filteredEntries.length === 0 ? (
                    <div className="py-8 text-center text-sm text-gray-500">
                      No DTU chain entries yet — system events will populate the immutable chain as they occur.
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute bottom-0 left-4 top-0 w-px bg-gradient-to-b from-neon-cyan via-neon-purple to-neon-green" />
                      <div className="space-y-4 pl-10">
                        {filteredEntries.slice(0, 5).map((entry, idx) => (
                          <div key={entry.id || idx} className="relative">
                            <div className="absolute -left-[26px] top-3 h-3 w-3 rounded-full border-2 border-neon-cyan bg-black" />
                            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                              <div className="mb-1 flex items-center justify-between">
                                <span className={`font-mono text-xs ${typeColors[entry.type as keyof typeof typeColors] || 'text-gray-400'}`}>{entry.action}</span>
                                <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusColors[entry.status]}`}>{entry.status}</span>
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                                <Hash className="h-3 w-3" />
                                <span className="font-mono">{entry.id?.slice(0, 12) || 'N/A'}...</span>
                                <ArrowRight className="h-3 w-3" />
                                <span>{new Date(entry.timestamp).toLocaleString()}</span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className={CARD}>
                  <h2 className="mb-3 flex items-center gap-2 font-semibold">
                    <ClipboardList className="h-4 w-4 text-neon-purple" />
                    Recent Audit Entries
                  </h2>
                  <div className="max-h-80 space-y-2 overflow-y-auto">
                    {filteredEntries.slice(0, 8).map((entry, idx) => (
                      <div key={entry.id || idx} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-2 text-xs">
                        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${
                          entry.status === 'success' ? 'bg-neon-green' :
                          entry.status === 'warning' ? 'bg-yellow-500' : 'bg-neon-pink'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm">{entry.action}</p>
                          <p className="truncate text-gray-500">{entry.type} -- {new Date(entry.timestamp).toLocaleTimeString()}</p>
                        </div>
                        {entry.entityId && (
                          <span className="rounded bg-neon-cyan/10 px-1.5 py-0.5 font-mono text-[10px] text-neon-cyan">{entry.entityId.slice(0, 8)}</span>
                        )}
                      </div>
                    ))}
                    {filteredEntries.length === 0 && (
                      <p className="py-8 text-center text-sm text-gray-500">No audit entries found</p>
                    )}
                  </div>
                </div>
              </div>

              <div className={`${CARD} border-l-4 border-l-neon-green`}>
                <h3 className="mb-2 flex items-center gap-2 font-semibold text-neon-green">
                  <Eye className="h-4 w-4" />
                  NO_SECRET_MONITORING Active
                </h3>
                <p className="text-sm text-gray-400">
                  All system operations are logged and auditable. This lens proves the
                  no_secret_monitoring invariant by exposing every action, including
                  shadow DTU operations and verifier failures.
                </p>
                {realtimeData && (
                  <RealtimeDataPanel
                    domain="audit"
                    data={realtimeData}
                    isLive={isLive}
                    lastUpdated={lastUpdated}
                    insights={realtimeInsights}
                    compact
                  />
                )}
              </div>
              <ConnectiveTissueBar lensId="audit" />
            </>
          )}

          {view === 'compliance' && <ComplianceSuite />}

          {view === 'vulns' && <section className={CARD}><CveSearch /></section>}

          {view === 'bench' && (
            <section className={CARD}>
              <h2 className="mb-3 text-sm font-semibold text-white">Auditor bench (compliance, trail analysis, risk score)</h2>
              <PipingProvider>
                <AuditActionPanel />
              </PipingProvider>
            </section>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
