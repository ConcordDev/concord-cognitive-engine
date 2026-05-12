// @env-config-ok: seed federation peer demo data
'use client';

import React, { useState, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type InstanceStatus = 'active' | 'pending' | 'suspended';
type SyncDirection = 'push' | 'pull';
type SyncStatus = 'success' | 'failed';
type AutoSyncInterval = '15m' | '30m' | '1h' | '6h' | '24h';

interface FederatedInstance {
  id: string;
  name: string;
  url: string;
  status: InstanceStatus;
  capabilities: string[];
  lastSync: string | null;
  dtuCount: number;
}

interface SyncLogEntry {
  id: string;
  instanceId: string;
  instanceName: string;
  direction: SyncDirection;
  dtuCount: number;
  status: SyncStatus;
  timestamp: string;
}

interface SearchResult {
  id: string;
  title: string;
  instanceName: string;
  instanceId: string;
  snippet: string;
}

// ── Seed Data ──────────────────────────────────────────────────────────────────

const SEED_INSTANCES: FederatedInstance[] = [
  {
    id: 'inst-mit',
    name: 'MIT Engineering Lab',
    url: 'https://concord.mit.edu/federation/v1',
    status: 'active',
    capabilities: ['structural', 'materials', 'computation'],
    lastSync: '2h ago',
    dtuCount: 1247,
  },
  {
    id: 'inst-tokyo',
    name: 'Tokyo Institute of Technology',
    url: 'https://titech-concord.ac.jp/api/fed',
    status: 'active',
    capabilities: ['robotics', 'materials', 'nano'],
    lastSync: '1d ago',
    dtuCount: 892,
  },
  {
    id: 'inst-berlin',
    name: 'Berlin Hackerspace',
    url: 'https://berlin-hack.space/concord',
    status: 'pending',
    capabilities: ['fabrication', 'electronics'],
    lastSync: null,
    dtuCount: 0,
  },
];

const SEED_SYNC_LOG: SyncLogEntry[] = [
  { id: 'sl-1', instanceId: 'inst-mit', instanceName: 'MIT Engineering Lab', direction: 'push', dtuCount: 23, status: 'success', timestamp: '2026-04-05 09:12' },
  { id: 'sl-2', instanceId: 'inst-mit', instanceName: 'MIT Engineering Lab', direction: 'pull', dtuCount: 41, status: 'success', timestamp: '2026-04-05 09:12' },
  { id: 'sl-3', instanceId: 'inst-tokyo', instanceName: 'Tokyo Institute of Technology', direction: 'pull', dtuCount: 18, status: 'success', timestamp: '2026-04-04 14:30' },
  { id: 'sl-4', instanceId: 'inst-tokyo', instanceName: 'Tokyo Institute of Technology', direction: 'push', dtuCount: 7, status: 'failed', timestamp: '2026-04-04 14:30' },
  { id: 'sl-5', instanceId: 'inst-berlin', instanceName: 'Berlin Hackerspace', direction: 'push', dtuCount: 0, status: 'failed', timestamp: '2026-04-03 22:00' },
];

const SEED_SEARCH_RESULTS: SearchResult[] = [
  { id: 'sr-1', title: 'Composite Beam Load Analysis', instanceName: 'MIT Engineering Lab', instanceId: 'inst-mit', snippet: 'Finite element analysis of carbon-fiber reinforced composite I-beams under cyclic loading...' },
  { id: 'sr-2', title: 'Graphene Lattice Characterization', instanceName: 'Tokyo Institute of Technology', instanceId: 'inst-tokyo', snippet: 'High-resolution TEM imaging data for single-layer graphene oxide specimens...' },
  { id: 'sr-3', title: 'Steel Fatigue Testing Results', instanceName: 'MIT Engineering Lab', instanceId: 'inst-mit', snippet: 'S-N curve datasets for ASTM A572 Grade 50 structural steel under variable amplitude loading...' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<InstanceStatus, { dot: string; bg: string; text: string; label: string }> = {
  active: { dot: 'bg-emerald-400', bg: 'bg-emerald-500/15', text: 'text-emerald-300', label: 'Active' },
  pending: { dot: 'bg-amber-400', bg: 'bg-amber-500/15', text: 'text-amber-300', label: 'Pending' },
  suspended: { dot: 'bg-red-400', bg: 'bg-red-500/15', text: 'text-red-300', label: 'Suspended' },
};

function truncateUrl(url: string, max = 38): string {
  return url.length > max ? url.slice(0, max) + '\u2026' : url;
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InstanceStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function CapabilityTag({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider bg-white/5 text-white/40 border border-white/5">
      {label}
    </span>
  );
}

function InstanceCard({
  instance,
  onSync,
}: {
  instance: FederatedInstance;
  onSync: (id: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-white">{instance.name}</h3>
            <StatusBadge status={instance.status} />
          </div>
          <p className="text-xs text-white/30 font-mono mt-1">{truncateUrl(instance.url)}</p>
        </div>
        <button
          onClick={() => onSync(instance.id)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600/20 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-600/30 transition-colors"
        >
          Sync Now
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {instance.capabilities.map((cap) => (
          <CapabilityTag key={cap} label={cap} />
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-white/40">
        <span>
          Last sync:{' '}
          <span className="text-white/60">{instance.lastSync ?? 'Never'}</span>
        </span>
        <span>
          DTUs: <span className="text-cyan-300 font-semibold">{instance.dtuCount.toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export default function FederationPanel() {
  const [instances, setInstances] = useState<FederatedInstance[]>(SEED_INSTANCES);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>(SEED_SYNC_LOG);

  // Register form
  const [regName, setRegName] = useState('');
  const [regUrl, setRegUrl] = useState('');
  const [regKey, setRegKey] = useState('');
  const [regEmail, setRegEmail] = useState('');

  // Sync controls
  const [autoInterval, setAutoInterval] = useState<AutoSyncInterval>('1h');
  const [filterPublic, setFilterPublic] = useState(true);
  const [filterValidated, setFilterValidated] = useState(false);

  // Cross-instance search
  const [searchQuery, setSearchQuery] = useState('');

  // Stats
  const stats = useMemo(() => {
    const totalInstances = instances.length;
    const totalDTUs = instances.reduce((sum, i) => sum + i.dtuCount, 0);
    const lastGlobal = syncLog
      .filter((l) => l.status === 'success')
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]?.timestamp ?? 'N/A';
    return { totalInstances, totalDTUs, lastGlobal };
  }, [instances, syncLog]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return SEED_SEARCH_RESULTS.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.snippet.toLowerCase().includes(q) ||
        r.instanceName.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const handleSync = (instanceId: string) => {
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    const entry: SyncLogEntry = {
      id: `sl-${Date.now()}`,
      instanceId,
      instanceName: inst.name,
      direction: 'pull',
      dtuCount: Math.floor(Math.random() * 30) + 1,
      status: 'success',
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16),
    };
    setSyncLog((prev) => [entry, ...prev]);
    setInstances((prev) =>
      prev.map((i) =>
        i.id === instanceId ? { ...i, lastSync: 'just now', dtuCount: i.dtuCount + entry.dtuCount } : i,
      ),
    );
  };

  const handleRegister = () => {
    if (!regName.trim() || !regUrl.trim()) return;
    const newInst: FederatedInstance = {
      id: `inst-${Date.now()}`,
      name: regName.trim(),
      url: regUrl.trim(),
      status: 'pending',
      capabilities: [],
      lastSync: null,
      dtuCount: 0,
    };
    setInstances((prev) => [...prev, newInst]);
    setRegName('');
    setRegUrl('');
    setRegKey('');
    setRegEmail('');
  };

  const intervalOptions: AutoSyncInterval[] = ['15m', '30m', '1h', '6h', '24h'];

  return (
    <div className="w-full rounded-2xl bg-black/80 backdrop-blur-xl border border-white/10 text-white overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-white/10">
        <h2 className="text-xl font-bold tracking-tight">Federation Manager</h2>
        <p className="text-sm text-white/40 mt-1">
          Connect, sync, and manage federated Concord instances
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-white/5 bg-white/[0.02] text-xs">
        <div className="text-white/40">
          Instances: <span className="text-white font-semibold">{stats.totalInstances}</span>
        </div>
        <div className="text-white/40">
          Synced DTUs: <span className="text-cyan-300 font-semibold">{stats.totalDTUs.toLocaleString()}</span>
        </div>
        <div className="text-white/40">
          Last global sync: <span className="text-white/60">{stats.lastGlobal}</span>
        </div>
      </div>

      <div className="p-6 space-y-8">
        {/* ── Instance List ──────────────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Federated Instances
          </h3>
          <div className="space-y-3">
            {instances.map((inst) => (
              <InstanceCard key={inst.id} instance={inst} onSync={handleSync} />
            ))}
          </div>
        </section>

        {/* ── Register Instance ──────────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Register New Instance
          </h3>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={regName}
                onChange={(e) => setRegName(e.target.value)}
                placeholder="Instance name"
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
              <input
                type="url"
                value={regUrl}
                onChange={(e) => setRegUrl(e.target.value)}
                placeholder="Federation endpoint URL"
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
            <textarea
              value={regKey}
              onChange={(e) => setRegKey(e.target.value)}
              placeholder="Public key (PEM format)"
              rows={3}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 font-mono focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
            />
            <input
              type="email"
              value={regEmail}
              onChange={(e) => setRegEmail(e.target.value)}
              placeholder="Admin contact email"
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            <button
              onClick={handleRegister}
              disabled={!regName.trim() || !regUrl.trim()}
              className="px-5 py-2 rounded-lg text-sm font-semibold bg-cyan-600 hover:bg-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Register Instance
            </button>
          </div>
        </section>

        {/* ── Sync Controls ─────────────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Sync Controls
          </h3>
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
            {/* Auto-sync interval */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/50 w-28 shrink-0">Auto-sync:</span>
              <div className="flex gap-1.5">
                {intervalOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setAutoInterval(opt)}
                    className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                      autoInterval === opt
                        ? 'bg-cyan-600 text-white'
                        : 'bg-white/5 text-white/40 hover:text-white/60'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter toggles */}
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterPublic}
                  onChange={() => setFilterPublic(!filterPublic)}
                  className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/30"
                />
                Public DTUs only
              </label>
              <label className="flex items-center gap-2 text-sm text-white/50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterValidated}
                  onChange={() => setFilterValidated(!filterValidated)}
                  className="rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500/30"
                />
                Validated only
              </label>
            </div>
          </div>
        </section>

        {/* ── Sync Log ──────────────────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Sync Log
          </h3>
          <div className="rounded-xl border border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-white/5 text-white/40 text-xs uppercase tracking-wider">
                  <th className="px-4 py-2 text-left font-medium">Direction</th>
                  <th className="px-4 py-2 text-left font-medium">Instance</th>
                  <th className="px-4 py-2 text-right font-medium">DTUs</th>
                  <th className="px-4 py-2 text-center font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Timestamp</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {syncLog.slice(0, 8).map((entry) => (
                  <tr key={entry.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 text-white/60 font-mono">
                      {entry.direction === 'push' ? (
                        <span className="text-amber-300">{'\u2192'} push</span>
                      ) : (
                        <span className="text-cyan-300">{'\u2190'} pull</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-white/70">{entry.instanceName}</td>
                    <td className="px-4 py-2.5 text-right text-white/60">{entry.dtuCount}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          entry.status === 'success'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-red-500/15 text-red-300'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-white/40 font-mono text-xs">
                      {entry.timestamp}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Cross-Instance Search ─────────────────────────────────────── */}
        <section>
          <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider mb-3">
            Cross-Instance Search
          </h3>
          <div className="space-y-3">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across federated instances..."
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-white/20 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/30 transition-colors"
            />

            {searchQuery.trim() && searchResults.length === 0 && (
              <p className="text-sm text-white/30 py-4 text-center">
                No results found across federated instances.
              </p>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-2">
                {searchResults.map((result) => (
                  <div
                    key={result.id}
                    className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-1"
                  >
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-medium text-white">{result.title}</h4>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/15 text-purple-300 border border-purple-500/20">
                        {result.instanceName}
                      </span>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">{result.snippet}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
