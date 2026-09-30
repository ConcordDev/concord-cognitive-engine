'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, api } from '@/lib/api/client';
import {
  Users, Zap
} from 'lucide-react';


export function PromotionPanel() {
  const { data } = useQuery({ queryKey: ['cc-promotions'], queryFn: () => apiHelpers.promotion.queue().then(r => r.data), refetchInterval: 30000 });
  const { data: shadowData } = useQuery({ queryKey: ['cc-shadow-pending'], queryFn: () => api.get('/api/dtus/shadow/pending').then(r => r.data), refetchInterval: 30000 });
  const qc = useQueryClient();
  const approveMutation = useMutation({ mutationFn: (id: string) => apiHelpers.promotion.approve(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-promotions'] }), onError: (err) => console.error('Promotion approval failed:', err instanceof Error ? err.message : err) });
  const rejectMutation = useMutation({ mutationFn: (id: string) => apiHelpers.promotion.reject(id, 'Rejected from command center'), onSuccess: () => qc.invalidateQueries({ queryKey: ['cc-promotions'] }), onError: (err) => console.error('Promotion rejection failed:', err instanceof Error ? err.message : err) });
  const promoteShadowMutation = useMutation({
    mutationFn: (id: string) => api.post(`/api/dtus/${id}/promote`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cc-shadow-pending'] }); qc.invalidateQueries({ queryKey: ['cc-health'] }); },
    onError: (err) => console.error('Shadow promotion failed:', err instanceof Error ? err.message : err),
  });

  const queue = (data?.queue || []) as Array<{ id: string; artifactName?: string; fromStage: string; toStage: string; status: string; requestedAt: string }>;
  const shadowCandidates = (shadowData?.candidates || []) as Array<{ dtuId: string; title: string; momentum: number; richness: number; uniqueUsers: number; interactionCount: number }>;
  const pendingShadows = (shadowData?.pendingShadows || []) as Array<{ id: string; title: string; tier: string; kind: string; richness: number; ttlDays: number; tags: string[]; createdAt: string }>;
  const totalShadows = shadowData?.totalShadows ?? 0;

  return (
    <div className="space-y-6">
      {/* Shadow DTU Promotion Queue */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">Shadow DTU Promotion</h3>
          <span className="text-xs text-gray-400">{totalShadows} total shadows</span>
        </div>

        {/* Momentum-based candidates (auto-detected via interactions) */}
        {shadowCandidates.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-neon-green font-semibold flex items-center gap-1"><Zap className="w-3 h-3" /> Promotion Candidates ({shadowCandidates.length})</p>
            {shadowCandidates.map(c => (
              <div key={c.dtuId} className="bg-lattice-surface rounded-lg p-3 border border-neon-green/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium truncate flex-1">{c.title}</span>
                  <span className="text-[10px] bg-purple-500/20 text-purple-300 px-1.5 py-0.5 rounded border border-purple-500/30 ml-2">shadow</span>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-400 mb-2">
                  <span>Momentum: {c.momentum}</span>
                  <span>Richness: {c.richness}</span>
                  <span>Users: {c.uniqueUsers}</span>
                  <span>Interactions: {c.interactionCount}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => promoteShadowMutation.mutate(c.dtuId)} disabled={promoteShadowMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Promote to Regular</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Rich shadows pending review */}
        {pendingShadows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold">Rich Shadows ({pendingShadows.length})</p>
            {pendingShadows.slice(0, 10).map(s => (
              <div key={s.id} className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium truncate flex-1">{s.title}</span>
                  <span className="text-[10px] bg-gray-500/20 text-gray-400 px-1.5 py-0.5 rounded">{s.kind || 'shadow'}</span>
                </div>
                <div className="flex gap-3 text-[10px] text-gray-400 mb-2">
                  <span>Richness: {s.richness}</span>
                  <span>TTL: {s.ttlDays}d</span>
                  {s.createdAt && <span>Created: {new Date(s.createdAt).toLocaleDateString()}</span>}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => promoteShadowMutation.mutate(s.id)} disabled={promoteShadowMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Promote</button>
                </div>
              </div>
            ))}
            {pendingShadows.length > 10 && <p className="text-xs text-gray-400 text-center">+ {pendingShadows.length - 10} more</p>}
          </div>
        )}

        {shadowCandidates.length === 0 && pendingShadows.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-3">No shadow DTUs ready for promotion</p>
        )}
      </div>

      {/* General Promotion Pipeline */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">General Promotion Pipeline</h3>
        <div className="space-y-2">
          {queue.length === 0 && <p className="text-xs text-gray-400 text-center py-3">No pending promotions</p>}
          {queue.map(p => (
            <div key={p.id} className="bg-lattice-surface rounded-lg p-3 border border-lattice-border">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-white font-medium">{p.artifactName || p.id}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${p.status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' : p.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                  {p.status}
                </span>
              </div>
              <p className="text-xs text-gray-400">{p.fromStage} → {p.toStage}</p>
              <p className="text-[10px] text-gray-400">{new Date(p.requestedAt).toLocaleString()}</p>
              {p.status === 'pending' && (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => approveMutation.mutate(p.id)} disabled={approveMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 disabled:opacity-50">Approve</button>
                  <button onClick={() => rejectMutation.mutate(p.id)} disabled={rejectMutation.isPending} className="flex-1 text-xs px-2 py-1.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 disabled:opacity-50">Reject</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
