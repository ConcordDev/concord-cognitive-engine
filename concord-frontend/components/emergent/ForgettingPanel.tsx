'use client';

import { useState, useEffect } from 'react';
import { Trash2, Play, Clock, Eye } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { showToast } from '@/components/common/Toasts';

interface ForgettingStatus {
  running: boolean;
  threshold: number;
  lastRun: string | null;
  nextRun: string | null;
  lifetimeForgotten: number;
  tombstones: number;
  interval: number;
}

interface Tombstone {
  id: string;
  originalId: string;
  title: string;
  tier: string;
  score: number;
  forgottenAt: string;
}

export function ForgettingPanel() {
  const [status, setStatus] = useState<ForgettingStatus | null>(null);
  const [tombstones, setTombstones] = useState<Tombstone[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    apiHelpers.forgetting.status().then((resp) => {
      setStatus(resp.data);
    }).catch(err => { console.error('[Forgetting] Failed to load status:', err); showToast('error', 'Failed to load forgetting status'); });
  }, []);

  const loadHistory = async () => {
    const resp = await apiHelpers.forgetting.history(10);
    setTombstones(resp.data?.tombstones || []);
    setShowHistory(true);
  };

  const runCycle = async () => {
    setRunning(true);
    try {
      await apiHelpers.forgetting.run();
      const resp = await apiHelpers.forgetting.status();
      setStatus(resp.data);
    } catch (e) { console.error('[Forgetting] Failed to run forgetting cycle:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to run forgetting cycle' }); }
    setRunning(false);
  };

  const previewCandidates = async () => {
    try {
      const resp = await apiHelpers.forgetting.candidates();
      const data = resp.data;
      alert(`${data.candidateCount || 0} candidates for forgetting (threshold: ${data.threshold})`);
    } catch (e) { console.error('[Forgetting] Failed to preview candidates:', e); useUIStore.getState().addToast({ type: 'error', message: 'Failed to preview forgetting candidates' }); }
  };

  return (
    <div className="panel p-4 space-y-3">
      <h3 className="font-semibold text-sm flex items-center gap-2">
        <Trash2 className="w-4 h-4 text-red-400" />
        Forgetting Engine
      </h3>

      {status ? (
        <>
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Tombstones</p>
              <p className="text-lg font-mono text-gray-200">{status.tombstones}</p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Lifetime</p>
              <p className="text-lg font-mono text-gray-200">{status.lifetimeForgotten}</p>
            </div>
            <div className="bg-lattice-deep rounded p-2 text-center">
              <p className="text-gray-400">Threshold</p>
              <p className="text-lg font-mono text-gray-200">{status.threshold}</p>
            </div>
          </div>

          {status.lastRun && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Last run: {new Date(status.lastRun).toLocaleString()}
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={previewCandidates}
              className="flex-1 bg-lattice-deep border border-lattice-edge rounded py-1.5 text-xs text-gray-300 hover:bg-lattice-edge flex items-center justify-center gap-1"
            >
              <Eye className="w-3 h-3" /> Preview
            </button>
            <button
              onClick={runCycle}
              disabled={running}
              className="flex-1 bg-red-500/10 border border-red-500/30 rounded py-1.5 text-xs text-red-400 hover:bg-red-500/20 disabled:opacity-50 flex items-center justify-center gap-1"
            >
              <Play className="w-3 h-3" /> {running ? 'Running...' : 'Run Now'}
            </button>
          </div>

          {!showHistory ? (
            <button onClick={loadHistory} className="text-xs text-gray-500 hover:text-gray-300">
              Show recent tombstones
            </button>
          ) : (
            <div className="space-y-1.5">
              {tombstones.map((t) => (
                <div key={t.id} className="bg-lattice-deep rounded p-2 text-xs">
                  <span className="text-gray-300">{t.title}</span>
                  <span className="text-gray-500 ml-2 font-mono">{t.tier}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-gray-500">Loading...</p>
      )}
    </div>
  );
}
