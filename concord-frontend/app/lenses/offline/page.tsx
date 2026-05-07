'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { Wifi, WifiOff, Database, RefreshCw, Upload, Download, Trash2, Loader2, Layers, ChevronDown, CloudOff, HardDrive, Play } from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { motion, AnimatePresence } from 'framer-motion';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface SyncItem {
  id: string;
  type: 'dtu' | 'event' | 'setting';
  action: 'create' | 'update' | 'delete';
  timestamp: string;
  synced: boolean;
}

// Seed data for pending sync items
const SEED_SYNC_ITEMS: {
  title: string;
  data: Record<string, unknown>;
}[] = [];

export default function OfflineLensPage() {
  useLensNav('offline');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('offline');
  const [isOnline, setIsOnline] = useState(true);
  const [showFeatures, setShowFeatures] = useState(true);
  const qc = useQueryClient();

  // Fetch cache stats from the real DB status endpoint
  const { data: dbStatusResponse, isLoading: statsLoading, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['db', 'status'],
    queryFn: async () => {
      const { data } = await apiHelpers.db.status();
      return data as {
        ok: boolean;
        dtus?: number;
        events?: number;
        settings?: number;
        totalSize?: string;
        [key: string]: unknown;
      };
    },
    staleTime: 10000,
    retry: 1,
  });

  const cacheStats = {
    dtus: dbStatusResponse?.dtus ?? 0,
    events: dbStatusResponse?.events ?? 0,
    settings: dbStatusResponse?.settings ?? 0,
    totalSize: dbStatusResponse?.totalSize ?? '-- MB',
  };

  // Fetch pending sync items via useLensData
  const {
    items: syncItems,
    isLoading: syncLoading, isError: isError, error: error,
    remove: removeSyncItem,
    refetch: refetchSync,
  } = useLensData<SyncItem>('offline', 'sync-item', {
    seed: SEED_SYNC_ITEMS,
  });

  const runAction = useRunArtifact('offline');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);
  const handleAction = async (action: string) => {
    const targetId = syncItems[0]?.id;
    if (!targetId) { setActionResult({ message: 'No sync items found. Add sync data first.' }); return; }
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    finally { setIsRunning(null); }
  };

  const pendingSync: SyncItem[] = syncItems.map((item) => {
    const d = item.data as unknown as SyncItem;
    return {
      id: item.id,
      type: d.type ?? 'dtu',
      action: d.action ?? 'create',
      timestamp: d.timestamp ?? item.createdAt,
      synced: d.synced ?? false,
    };
  });

  // Sync All mutation — calls apiHelpers.db.sync()
  const syncAllMut = useMutation({
    mutationFn: async () => {
      const { data } = await apiHelpers.db.sync();
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db', 'status'] });
      qc.invalidateQueries({ queryKey: ['lens', 'offline', 'list'] });
    },
    onError: (err) => console.error('syncAllMut failed:', err instanceof Error ? err.message : err),
  });

  // Clear Cache mutation — deletes all sync items one by one
  const clearCacheMut = useMutation({
    mutationFn: async () => {
      const deletePromises = syncItems.map((item) => removeSyncItem(item.id));
      await Promise.all(deletePromises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['db', 'status'] });
      qc.invalidateQueries({ queryKey: ['lens', 'offline', 'list'] });
    },
    onError: (err) => console.error('clearCacheMut failed:', err instanceof Error ? err.message : err),
  });

  // Sync a single item
  const syncSingleMut = useMutation({
    mutationFn: async (itemId: string) => {
      const { data } = await apiHelpers.db.sync(1);
      await removeSyncItem(itemId);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lens', 'offline', 'list'] });
    },
    onError: (err) => console.error('syncSingleMut failed:', err instanceof Error ? err.message : err),
  });

  // Force Refresh — invalidate all queries to re-fetch from server
  const handleForceRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['db', 'status'] });
    qc.invalidateQueries({ queryKey: ['lens', 'offline', 'list'] });
    refetchSync();
  }, [qc, refetchSync]);

  const handleSyncAll = useCallback(() => {
    if (!isOnline) return;
    syncAllMut.mutate();
  }, [isOnline, syncAllMut]);

  const handleClearCache = useCallback(() => {
    clearCacheMut.mutate();
  }, [clearCacheMut]);

  const handleSyncSingle = useCallback(
    (itemId: string) => {
      if (!isOnline) return;
      syncSingleMut.mutate(itemId);
    },
    [isOnline, syncSingleMut]
  );

  const handleDeleteSingle = useCallback(
    (itemId: string) => {
      removeSyncItem(itemId);
    },
    [removeSyncItem]
  );

  const isLoading = statsLoading || syncLoading;
  const isSyncing = syncAllMut.isPending || syncSingleMut.isPending;

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-neon-blue" />
        <span className="ml-3 text-gray-400">Loading offline cache data...</span>
      </div>
    );
  }


  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetchSync(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="offline" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">📴</span>
          <div>
            <h1 className="text-xl font-bold">Offline Lens</h1>
            <p className="text-sm text-gray-400">
              Dexie cache manager and sync queue resolution
            </p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="offline" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <button
          onClick={() => setIsOnline(!isOnline)}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg ${
            isOnline ? 'bg-neon-green/20 text-neon-green' : 'bg-neon-pink/20 text-neon-pink'
          }`}
        >
          {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
          {isOnline ? 'Online' : 'Offline'}
        </button>
      </header>


      {/* AI Actions */}
      <UniversalActions domain="offline" artifactId={syncItems[0]?.id} compact />

      {/* Sync Status Badges & Last Sync */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="panel p-4 flex flex-col md:flex-row items-start md:items-center gap-4"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-green-500/15 text-green-400">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> {pendingSync.filter(i => i.synced).length} Synced
          </span>
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-400">
            <span className="w-2 h-2 rounded-full bg-amber-400" /> {pendingSync.filter(i => !i.synced).length} Pending
          </span>
          <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-red-500/15 text-red-400">
            <CloudOff className="w-3 h-3" /> 0 Conflicts
          </span>
        </div>
        <div className="flex-1" />
        <div className="text-xs text-gray-500 flex items-center gap-2">
          <RefreshCw className="w-3 h-3" />
          Last sync: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Never'}
        </div>
      </motion.div>

      {/* Offline Storage Usage Bar */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        className="panel p-4"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-neon-blue" /> Offline Storage Usage
          </span>
          <span className="text-xs text-gray-400">{cacheStats.totalSize}</span>
        </div>
        <div className="relative w-full h-6 bg-lattice-deep rounded-full overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-neon-blue/60 to-neon-cyan/60 rounded-full transition-all duration-700"
            style={{ width: `${Math.min(((cacheStats.dtus + cacheStats.events) / Math.max(cacheStats.dtus + cacheStats.events + 50, 100)) * 100, 95)}%` }}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-white drop-shadow">{cacheStats.dtus} DTUs + {cacheStats.events} Events</span>
          </div>
        </div>
        <div className="flex justify-between text-[10px] text-gray-600 mt-1">
          <span>0%</span>
          <span>Storage capacity</span>
          <span>100%</span>
        </div>
      </motion.div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="lens-card">
          <Database className="w-5 h-5 text-neon-blue mb-2" />
          <p className="text-2xl font-bold">{cacheStats.dtus}</p>
          <p className="text-sm text-gray-400">Cached DTUs</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="lens-card">
          <RefreshCw className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">{pendingSync.length}</p>
          <p className="text-sm text-gray-400">Pending Sync</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="lens-card">
          <Download className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">{cacheStats.totalSize}</p>
          <p className="text-sm text-gray-400">Cache Size</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="lens-card">
          <Upload className="w-5 h-5 text-neon-cyan mb-2" />
          <p className="text-2xl font-bold">{cacheStats.events}</p>
          <p className="text-sm text-gray-400">Cached Events</p>
        </motion.div>
      </div>

      {/* Sync Queue */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 text-neon-purple ${isSyncing ? 'animate-spin' : ''}`} />
            Sync Queue
          </h2>
          <button
            className="btn-neon text-sm"
            disabled={!isOnline || isSyncing}
            onClick={handleSyncAll}
          >
            {isSyncing ? (
              <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2 inline" />
            )}
            {isSyncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>
        <div className="space-y-2">
          {pendingSync.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-4">No pending sync items</p>
          )}
          <AnimatePresence>
          {pendingSync.map((item, idx) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -100 }} transition={{ delay: idx * 0.05 }}
              className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${item.synced ? 'bg-neon-green' : 'bg-yellow-500'}`} />
                <div>
                  <p className="text-sm font-medium capitalize">{item.action} {item.type}</p>
                  <p className="text-xs text-gray-500">{new Date(item.timestamp).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="p-2 bg-neon-green/20 text-neon-green rounded"
                  disabled={!isOnline || isSyncing}
                  onClick={() => handleSyncSingle(item.id)}
                >
                  <Upload className="w-4 h-4" />
                </button>
                <button
                  className="p-2 bg-neon-pink/20 text-neon-pink rounded"
                  onClick={() => handleDeleteSingle(item.id)}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Cache Management */}
      <div className="panel p-4">
        <h2 className="font-semibold mb-4 flex items-center gap-2">
          <Database className="w-4 h-4 text-neon-blue" />
          Cache Management
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            className="lens-card text-left hover:border-neon-green"
            onClick={handleSyncAll}
            disabled={!isOnline || isSyncing}
          >
            <Download className="w-5 h-5 text-neon-green mb-2" />
            <p className="font-medium">Download All</p>
            <p className="text-xs text-gray-400">Cache entire database locally</p>
          </button>
          <button
            className="lens-card text-left hover:border-neon-blue"
            onClick={handleForceRefresh}
          >
            <RefreshCw className="w-5 h-5 text-neon-blue mb-2" />
            <p className="font-medium">Force Refresh</p>
            <p className="text-xs text-gray-400">Re-sync from server</p>
          </button>
          <button
            className="lens-card text-left hover:border-neon-pink"
            onClick={handleClearCache}
            disabled={clearCacheMut.isPending}
          >
            <Trash2 className="w-5 h-5 text-neon-pink mb-2" />
            <p className="font-medium">{clearCacheMut.isPending ? 'Clearing...' : 'Clear Cache'}</p>
            <p className="text-xs text-gray-400">Remove all cached data</p>
          </button>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <RealtimeDataPanel
          domain="offline"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
      </div>

      {/* Backend Action Panel */}
      <div className="panel p-4 space-y-3">
        <h2 className="font-semibold flex items-center gap-2">
          <CloudOff className="w-4 h-4 text-neon-cyan" />
          Offline Analysis
        </h2>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'syncConflict', label: 'Sync Conflict' },
            { action: 'cacheStrategy', label: 'Cache Strategy' },
            { action: 'deltaCompute', label: 'Delta Compute' },
          ].map(({ action, label }) => (
            <button key={action} onClick={() => handleAction(action)} disabled={!!isRunning}
              className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">
              {isRunning === action ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="bg-lattice-deep rounded-lg p-4 space-y-3 text-sm">
            {'conflicts' in actionResult && Array.isArray(actionResult.conflicts) && (
              <div className="space-y-2">
                <div className="flex gap-4 text-xs text-gray-400">
                  <span>Conflicts: <span className="text-neon-cyan font-bold">{String((actionResult.conflicts as unknown[]).length)}</span></span>
                  <span>Strategy: <span className="text-neon-purple">{String(actionResult.strategy)}</span></span>
                </div>
                {'summary' in actionResult && actionResult.summary !== null && typeof actionResult.summary === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.summary as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'hotColdSplit' in actionResult && (
              <div className="space-y-2">
                {'hotColdSplit' in actionResult && actionResult.hotColdSplit !== null && typeof actionResult.hotColdSplit === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.hotColdSplit as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'evictionPolicy' in actionResult && actionResult.evictionPolicy !== null && typeof actionResult.evictionPolicy === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.evictionPolicy as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-green">{String(v)}</span></span>
                    ))}
                  </div>
                )}
              </div>
            )}
            {'changes' in actionResult && (
              <div className="space-y-2">
                {'changes' in actionResult && actionResult.changes !== null && typeof actionResult.changes === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.changes as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-cyan">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'bandwidth' in actionResult && actionResult.bandwidth !== null && typeof actionResult.bandwidth === 'object' && (
                  <div className="flex flex-wrap gap-3 text-xs">
                    {Object.entries(actionResult.bandwidth as Record<string, unknown>).map(([k, v]) => (
                      <span key={k} className="text-gray-400">{k}: <span className="text-neon-green">{String(v)}</span></span>
                    ))}
                  </div>
                )}
                {'recommendation' in actionResult && <p className="text-xs text-gray-300">{String(actionResult.recommendation)}</p>}
              </div>
            )}
            {'message' in actionResult && <p className="text-gray-400">{String(actionResult.message)}</p>}
          </div>
        )}
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="offline" />
          </div>
        )}
      </div>
    </div>
  );
}
