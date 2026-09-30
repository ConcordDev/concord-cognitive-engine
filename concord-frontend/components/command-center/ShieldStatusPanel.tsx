'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  Shield, ShieldAlert
} from 'lucide-react';
import { StatusDot, Stat } from '@/components/command-center/cc-primitives';


export function ShieldStatusPanel() {
  const { data: status } = useQuery({
    queryKey: ['cc-shield-status'],
    queryFn: () => api.get('/api/shield/status').then(r => r.data).catch(() => null),
    refetchInterval: 15000,
  });
  const { data: threats } = useQuery({
    queryKey: ['cc-shield-threats'],
    queryFn: () => api.get('/api/shield/threats?limit=10').then(r => r.data).catch(() => null),
    refetchInterval: 30000,
  });
  const { data: predictions } = useQuery({
    queryKey: ['cc-shield-predictions'],
    queryFn: () => api.get('/api/shield/predictions?limit=5').then(r => r.data).catch(() => null),
    refetchInterval: 60000,
  });

  const metrics = status?.metrics || status;
  const stats = metrics?.stats || {};
  const tools = metrics?.tools || {};
  const threatList = threats?.threats || threats || [];
  const predictionList = predictions?.predictions || predictions || [];

  const toolNames = Object.keys(tools);
  const toolsAvailable = toolNames.filter(t => tools[t]).length;
  const toolsTotal = toolNames.length || 7;

  const TIER_MAP: Record<string, { tier: number; label: string }> = {
    clamav: { tier: 1, label: 'ClamAV (Malware)' },
    yara: { tier: 2, label: 'YARA (Classification)' },
    suricata: { tier: 3, label: 'Suricata (IDS)' },
    snort: { tier: 3, label: 'Snort (IDS)' },
    openvas: { tier: 4, label: 'OpenVAS (Vuln Scan)' },
    wazuh: { tier: 5, label: 'Wazuh (HIDS)' },
    zeek: { tier: 6, label: 'Zeek (Network)' },
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Concord Shield</h3>

      {/* Summary indicator */}
      <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm ${
        (stats.threatsDetected || 0) > 0
          ? 'bg-orange-500/10 border border-orange-500/20 text-orange-300'
          : 'bg-green-500/10 border border-green-500/20 text-green-300'
      }`}>
        <Shield className="w-4 h-4" />
        <span>
          Shield active — {stats.threatsDetected || 0} threats blocked, {stats.collectiveImmunityEvents || 0} patterns learned
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total Scans" value={stats.totalScans ?? 0} />
        <Stat label="Threats Blocked" value={stats.threatsDetected ?? 0} />
        <Stat label="Clean Files" value={stats.cleanFiles ?? 0} />
        <Stat label="Firewall Rules" value={stats.firewallRulesGenerated ?? 0} />
        <Stat label="Immunity Events" value={stats.collectiveImmunityEvents ?? 0} />
        <Stat label="Predictions" value={stats.predictionsGenerated ?? 0} />
      </div>

      {/* Security Tool Tiers (6 tiers) */}
      <div className="bg-lattice-deep rounded-lg p-3 space-y-2 border border-lattice-border">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-400 uppercase">Security Tool Tiers</p>
          <span className="text-xs text-gray-400">{toolsAvailable}/{toolsTotal} online</span>
        </div>
        {Object.entries(TIER_MAP).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-2 text-xs">
            <StatusDot status={tools[key] ? 'green' : 'red'} />
            <span className="text-gray-400">T{meta.tier}</span>
            <span className="text-gray-300 flex-1">{meta.label}</span>
            <span className="text-gray-400">{tools[key] ? 'active' : 'unavailable'}</span>
          </div>
        ))}
      </div>

      {/* Pain Integration */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-300">
        <ShieldAlert className="w-3.5 h-3.5" />
        <span>Pain integration active — threat DTUs tagged as pain_memory, never pruned</span>
      </div>

      {/* Collective Immunity */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300">
        <Shield className="w-3.5 h-3.5" />
        <span>Collective immunity: one detection protects all ({stats.collectiveImmunityEvents || 0} propagations)</span>
      </div>

      {/* Recent Detections as DTUs */}
      {Array.isArray(threatList) && threatList.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-red-400">Recent Detections ({threatList.length})</p>
          <div className="max-h-40 overflow-y-auto space-y-1">
            {threatList.slice(0, 10).map((t: { id?: string; dtuId?: string; subtype?: string; severity?: number }, i: number) => (
              <div key={t.id || t.dtuId || i} className="flex items-center gap-2 text-[11px] bg-lattice-surface rounded p-2 border border-lattice-border">
                <span className={`px-1.5 py-0.5 rounded border font-medium uppercase ${
                  (t.severity || 0) >= 7 ? 'text-red-400 bg-red-500/10 border-red-500/20' : 'text-amber-400 bg-amber-500/10 border-amber-500/20'
                }`}>{t.subtype || 'unknown'}</span>
                <span className="text-gray-400 truncate flex-1 font-mono">{(t.id || t.dtuId || '').slice(0, 20)}</span>
                <span className="text-gray-600 tabular-nums">{t.severity || '?'}/10</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prophet Predictions */}
      {Array.isArray(predictionList) && predictionList.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-purple-400">Prophet Predictions ({predictionList.length})</p>
          {predictionList.slice(0, 5).map((p: { family?: string; predictedVariant?: string; confidence?: number }, i: number) => (
            <div key={i} className="flex items-center gap-2 text-[11px] bg-lattice-surface rounded p-2 border border-purple-500/20">
              <span className="text-purple-300 capitalize font-medium">{p.family || 'unknown'}</span>
              <span className="text-gray-600">-&gt;</span>
              <span className="text-gray-400 truncate flex-1">{p.predictedVariant || '—'}</span>
              <span className="text-gray-400 tabular-nums">{p.confidence != null ? `${Math.round(p.confidence * 100)}%` : '—'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
