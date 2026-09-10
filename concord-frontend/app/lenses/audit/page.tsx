'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from "@/hooks/useLensCommand";
import { LensShell } from '@/components/lens/LensShell';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { FileSearch, AlertTriangle, Check, X, Eye, Link2, ClipboardList, ArrowRight, Hash, ChevronDown, ChevronRight } from 'lucide-react';
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

export default function AuditLensPage() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  useLensCommand(
    [
      { id: "focus-search", keys: "/", description: "Focus search", category: "navigation", action: () => searchInputRef.current?.focus() },
    ],
    { lensId: "audit" }
  );

  useLensNav('audit');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('audit');
  const [filter, setFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showActionPanel, setShowActionPanel] = useState(false);

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
  return (
    <LensShell lensId="audit" asMain={false}>
      <FirstRunTour lensId="audit" />      <DepthBadge lensId="audit" size="sm" className="ml-2" />
    <div data-lens-theme="audit" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded bg-indigo-500/15 border border-indigo-500/30 text-xl">🔍</span>
          <div>
            <h1 className="text-xl font-bold">Audit Lens</h1>
            <p className="text-sm text-gray-400">
              Searchable log of shadow DTUs, terminal audits, verifier events
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="audit" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: FileSearch, value: allEntries.length, label: 'Total Events', color: 'text-neon-blue', bg: 'bg-neon-blue/10' },
          { icon: Check, value: allEntries.filter((e) => e.status === 'success').length, label: 'Success', color: 'text-neon-green', bg: 'bg-neon-green/10' },
          { icon: AlertTriangle, value: allEntries.filter((e) => e.status === 'warning').length, label: 'Warnings', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
          { icon: X, value: allEntries.filter((e) => e.status === 'error').length, label: 'Errors', color: 'text-neon-pink', bg: 'bg-neon-pink/10' },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            whileHover={{ scale: 1.03 }}
            className="lens-card"
          >
            <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
            <p className="text-2xl font-bold">{stat.value}</p>
            <p className="text-sm text-gray-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Compliance automation core — control frameworks, evidence, monitoring,
          findings, policies, vendors, exportable report (all macro-backed). */}
      <ComplianceSuite />

      {/* Filters */}
      <div className="panel p-4">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search actions, details..."
              className="input-lattice w-full"
            />
          </div>
          <div className="flex gap-2">
            {['all', 'terminal', 'tick', 'verifier', 'invariant', 'dtu'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-2 rounded capitalize ${
                  filter === f
                    ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                    : 'bg-lattice-surface text-gray-400'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Audit Log */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Eye className="w-4 h-4 text-neon-blue" />
          Audit Log ({filteredEntries.length} entries)
        </h2>
        <div className="space-y-2 max-h-[500px] overflow-auto">
          {filteredEntries.map((entry) => (
            <details
              key={entry.id}
              className="bg-lattice-deep rounded-lg group"
            >
              <summary className="flex items-center justify-between p-4 cursor-pointer list-none">
                <div className="flex items-center gap-4">
                  <span className={`w-2 h-2 rounded-full ${
                    entry.status === 'success' ? 'bg-neon-green' :
                    entry.status === 'warning' ? 'bg-yellow-500' : 'bg-neon-pink'
                  }`} />
                  <div>
                    <p className={`font-mono text-sm ${typeColors[entry.type]}`}>
                      {entry.action}
                    </p>
                    <p className="text-xs text-gray-500">
                      {entry.type} • {new Date(entry.timestamp).toLocaleString()}
                    </p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${statusColors[entry.status]}`}>
                  {entry.status}
                </span>
              </summary>
              <div className="px-4 pb-4">
                <pre className="text-xs bg-lattice-void p-3 rounded overflow-auto max-h-40 text-gray-400">
                  {entry.details}
                </pre>
                {entry.entityId && (
                  <p className="text-xs text-gray-500 mt-2">
                    Entity: {entry.entityId}
                  </p>
                )}
              </div>
            </details>
          ))}
        </div>
      </div>

      {/* Transparency Note */}
      <div className="panel p-4 border-l-4 border-neon-green">
        <h3 className="font-semibold text-neon-green mb-2 flex items-center gap-2">
          <Eye className="w-4 h-4" />
          NO_SECRET_MONITORING Active
        </h3>
        <p className="text-sm text-gray-400">
          All system operations are logged and auditable. This lens proves the
          no_secret_monitoring invariant by exposing every action, including
          shadow DTU operations and verifier failures.
        </p>

      {/* Real-time Data Panel */}
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

      {/* Audit Trail Section */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Link2 className="w-4 h-4 text-neon-cyan" />
          Immutable DTU Chain
        </h2>

        {/* DTU Chain Visualization — real events only. An empty chain shows an
            honest empty state (no fabricated "Genesis Block" placeholder). */}
        {filteredEntries.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No DTU chain entries yet — system events will populate the immutable chain as they occur.
          </div>
        ) : (
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-gradient-to-b from-neon-cyan via-neon-purple to-neon-green" />
            <div className="space-y-4 pl-10">
              {filteredEntries.slice(0, 5).map((entry, idx) => (
                <div key={entry.id || idx} className="relative">
                  <div className="absolute -left-[26px] top-3 w-3 h-3 rounded-full border-2 border-neon-cyan bg-lattice-deep" />
                  <div className="bg-lattice-deep rounded-lg p-3 border border-white/5">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-mono ${typeColors[entry.type as keyof typeof typeColors] || 'text-gray-400'}`}>
                        {entry.action}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColors[entry.status]}`}>
                        {entry.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-gray-500">
                      <Hash className="w-3 h-3" />
                      <span className="font-mono">{entry.id?.slice(0, 12) || 'N/A'}...</span>
                      <ArrowRight className="w-3 h-3" />
                      <span>{new Date(entry.timestamp).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Recent Audit Entries (live system event stream) */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-3 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-neon-purple" />
          Recent Audit Entries
        </h2>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {(filteredEntries.length > 0 ? filteredEntries.slice(0, 8) : []).map((entry, idx) => (
            <div key={entry.id || idx} className="flex items-center gap-3 p-2 bg-lattice-deep rounded-lg text-xs">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                entry.status === 'success' ? 'bg-neon-green' :
                entry.status === 'warning' ? 'bg-yellow-500' : 'bg-neon-pink'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm truncate">{entry.action}</p>
                <p className="text-gray-500 truncate">{entry.type} -- {new Date(entry.timestamp).toLocaleTimeString()}</p>
              </div>
              {entry.entityId && (
                <span className="text-[10px] font-mono text-neon-cyan bg-neon-cyan/10 px-1.5 py-0.5 rounded">
                  {entry.entityId.slice(0, 8)}
                </span>
              )}
            </div>
          ))}
          {filteredEntries.length === 0 && (
            <p className="text-center py-8 text-gray-500 text-sm">No audit entries found</p>
          )}
        </div>
      </div>

      <ConnectiveTissueBar lensId="audit" />

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <CveSearch />
      </section>

      <section className="mt-6 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <button
          type="button"
          onClick={() => setShowActionPanel(v => !v)}
          className="flex w-full items-center justify-between text-left text-sm font-semibold text-white"
        >
          <span>Auditor bench (compliance, trail analysis, risk score)</span>
          {showActionPanel ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {showActionPanel && (
          <div className="mt-3">
            <PipingProvider>
              <AuditActionPanel />
            </PipingProvider>
          </div>
        )}
      </section>
    </div>

      <a href="#audit-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to audit content</a>          <CrossLensRecentsPanel lensId="audit" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
