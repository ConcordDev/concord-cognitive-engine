'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import {
  AlertTriangle
} from 'lucide-react';
import { Stat } from '@/components/command-center/cc-primitives';


export function LoafPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['cc-loaf-status'],
    queryFn: () => api.get('/api/loaf/status').then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  });

  const meta = data?.meta;
  const hyp = data?.hypothesisMarket;
  const truth = data?.truthLifecycle;
  const safety = data?.actionSafety;
  const coord = data?.collectiveAction?.health;
  const knowledge = data?.knowledgeSurvival;

  const LOAF_TIERS = meta ? [
    { tier: 'I', label: 'Hardening', modules: meta.loafI, color: 'text-red-400' },
    { tier: 'II', label: 'Cognitive OS', modules: meta.loafII, color: 'text-orange-400' },
    { tier: 'III', label: 'Civilizational', modules: meta.loafIII, color: 'text-yellow-400' },
    { tier: 'IV', label: 'Advanced Ops', modules: meta.loafIV, color: 'text-green-400' },
    { tier: 'V', label: 'Civ-Scale', modules: meta.loafV, color: 'text-teal-400' },
    { tier: 'VI', label: 'Epistemic Limits', modules: meta.loafVI, color: 'text-cyan-400' },
    { tier: 'VII', label: 'Reality-Grounded', modules: meta.loafVII, color: 'text-blue-400' },
    { tier: 'VIII', label: 'Coordination', modules: meta.loafVIII, color: 'text-indigo-400' },
    { tier: 'IX', label: 'Knowledge Survival', modules: meta.loafIX, color: 'text-purple-400' },
    { tier: 'X', label: 'Environmental', modules: meta.loafX, color: 'text-pink-400' },
  ] : [];

  if (isLoading) return <div className="h-32 bg-lattice-deep animate-pulse rounded-lg" />;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">LOAF System</h3>

      {/* Meta status */}
      {meta && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Version" value={`v${meta.version || '?'}`} />
          <Stat label="Modules" value={meta.moduleCount ?? 0} />
          <Stat label="Status" value={meta.initialized ? 'Active' : 'Down'} />
        </div>
      )}

      {/* Hypothesis Market */}
      {hyp?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-amber-400">Hypothesis Market</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total" value={hyp.totalHypotheses ?? 0} />
            <Stat label="Proposed" value={hyp.byState?.proposed ?? 0} />
            <Stat label="Challenged" value={hyp.byState?.challenged ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Defended: {hyp.byState?.defended ?? 0}</span>
            <span>Resolved True: {hyp.byState?.resolved_true ?? 0}</span>
            <span>Resolved False: {hyp.byState?.resolved_false ?? 0}</span>
            <span>Red Teams: {hyp.redTeamChallenges ?? 0}</span>
          </div>
        </div>
      )}

      {/* Truth Lifecycle */}
      {truth?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-teal-400">Truth Lifecycle</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Total Truths" value={truth.totalTruths ?? 0} />
            <Stat label="Rollbacks" value={truth.rollbackCount ?? 0} />
            <Stat label="Stabilized" value={truth.byState?.stabilized ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Born: {truth.byState?.born ?? 0}</span>
            <span>Challenged: {truth.byState?.challenged ?? 0}</span>
            <span>Decaying: {truth.byState?.decaying ?? 0}</span>
            <span>Dead: {truth.byState?.dead ?? 0}</span>
          </div>
        </div>
      )}

      {/* Action Safety */}
      {safety?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-red-400">Action Safety</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Envelopes" value={safety.envelopes ?? 0} />
            <Stat label="Decisions" value={safety.decisions ?? 0} />
            <Stat label="Experiments" value={safety.experiments ?? 0} />
          </div>
          <div className="flex gap-3 text-[10px] text-gray-400">
            <span>Throttles: {safety.throttles ?? 0}</span>
            <span>Abstention Rules: {safety.abstentionRules ?? 0}</span>
          </div>
        </div>
      )}

      {/* Collective Action */}
      {coord && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-indigo-400">Collective Action</p>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Coalitions" value={coord.activeCoalitions ?? 0} />
            <Stat label="Commitments" value={coord.activeCommitments ?? 0} />
            <Stat label="Evidence Pools" value={coord.evidencePools ?? 0} />
          </div>
          {(coord.breachedCommitments ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[10px] text-red-400">
              <AlertTriangle className="w-3 h-3" /> {coord.breachedCommitments} breached commitments
            </div>
          )}
        </div>
      )}

      {/* Knowledge Survival */}
      {knowledge?.ok && (
        <div className="bg-lattice-surface rounded-lg p-3 border border-lattice-border space-y-2">
          <p className="text-xs font-semibold text-purple-400">Knowledge Survival</p>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="At Risk" value={knowledge.atRisk?.length ?? 0} />
            <Stat label="Total Scanned" value={knowledge.totalScanned ?? 0} />
          </div>
          {(knowledge.atRisk?.length ?? 0) > 0 && (
            <div className="space-y-1">
              {(knowledge.atRisk as Array<{ id: string; priority?: string }>)?.slice(0, 5).map((k: { id: string; priority?: string }) => (
                <div key={k.id} className="text-[10px] text-yellow-300 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" /> {k.id} <span className="text-gray-400">{k.priority}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* LOAF Tier summary cards */}
      {LOAF_TIERS.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400">Tier Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {LOAF_TIERS.map(t => (
              <div key={t.tier} className="bg-lattice-deep rounded p-2 border border-lattice-border text-center">
                <p className={`text-xs font-bold ${t.color}`}>LOAF {t.tier}</p>
                <p className="text-[10px] text-gray-400">{t.label}</p>
                <p className="text-sm font-mono text-white">{t.modules?.length ?? 0}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
