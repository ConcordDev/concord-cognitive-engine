'use client';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import {
  AlertTriangle, CheckCircle, BarChart3, GitBranch, Package, Route, Cog
} from 'lucide-react';
import {
  getLensManifests,
  getManifestCount,
  getLensesMissingMacro,
  LENS_STATUS_MAP,
  getLensStatusSummary,
  getProductLenses,
  getDeprecatedLenses,
  LENS_MERGE_GROUPS,
  getMergeReductionCount,
  POST_MERGE_STANDALONE_LENSES,
  PRODUCTIZATION_PHASES,
  getCurrentPhase,
  getTotalArtifactCount,
  getTotalEngineCount,
  WIRING_PROFILES,
  getWiringProfile,
  getCategoryIntegrationScore
} from '@/lib/lenses';
import {
  cardVariants,
  tabContentVariants,
  StatCard
} from '@/components/meta/meta-shared';

const STATUS_COLORS: Record<string, string> = {
  product: 'text-green-400 bg-green-400/10 border-green-400/30',
  hybrid: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30',
  viewer: 'text-blue-400 bg-blue-400/10 border-blue-400/30',
  system: 'text-gray-400 bg-gray-400/10 border-gray-400/30',
  deprecated: 'text-red-400 bg-red-400/10 border-red-400/30',
};

