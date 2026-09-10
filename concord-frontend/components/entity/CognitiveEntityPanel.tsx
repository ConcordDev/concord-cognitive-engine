'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { Cpu, X } from 'lucide-react';

interface CognitiveState {
  ok: boolean;
  entityId: string;
  wants: Array<{ id: string; type: string; domain: string; intensity: number; status: string; description?: string }>;
  trustNetwork: { trusts: Array<{ emergentId: string; name: string; trust: number }>; trustedBy: Array<{ emergentId: string; name: string; trust: number }> };
  culture: { fit: { score?: number; traditions?: number } | null; traditions: Array<{ id: string; name?: string; type: string; status: string }> };
  pain: { state: { totalPain?: number; recentEvents?: number } | null; avoidances: Array<{ id?: string; source: string; strength: number }>; wounds: Array<{ id?: string; type: string; severity: number }> };
  subjectiveTime: { experientialHours?: number; experientialDays?: number; compressionRatio?: number; currentEpoch?: string; ticks?: number; cycles?: number } | null;
  sleep: { state: { status?: string; fatigue?: number; dreamContent?: string } | null; recentHistory: Array<{ status: string; startedAt?: string }> };
  vulnerability: { available: boolean } | null;
}

export function CognitiveEntityPanel({ entityId, entityName, onClose }: { entityId: string; entityName: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<CognitiveState>({
    queryKey: ['entity-cognitive', entityId],
    queryFn: () => api.get(`/api/entity/${entityId}/cognitive`).then(r => r.data),
    refetchInterval: 10000,
  });

  return (
    <div data-lens-theme="entity" className="panel p-4 space-y-4 border-2 border-neon-cyan mt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <Cpu className="w-4 h-4 text-neon-cyan" />
          Cognitive Systems: {entityName}
        </h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-8 text-zinc-400 text-sm">Loading cognitive state...</div>
      )}

      {data && (
        <div className="space-y-4 text-sm">

          {/* Current Wants (Want Engine) */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Current Wants</p>
            {data.wants && data.wants.length > 0 ? (
              <div className="space-y-1">
                {data.wants.slice(0, 8).map(w => (
                  <div key={w.id} className="flex items-center gap-2 text-xs bg-zinc-900 rounded p-2 border border-zinc-800">
                    <span className="text-neon-cyan capitalize font-medium">{w.type}</span>
                    <span className="text-gray-400 flex-1 truncate">{w.domain}{w.description ? ` — ${w.description}` : ''}</span>
                    <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-neon-cyan rounded-full" style={{ width: `${Math.round(w.intensity * 100)}%` }} />
                    </div>
                    <span className="text-gray-400 tabular-nums w-8 text-right">{Math.round(w.intensity * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No active wants</p>
            )}
          </div>

          {/* Trust Network */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Trust Network</p>
            {data.trustNetwork?.trusts?.length > 0 || data.trustNetwork?.trustedBy?.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-gray-400 mb-1">Trusts ({data.trustNetwork.trusts?.length || 0})</p>
                  {(data.trustNetwork.trusts || []).slice(0, 5).map(t => (
                    <div key={t.emergentId} className="flex items-center gap-1 text-[11px] text-gray-400">
                      <span className="truncate flex-1">{t.name}</span>
                      <span className={`tabular-nums ${t.trust > 0.7 ? 'text-green-400' : t.trust < 0.3 ? 'text-red-400' : 'text-gray-400'}`}>
                        {(t.trust * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 mb-1">Trusted By ({data.trustNetwork.trustedBy?.length || 0})</p>
                  {(data.trustNetwork.trustedBy || []).slice(0, 5).map(t => (
                    <div key={t.emergentId} className="flex items-center gap-1 text-[11px] text-gray-400">
                      <span className="truncate flex-1">{t.name}</span>
                      <span className={`tabular-nums ${t.trust > 0.7 ? 'text-green-400' : t.trust < 0.3 ? 'text-red-400' : 'text-gray-400'}`}>
                        {(t.trust * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No trust relationships established</p>
            )}
          </div>

          {/* Cultural Affiliations */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Cultural Affiliations</p>
            {data.culture?.fit ? (
              <div className="text-xs text-gray-400">
                <span>Cultural fit: {data.culture.fit.score != null ? `${Math.round((data.culture.fit.score as number) * 100)}%` : 'calculating'}</span>
                {data.culture.traditions?.length > 0 && (
                  <span className="ml-3">{data.culture.traditions.length} tradition{data.culture.traditions.length !== 1 ? 's' : ''} active</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No cultural data</p>
            )}
          </div>

          {/* Pain Memories */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Pain Memories</p>
            {data.pain?.avoidances?.length > 0 || data.pain?.wounds?.length > 0 ? (
              <div className="space-y-1">
                {data.pain.wounds?.slice(0, 5).map((w, i) => (
                  <div key={w.id || i} className="flex items-center gap-2 text-[11px] bg-red-950/20 rounded p-1.5 border border-red-900/20">
                    <span className="text-red-400 font-medium">{w.type}</span>
                    <span className="text-gray-400 ml-auto tabular-nums">severity {w.severity}</span>
                  </div>
                ))}
                {data.pain.avoidances?.slice(0, 5).map((a, i) => (
                  <div key={a.id || i} className="flex items-center gap-2 text-[11px] text-gray-400">
                    <span className="text-amber-400">avoids:</span>
                    <span className="truncate flex-1">{a.source}</span>
                    <span className="text-gray-600 tabular-nums">{Math.round(a.strength * 100)}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No pain memories</p>
            )}
          </div>

          {/* Subjective Time */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Subjective Time</p>
            {data.subjectiveTime ? (
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-400">Exp. Days</p>
                  <p className="text-white font-mono">{data.subjectiveTime.experientialDays ?? '—'}</p>
                </div>
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-400">Compression</p>
                  <p className="text-white font-mono">{data.subjectiveTime.compressionRatio ?? '—'}x</p>
                </div>
                <div className="bg-zinc-900 rounded p-2 border border-zinc-800">
                  <p className="text-gray-400">Epoch</p>
                  <p className="text-white font-mono capitalize">{data.subjectiveTime.currentEpoch ?? '—'}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No time data</p>
            )}
          </div>

          {/* Sleep Status */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase">Sleep Status</p>
            {data.sleep?.state ? (
              <div className="text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`w-2 h-2 rounded-full ${
                    data.sleep.state.status === 'awake' ? 'bg-green-400' :
                    data.sleep.state.status === 'rem' ? 'bg-purple-400' :
                    data.sleep.state.status === 'sleeping' ? 'bg-blue-400' :
                    'bg-yellow-400'
                  }`} />
                  <span className="text-gray-300 capitalize">{data.sleep.state.status || 'unknown'}</span>
                  {data.sleep.state.fatigue != null && (
                    <span className="text-gray-400 ml-auto">fatigue: {Math.round(data.sleep.state.fatigue * 100)}%</span>
                  )}
                </div>
                {data.sleep.state.dreamContent && (
                  <div className="bg-purple-950/20 rounded p-2 border border-purple-900/20 text-purple-300 text-[11px] italic">
                    Dream: {data.sleep.state.dreamContent}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-400">No sleep data</p>
            )}
          </div>

          {/* Vulnerability State */}
          {data.vulnerability && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-400 uppercase">Vulnerability Engine</p>
              <p className="text-xs text-gray-400">Adaptive delivery engine active — adjusts response tone based on detected emotional state</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

