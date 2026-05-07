'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useQuery } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dna, Activity, Heart, Brain, Microscope, Layers, ChevronDown, AlertTriangle, Bug, Zap, Loader2, Plus, Trash2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface BioMetric {
  name: string;
  value: number;
}

interface GrowthOrgan {
  name: string;
  active: boolean;
  lastActivation?: string;
}

export default function BioLensPage() {
  useLensNav('bio');

  const [selectedSystem, setSelectedSystem] = useState('homeostasis');
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<'organisms' | 'experiments' | 'sequences'>('organisms');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('bio');

  const { items: bioItems, isLoading, isError: isError, error: error, refetch: refetch, create, update, remove } = useLensData<Record<string, unknown>>('bio', 'system', { seed: [] });
  const bioData = useMemo(() => {
    if (!bioItems.length) return undefined;
    // Reconstruct the shape that templates expect from the raw API response
    const result: Record<string, unknown> = {};
    for (const item of bioItems) {
      const d = item.data as Record<string, unknown> | undefined;
      if (d) Object.assign(result, d);
    }
    return result as Record<string, unknown>;
  }, [bioItems]);
  const runAction = useRunArtifact('bio');

  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback((artifactId: string) => {
    setActionError(null);
    runAction.mutate(
      { id: artifactId, action: 'analyze' },
      {
        onError: (e) => {
          console.error('Action failed:', e);
          setActionError(`Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
        },
      }
    );
  }, [runAction]);

  const handleSave = useCallback((id: string, data: Record<string, unknown>) => {
    update(id, { data });
  }, [update]);

  const handleCreate = useCallback(() => {
    create({ title: 'New Organism', data: { type: 'organism' } });
  }, [create]);

  const handleRemove = useCallback((id: string) => {
    remove(id);
  }, [remove]);

  const { data: growthData, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['growth-status'],
    queryFn: () => apiHelpers.status.get().then((r) => r.data),
  });

  const systems = [
    { id: 'homeostasis', name: 'Homeostasis', icon: Heart, color: 'text-neon-pink' },
    { id: 'metabolism', name: 'Metabolism', icon: Activity, color: 'text-neon-green' },
    { id: 'neural', name: 'Neural Network', icon: Brain, color: 'text-neon-purple' },
    { id: 'genetic', name: 'Genetic Memory', icon: Dna, color: 'text-neon-blue' },
  ];


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-pink border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="bio" className="p-6 space-y-6">
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          Not medical advice. This lens provides biological modeling tools for educational and research purposes only. Consult qualified professionals for health decisions.
        </p>
      </div>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🧬</span>
          <div>
            <h1 className="text-xl font-bold">Bio Lens</h1>
            {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-neon-pink" />}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <p className="text-sm text-gray-400">
              Biological system simulation and Growth OS metrics
            </p>
          </div>
        </div>
      </header>

      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300 ml-2">&times;</button>
        </div>
      )}

      <RealtimeDataPanel domain="bio" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="bio" artifactId={null} compact />
      <DTUExportButton domain="bio" data={{}} compact />

      {/* CRUD Actions */}
      <div className="flex items-center gap-2">
        <button onClick={handleCreate} className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-green/20 text-neon-green rounded-lg text-sm hover:bg-neon-green/30">
          <Plus className="w-4 h-4" /> Add Organism
        </button>
      </div>

      {/* Bio Items */}
      {bioItems.length > 0 && (
        <div className="space-y-2">
          {bioItems.map(item => (
            <div key={item.id} className="panel p-3 flex items-center justify-between">
              <span className="text-sm font-medium">{item.title}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => handleAction(item.id)} className="text-gray-500 hover:text-neon-cyan" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                <button onClick={() => handleSave(item.id, { ...(item.data || {}), lastReviewed: new Date().toISOString() })} className="text-gray-500 hover:text-neon-blue" title="Update"><Activity className="w-4 h-4" /></button>
                <button onClick={() => handleRemove(item.id)} className="text-gray-500 hover:text-red-400" title="Delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Microscope, label: 'Bio Age', value: growthData?.bioAge || '0.00', color: 'text-neon-cyan' },
          { icon: Dna, label: 'Maturation', value: `${((growthData?.maturationLevel || 0) * 100).toFixed(1)}%`, color: 'text-neon-purple' },
          { icon: Bug, label: 'Organisms', value: String(bioItems.length), color: 'text-neon-green' },
          { icon: Activity, label: 'Active Organs', value: String(growthData?.organs?.filter((o: GrowthOrgan) => o.active).length || 0), color: 'text-neon-pink' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="lens-card text-center">
            <stat.icon className={`w-6 h-6 mx-auto mb-2 ${stat.color}`} />
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-black/30 border border-white/10 rounded-lg p-1">
        {([
          { key: 'organisms' as const, label: 'Organisms', icon: Bug },
          { key: 'experiments' as const, label: 'Experiments', icon: Microscope },
          { key: 'sequences' as const, label: 'Sequences', icon: Dna },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.key ? 'bg-neon-purple/20 text-neon-purple' : 'text-gray-500 hover:text-white'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {activeTab === 'organisms' && (
        <motion.div key="organisms" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {/* Bio Age Display */}
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="panel p-6 text-center">
        <Microscope className="w-12 h-12 mx-auto text-neon-cyan mb-4" />
        <p className="text-sm text-gray-400 mb-2">System Biological Age</p>
        <p className="text-5xl font-bold text-gradient-neon">
          {growthData?.bioAge || '0.00'}
        </p>
        <p className="text-sm text-gray-400 mt-2">
          Maturation: {((growthData?.maturationLevel || 0) * 100).toFixed(1)}%
        </p>
      </motion.div>

      {/* Organism Taxonomy Tree */}
      <div className="panel p-4 mt-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Bug className="w-4 h-4 text-neon-green" /> Taxonomy Classification</h3>
        <div className="space-y-1">
          {[
            { level: 'Domain', name: 'Eukarya', indent: 0 },
            { level: 'Kingdom', name: 'Animalia', indent: 1 },
            { level: 'Phylum', name: 'Chordata', indent: 2 },
            { level: 'Class', name: 'Mammalia', indent: 3 },
            { level: 'Order', name: 'Primates', indent: 4 },
            { level: 'Family', name: 'Hominidae', indent: 5 },
            { level: 'Genus', name: 'Homo', indent: 6 },
            { level: 'Species', name: 'H. sapiens', indent: 7 },
          ].map((tax, i) => (
            <motion.div key={tax.level} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }}
              className="flex items-center gap-2 py-1" style={{ paddingLeft: `${tax.indent * 16 + 8}px` }}>
              <div className="w-1.5 h-1.5 rounded-full bg-neon-green/50" />
              <span className="text-xs text-gray-500 w-16">{tax.level}</span>
              <span className="text-sm text-gray-300 font-mono">{tax.name}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* System Selector */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
        {systems.map((system, i) => {
          const Icon = system.icon;
          return (
            <motion.button
              key={system.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              onClick={() => setSelectedSystem(system.id)}
              className={`lens-card text-center ${
                selectedSystem === system.id ? 'border-neon-cyan glow-blue' : ''
              }`}
            >
              <Icon className={`w-8 h-8 mx-auto mb-2 ${system.color}`} />
              <p className="font-medium text-sm">{system.name}</p>
            </motion.button>
          );
        })}
      </div>
        </motion.div>
      )}

      {activeTab === 'experiments' && (
        <motion.div key="experiments" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Microscope className="w-4 h-4 text-neon-cyan" /> Active Experiments</h3>
          <div className="space-y-2">
            {['Gene Expression Analysis', 'Protein Folding Simulation', 'Cell Growth Assay', 'Metabolic Pathway Mapping'].map((exp, i) => (
              <motion.div key={exp} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-neon-green" />
                  <span className="text-sm text-gray-300">{exp}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded ${i === 0 ? 'bg-neon-green/20 text-neon-green' : i === 3 ? 'bg-gray-500/20 text-gray-400' : 'bg-neon-blue/20 text-neon-blue'}`}>
                  {i === 0 ? 'Running' : i === 3 ? 'Queued' : 'In Progress'}
                </span>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {activeTab === 'sequences' && (
        <motion.div key="sequences" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Dna className="w-4 h-4 text-neon-purple" /> DNA Sequence Viewer</h3>
          <div className="bg-black/30 rounded-lg p-4 font-mono text-xs leading-relaxed overflow-x-auto">
            <div className="flex flex-wrap gap-x-1">
              {'ATGCGTACGTTAACGGCTATGCAGTACGCTTAAGCGTACG'.split('').map((base, i) => {
                const colors: Record<string, string> = { A: 'text-green-400', T: 'text-red-400', G: 'text-amber-400', C: 'text-blue-400' };
                return (
                  <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className={colors[base] || 'text-gray-400'}>
                    {base}
                  </motion.span>
                );
              })}
            </div>
            <div className="mt-3 flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Adenine (A)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" /> Thymine (T)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> Guanine (G)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Cytosine (C)</span>
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* System Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Metrics */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-neon-green" />
            {systems.find((s) => s.id === selectedSystem)?.name} Metrics
          </h3>

          {(bioData?.systems as Record<string, { metrics?: BioMetric[] }>)?.[selectedSystem]?.metrics?.map((metric: BioMetric) => (
            <div key={metric.name} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">{metric.name}</span>
                <span className="font-mono">{(metric.value ?? 0).toFixed(2)}</span>
              </div>
              <div className="h-2 bg-lattice-deep rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-neon-blue to-neon-cyan rounded-full transition-all"
                  style={{ width: `${Math.min(100, metric.value * 100)}%` }}
                />
              </div>
            </div>
          ))}

          {!(bioData?.systems as Record<string, { metrics?: BioMetric[] }>)?.[selectedSystem]?.metrics && (
            <p className="text-gray-500 text-center py-4">
              Loading system metrics...
            </p>
          )}
        </div>

        {/* Growth Organs */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Dna className="w-4 h-4 text-neon-purple" />
            Active Growth Organs
          </h3>

          <div className="space-y-2">
            {growthData?.organs?.map((organ: GrowthOrgan) => (
              <div
                key={organ.name}
                className={`lens-card ${
                  organ.active ? 'border-neon-green/50' : 'opacity-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{organ.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      organ.active
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {organ.active ? 'Active' : 'Dormant'}
                  </span>
                </div>
                {organ.lastActivation && (
                  <p className="text-xs text-gray-400 mt-1">
                    Last: {new Date(organ.lastActivation).toLocaleString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Homeostasis Indicators */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Heart className="w-4 h-4 text-neon-pink" />
          Homeostasis Balance
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { name: 'Energy', value: (bioData?.homeostasis as Record<string, number>)?.energy || 0.85 },
            { name: 'Coherence', value: (bioData?.homeostasis as Record<string, number>)?.coherence || 0.92 },
            { name: 'Stability', value: (bioData?.homeostasis as Record<string, number>)?.stability || 0.78 },
            { name: 'Adaptation', value: (bioData?.homeostasis as Record<string, number>)?.adaptation || 0.88 },
          ].map((indicator) => (
            <div key={indicator.name} className="lens-card text-center">
              <p className="text-3xl font-bold text-neon-cyan">
                {(indicator.value * 100).toFixed(0)}%
              </p>
              <p className="text-sm text-gray-400 mt-1">{indicator.name}</p>
            </div>
          ))}
        </div>
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
            <LensFeaturePanel lensId="bio" />
          </div>
        )}
      </div>
    </div>
  );
}