export function LensInfraPanel() {
  const [infraSection, setInfraSection] = useState<'manifests' | 'status' | 'merge' | 'roadmap' | 'wiring'>('manifests');

  const statusSummary = useMemo(() => getLensStatusSummary(), []);
  const productLenses = useMemo(() => getProductLenses(), []);
  const deprecatedLenses = useMemo(() => getDeprecatedLenses(), []);
  const missingMacro = useMemo(() => getLensesMissingMacro('create'), []);
  const currentPhase = useMemo(() => getCurrentPhase(), []);
  const mergeReduction = useMemo(() => getMergeReductionCount(), []);
  const totalArtifacts = useMemo(() => getTotalArtifactCount(), []);
  const totalEngines = useMemo(() => getTotalEngineCount(), []);
  const manifests = useMemo(() => getLensManifests(), []);
  const wiringCategories = useMemo(() => Object.keys(WIRING_PROFILES), []);

  const infraSections = [
    { key: 'manifests' as const, label: 'Manifests' },
    { key: 'status' as const, label: 'Status Taxonomy' },
    { key: 'merge' as const, label: 'Merge Map' },
    { key: 'roadmap' as const, label: 'Productization' },
    { key: 'wiring' as const, label: 'Wiring Profiles' },
  ];

  return (
    <motion.div {...tabContentVariants} transition={{ duration: 0.25 }} className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard icon={Package} label="Manifests" value={getManifestCount()} color="text-neon-purple" index={0} />
        <StatCard icon={CheckCircle} label="Product Lenses" value={productLenses.length} color="text-green-400" index={1} />
        <StatCard icon={GitBranch} label="Merge Groups" value={LENS_MERGE_GROUPS.length} color="text-neon-cyan" index={2} />
        <StatCard icon={Route} label="Total Engines" value={totalEngines} color="text-neon-blue" index={3} />
        <StatCard icon={AlertTriangle} label="Deprecated" value={deprecatedLenses.length} color="text-yellow-400" warning={deprecatedLenses.length > 0} index={4} />
      </div>

      {/* Sub-navigation */}
      <div className="flex gap-1 bg-lattice-void border border-lattice-border rounded-lg p-1 overflow-x-auto">
        {infraSections.map((sec) => (
          <button
            key={sec.key}
            onClick={() => setInfraSection(sec.key)}
            className={cn(
              'px-3 py-1.5 rounded-md text-xs font-medium transition-all whitespace-nowrap',
              infraSection === sec.key
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30'
                : 'text-gray-400 hover:text-white hover:bg-lattice-surface',
            )}
          >
            {sec.label}
          </button>
        ))}
      </div>

      {/* Manifests section */}
      {infraSection === 'manifests' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Package className="w-4 h-4 text-neon-purple" />
            Lens Manifests ({manifests.length})
          </h2>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {manifests.map((m, i) => (
              <motion.div
                key={m.domain}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-3 bg-lattice-deep rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{m.label}</p>
                  <p className="text-xs text-gray-400 font-mono">{m.domain} &middot; {m.category}</p>
                </div>
                <div className="flex gap-2 items-center">
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{m.artifacts.length} artifacts</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-blue/20 text-neon-blue">{m.actions.length} actions</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-green/20 text-neon-green">{m.exports.length} exports</span>
                </div>
              </motion.div>
            ))}
          </div>
          {missingMacro.length > 0 && (
            <div className="mt-3 p-3 border border-yellow-500/30 rounded-lg bg-yellow-500/5">
              <p className="text-xs text-yellow-400 font-semibold mb-1">Missing Macro Mappings ({missingMacro.length})</p>
              <p className="text-xs text-gray-400">{missingMacro.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {/* Status Taxonomy section */}
      {infraSection === 'status' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-neon-cyan" />
            Lens Status Taxonomy
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            {Object.entries(statusSummary).map(([status, count]) => (
              <div key={status} className={cn('p-3 rounded-lg border text-center', STATUS_COLORS[status] || 'text-gray-400 bg-gray-400/10 border-gray-400/30')}>
                <p className="text-lg font-bold">{count as number}</p>
                <p className="text-xs capitalize">{status}</p>
              </div>
            ))}
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {LENS_STATUS_MAP.map((entry, i) => (
              <motion.div
                key={entry.id}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between p-2 bg-lattice-deep rounded-lg"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('inline-block px-2 py-0.5 rounded-full text-xs border', STATUS_COLORS[entry.status] || '')}>{entry.status}</span>
                  <span className="text-sm text-gray-300 font-mono">{entry.id}</span>
                </div>
                <div className="text-xs text-gray-400 truncate max-w-[40%] text-right">
                  {entry.mergeTarget ? `-> ${entry.mergeTarget} (${entry.postMergeRole})` : 'standalone'}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Merge Map section */}
      {infraSection === 'merge' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-neon-green" />
            Lens Merge Map ({LENS_MERGE_GROUPS.length} groups, reduces by {mergeReduction.merged})
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {LENS_MERGE_GROUPS.map((group, i) => (
              <motion.div
                key={group.targetId}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-neon-green">{group.targetId}</span>
                  <span className="text-xs text-gray-400">{group.sources.length} sources merging in</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {group.sources.map((src) => (
                    <span key={src.id} className="text-xs px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                      {src.id} ({src.role})
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
          {POST_MERGE_STANDALONE_LENSES.length > 0 && (
            <div className="p-3 border border-neon-cyan/20 rounded-lg bg-neon-cyan/5">
              <p className="text-xs text-neon-cyan font-semibold mb-1">Post-Merge Standalone ({POST_MERGE_STANDALONE_LENSES.length})</p>
              <p className="text-xs text-gray-400">{POST_MERGE_STANDALONE_LENSES.join(', ')}</p>
            </div>
          )}
        </div>
      )}

      {/* Productization Roadmap section */}
      {infraSection === 'roadmap' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Route className="w-4 h-4 text-neon-blue" />
            Productization Roadmap ({PRODUCTIZATION_PHASES.length} phases, {totalArtifacts} artifacts)
          </h2>
          {currentPhase && (
            <div className="p-3 border border-neon-blue/30 rounded-lg bg-neon-blue/5 mb-3">
              <p className="text-xs text-neon-blue font-semibold">Current Phase: {currentPhase.name}</p>
              <p className="text-xs text-gray-400 mt-1">{currentPhase.rationale}</p>
            </div>
          )}
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {PRODUCTIZATION_PHASES.map((phase, i) => (
              <motion.div
                key={phase.lensId}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-white">{phase.name}</span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    phase.status === 'in_progress' ? 'bg-green-500/20 text-green-400' :
                    phase.status === 'ready' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-gray-500/20 text-gray-400'
                  )}>{phase.status}</span>
                </div>
                <p className="text-xs text-gray-400 mb-2">{phase.rationale}</p>
                <div className="flex gap-3 text-xs text-gray-400">
                  <span>{phase.pipelines.length} pipelines</span>
                  <span>{phase.engines.length} engines</span>
                  <span>{phase.artifacts.length} artifacts</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Wiring Profiles section */}
      {infraSection === 'wiring' && (
        <div className="panel p-4 space-y-3">
          <h2 className="font-semibold flex items-center gap-2">
            <Cog className="w-4 h-4 text-neon-purple" />
            Wiring Profiles ({wiringCategories.length} categories)
          </h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {wiringCategories.map((cat, i) => {
              const profile = getWiringProfile(cat);
              const score = getCategoryIntegrationScore(cat);
              return (
                <motion.div
                  key={cat}
                  custom={i}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  className="p-3 bg-lattice-deep rounded-lg border border-lattice-border"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <span className="text-sm font-semibold text-white">{profile.label}</span>
                      <span className="text-xs text-gray-400 ml-2">({cat})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">Integration:</span>
                      <span className={cn(
                        'text-xs font-mono px-2 py-0.5 rounded',
                        score >= 80 ? 'bg-green-500/20 text-green-400' :
                        score >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      )}>{score}%</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mb-2">{profile.description}</p>
                  <div className="flex flex-wrap gap-3 text-xs text-gray-400">
                    <span>{profile.enabledHooks.length}/30 hooks</span>
                    <span>Layout: {profile.defaultLayout}</span>
                    <span>Analytics: {profile.analyticsLevel}</span>
                    <span>AI: {profile.aiFeatures.join(', ') || 'none'}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
