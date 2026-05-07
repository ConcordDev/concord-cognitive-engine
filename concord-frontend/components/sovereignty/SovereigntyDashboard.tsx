'use client';

/**
 * SovereigntyDashboard — Shows sovereignty status, preferences, unsync controls.
 * "Your Concord is X% sovereign" metric.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, exportSubstrate } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/store/ui';
import {
  Shield,
  Lock,
  Globe,
  Trash2,
  Settings,
  Database,
  RefreshCw,
  AlertTriangle,
  Download,
} from 'lucide-react';

type ConsentMode = 'ask' | 'always_temp' | 'always_permanent' | 'never';

interface SovereigntyStatus {
  ok: boolean;
  mode: string;
  globalAssistConsent: ConsentMode;
  personalDTUs: number;
  syncedGlobalDTUs: number;
  syncedDomains: string[];
  totalDTUs: number;
  entities: number;
  sovereigntyPct: number;
}

const CONSENT_OPTIONS: { value: ConsentMode; label: string; desc: string; icon: typeof Shield }[] =
  [
    {
      value: 'ask',
      label: 'Ask me every time',
      desc: 'Sovereignty prompt on each global assist',
      icon: Shield,
    },
    {
      value: 'always_temp',
      label: 'Sync temporarily',
      desc: 'Auto-approve, borrow then forget',
      icon: RefreshCw,
    },
    {
      value: 'always_permanent',
      label: 'Sync permanently',
      desc: 'Auto-approve, add to my substrate',
      icon: Database,
    },
    {
      value: 'never',
      label: 'Never use global',
      desc: 'Always answer from local only',
      icon: Lock,
    },
  ];

function SovereigntyDashboard() {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery<SovereigntyStatus>({
    queryKey: ['sovereignty-status'],
    queryFn: () => api.get('/api/sovereignty/status').then((r) => r.data),
    refetchInterval: 30000,
  });

  const updatePref = useMutation({
    mutationFn: (consent: ConsentMode) =>
      api.put('/api/sovereignty/preferences', { globalAssistConsent: consent }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sovereignty-status'] }),
  });

  const unsync = useMutation({
    mutationFn: (domain?: string) =>
      api.post('/api/sovereignty/unsync', { domain: domain || null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sovereignty-status'] }),
  });

  const [confirmUnsyncAll, setConfirmUnsyncAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExportSubstrate = async () => {
    setExporting(true);
    try {
      const response = await exportSubstrate();
      const blob = new Blob([response.data], { type: 'application/gzip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `substrate-export-${new Date().toISOString().slice(0, 10)}.gz`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[Sovereignty] Failed to export substrate:', e);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to export substrate' });
    } finally {
      setExporting(false);
    }
  };

  if (isLoading || !status) {
    return (
      <div className="p-6 text-center text-gray-500">
        <Shield className="w-8 h-8 mx-auto mb-2 animate-pulse" />
        Loading sovereignty status...
      </div>
    );
  }

  const pct = status.sovereigntyPct;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-neon-cyan" />
          Sovereignty
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportSubstrate}
            disabled={exporting}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors disabled:opacity-50"
            title="Export substrate backup"
          >
            <Download className={cn('w-3.5 h-3.5', exporting && 'animate-pulse')} />
            Export
          </button>
          <div
            className={cn(
              'px-3 py-1 rounded-full text-sm font-medium',
              pct >= 80
                ? 'bg-neon-green/20 text-neon-green'
                : pct >= 50
                  ? 'bg-neon-cyan/20 text-neon-cyan'
                  : 'bg-amber-400/20 text-amber-400'
            )}
          >
            {pct}% sovereign
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{status.personalDTUs}</p>
          <p className="text-xs text-zinc-400">Personal DTUs</p>
        </div>
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{status.syncedGlobalDTUs}</p>
          <p className="text-xs text-zinc-400">Synced Global</p>
        </div>
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{status.entities}</p>
          <p className="text-xs text-zinc-400">Entities</p>
        </div>
        <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-white">{status.totalDTUs}</p>
          <p className="text-xs text-zinc-400">Total DTUs</p>
        </div>
      </div>

      {/* Mode */}
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-lg p-4">
        <p className="text-sm text-zinc-400 mb-1">Onboarding mode</p>
        <p className="text-white font-medium capitalize">
          {status.mode?.replace(/_/g, ' ') || 'Not set'}
        </p>
      </div>

      {/* Global Assist Preference */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
          <Settings className="w-4 h-4" />
          When my substrate isn&apos;t enough:
        </h3>
        <div className="space-y-2">
          {CONSENT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updatePref.mutate(opt.value)}
              disabled={updatePref.isPending}
              className={cn(
                'w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3',
                status.globalAssistConsent === opt.value
                  ? 'border-neon-cyan/50 bg-neon-cyan/5'
                  : 'border-zinc-700 hover:border-zinc-600'
              )}
            >
              <opt.icon
                className={cn(
                  'w-4 h-4',
                  status.globalAssistConsent === opt.value ? 'text-neon-cyan' : 'text-zinc-500'
                )}
              />
              <div>
                <p
                  className={cn(
                    'text-sm font-medium',
                    status.globalAssistConsent === opt.value ? 'text-white' : 'text-zinc-300'
                  )}
                >
                  {opt.label}
                </p>
                <p className="text-xs text-zinc-500">{opt.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Synced Domains */}
      {status.syncedDomains.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
            <Globe className="w-4 h-4" />
            Synced domains
          </h3>
          <div className="flex flex-wrap gap-2">
            {status.syncedDomains.map((domain) => (
              <div
                key={domain}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 border border-zinc-700 text-sm"
              >
                <span className="text-zinc-300">{domain}</span>
                <button
                  onClick={() => unsync.mutate(domain)}
                  disabled={unsync.isPending}
                  className="text-zinc-500 hover:text-red-400 transition-colors"
                  title={`Unsync ${domain}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unsync All */}
      {status.syncedGlobalDTUs > 0 && (
        <div className="border-t border-zinc-800 pt-4">
          {!confirmUnsyncAll ? (
            <button
              onClick={() => setConfirmUnsyncAll(true)}
              className="flex items-center gap-2 text-sm text-red-400/70 hover:text-red-400 transition-colors"
            >
              <AlertTriangle className="w-4 h-4" />
              Unsync all global knowledge
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-sm text-red-400">
                Remove all {status.syncedGlobalDTUs} synced DTUs?
              </span>
              <button
                onClick={() => {
                  unsync.mutate(undefined);
                  setConfirmUnsyncAll(false);
                }}
                className="px-3 py-1 rounded bg-red-500/20 text-red-400 text-sm hover:bg-red-500/30"
              >
                Yes, unsync all
              </button>
              <button
                onClick={() => setConfirmUnsyncAll(false)}
                className="px-3 py-1 rounded bg-zinc-700 text-zinc-400 text-sm hover:bg-zinc-600"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { withErrorBoundary } from '@/components/common/ErrorBoundary';
const _WrappedSovereigntyDashboard = withErrorBoundary(SovereigntyDashboard);
export { _WrappedSovereigntyDashboard as SovereigntyDashboard };
