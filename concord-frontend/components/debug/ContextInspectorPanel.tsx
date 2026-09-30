'use client';

/**
 * ContextInspectorPanel — guidance.inspect entity/DTU/artifact inspector.
 */
import { useQuery } from '@tanstack/react-query';
import { Eye, Database } from 'lucide-react';
import { api } from '@/lib/api/client';

export function ContextInspectorPanel() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['context-inspector'],
    queryFn: () =>
      api
        .get('/api/context/inspector')
        .then((r) => r.data)
        .catch(() => null),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="panel p-4 text-center text-gray-400 text-sm">
        Loading context engine state...
      </div>
    );
  }

  const ws = data?.workingSet;
  const pinned = data?.pinnedDtus || [];
  const coPatterns = data?.coActivationPatterns || [];
  const userProfiles = data?.userProfiles || [];
  const engine = data?.engine || {};
  const metrics = data?.metrics || {};

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Eye className="w-4 h-4 text-neon-cyan" />
          Context Inspector
        </h2>
        <button onClick={() => refetch()} className="text-xs text-neon-cyan hover:underline">
          Refresh
        </button>
      </div>

      {/* Working Set Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-400">Working Set Size</p>
          <p className="text-lg font-mono text-neon-blue">{ws?.totalSize ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-400">Active Sessions</p>
          <p className="text-lg font-mono text-neon-green">{engine.activeSessions ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-400">User Profiles</p>
          <p className="text-lg font-mono text-neon-purple">{engine.userProfileCount ?? 0}</p>
        </div>
        <div className="bg-lattice-deep p-3 rounded-lg">
          <p className="text-xs text-gray-400">Queries Processed</p>
          <p className="text-lg font-mono text-gray-300">{metrics.queriesProcessed ?? 0}</p>
        </div>
      </div>

      {/* Pinned DTUs */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          Pinned DTUs ({pinned.length})
        </p>
        {pinned.length === 0 ? (
          <p className="text-xs text-gray-400">No pinned DTUs in active sessions</p>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-1">
            {pinned.map(
              (p: { dtuId: string; title: string; score: number; session: string }, i: number) => (
                <div
                  key={`${p.dtuId}-${i}`}
                  className="flex items-center gap-2 text-xs bg-lattice-deep rounded p-2 border border-lattice-border"
                >
                  <Database className="w-3 h-3 text-neon-cyan shrink-0" />
                  <span className="text-white truncate flex-1">{p.title}</span>
                  <span className="text-gray-400 font-mono shrink-0">{p.score}</span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Co-Activation Patterns */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          Co-Activation Patterns ({coPatterns.length})
        </p>
        {coPatterns.length === 0 ? (
          <p className="text-xs text-gray-400">No active co-activation tracking</p>
        ) : (
          <div className="max-h-32 overflow-y-auto space-y-1">
            {coPatterns.map(
              (cp: { sessionId: string; trackedDtus: number; queryCount: number }, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between text-xs bg-lattice-deep rounded p-2 border border-lattice-border"
                >
                  <span className="text-gray-300 font-mono truncate">
                    {cp.sessionId.slice(0, 20)}
                  </span>
                  <span className="text-gray-400">
                    {cp.trackedDtus} DTUs / {cp.queryCount} queries
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* User Profile Weights */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">
          User Profile Weights ({userProfiles.length})
        </p>
        {userProfiles.length === 0 ? (
          <p className="text-xs text-gray-400">No user profiles tracked yet</p>
        ) : (
          <div className="max-h-48 overflow-y-auto space-y-2">
            {userProfiles.map(
              (
                up: {
                  userId: string;
                  topDtuCount: number;
                  sessionCount: number;
                  lastSession: string;
                  topDtus: Array<{ dtuId: string; frequency: number; title: string }>;
                },
                i: number
              ) => (
                <div
                  key={i}
                  className="bg-lattice-deep rounded-lg p-2 border border-lattice-border"
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-gray-300 font-mono">{up.userId.slice(0, 20)}</span>
                    <span className="text-gray-400">{up.sessionCount} sessions</span>
                  </div>
                  {up.topDtus.length > 0 && (
                    <div className="space-y-0.5">
                      {up.topDtus.map((td, j) => (
                        <div key={j} className="flex items-center gap-2 text-[10px]">
                          <span className="text-gray-400 truncate flex-1">{td.title}</span>
                          <span className="text-gray-600 font-mono shrink-0">{td.frequency}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Engine Metrics Summary */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase">Engine Metrics</p>
        <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-gray-400">Co-activation edges proposed: </span>
            <span className="text-white font-mono">{metrics.coActivationEdgesProposed ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-400">Profile seeds: </span>
            <span className="text-white font-mono">{metrics.profileSeeds ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-400">Panel queries: </span>
            <span className="text-white font-mono">{metrics.contextPanelQueries ?? 0}</span>
          </div>
          <div>
            <span className="text-gray-400">Shadow DTUs: </span>
            <span className="text-white font-mono">{engine.shadowDtuCount ?? 0}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

