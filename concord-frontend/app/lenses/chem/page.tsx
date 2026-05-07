'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Atom, Beaker, FlaskConical, Sparkles, Zap, Layers, ChevronDown, AlertTriangle, TestTube2, Loader2, XCircle, BarChart3 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';

interface Compound {
  id: string;
  name: string;
  formula: string;
  type: 'catalyst' | 'reagent' | 'product';
  stability: number;
}

interface Reaction {
  id: string;
  formula: string;
  timestamp: string;
  success: boolean;
}

export default function ChemLensPage() {
  useLensNav('chem');

  const [selectedCompound, setSelectedCompound] = useState<string | null>(null);
  const [reactionInput, setReactionInput] = useState('');
  const [showFeatures, setShowFeatures] = useState(true);
  const [activeTab, setActiveTab] = useState<'elements' | 'reactions' | 'compounds'>('reactions');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('chem');

  // Backend action wiring
  const runAction = useRunArtifact('chem');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const { items: compoundItems, isLoading, isError: isError, error: error, refetch: refetch } = useLensData<Record<string, unknown>>('chem', 'compound', { seed: [] });
  const compounds = compoundItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Compound[];

  const { items: reactionItems, isError: isError2, error: error2, refetch: refetch2, create: createReaction } = useLensData<Record<string, unknown>>('chem', 'reaction', { seed: [] });
  const reactions = reactionItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Reaction[];

  const runReaction = useMutation({
    mutationFn: (formula: string) => createReaction({ title: formula, data: { formula, ranAt: new Date().toISOString() } }),
    onSuccess: () => {
      refetch();
      refetch2();
      setReactionInput('');
    },
    onError: (err) => console.error('runReaction failed:', err instanceof Error ? err.message : err),
  });

  const typeColors = {
    catalyst: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30',
    reagent: 'bg-neon-blue/20 text-neon-blue border-neon-blue/30',
    product: 'bg-neon-green/20 text-neon-green border-neon-green/30',
  };

  const handleChemAction = async (action: string) => {
    const targetId = compoundItems[0]?.id || reactionItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) {
      console.error(`Chem action ${action} failed:`, e);
    }
    setIsRunning(null);
  };

  if (isLoading) {
    return (
      <div data-lens-theme="chem" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading lab results...</p>
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
    <div data-lens-theme="chem" className="p-6 space-y-6">
      {/* Sub-Lenses */}
      <SubLensQuickNav lensId="chem" />

      {/* Safety Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-200">
          For educational and research modeling only. Do not use simulated results for actual chemical handling. Always follow laboratory safety protocols and consult qualified chemists.
        </p>
      </div>
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">⚗️</span>
          <div>
            <h1 className="text-xl font-bold">Chem Lens</h1>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            <p className="text-sm text-gray-400">
              Chemical reaction simulation and compound synthesis
            </p>
          </div>
        </div>
      </header>


      <RealtimeDataPanel domain="chem" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <DTUExportButton domain="chem" data={{}} compact />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: Atom, label: 'Compounds', value: String(compounds.length), color: 'text-neon-blue' },
          { icon: FlaskConical, label: 'Reactions', value: String(reactions.length), color: 'text-neon-purple' },
          { icon: Beaker, label: 'Success Rate', value: reactions.length > 0 ? `${Math.round((reactions.filter(r => r.success).length / reactions.length) * 100)}%` : '0%', color: 'text-neon-green' },
          { icon: TestTube2, label: 'Catalysts', value: String(compounds.filter(c => c.type === 'catalyst').length), color: 'text-neon-cyan' },
        ].map((stat, i) => (
          <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="lens-card text-center">
            <stat.icon className={`w-5 h-5 mx-auto mb-2 ${stat.color}`} />
            <p className={`text-2xl font-bold ${stat.color}`}>{stat.value}</p>
            <p className="text-xs text-gray-400 mt-1">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-black/30 border border-white/10 rounded-lg p-1">
        {([
          { key: 'elements' as const, label: 'Elements', icon: Atom },
          { key: 'reactions' as const, label: 'Reactions', icon: FlaskConical },
          { key: 'compounds' as const, label: 'Compounds', icon: Beaker },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors flex-1 justify-center ${
              activeTab === tab.key ? 'bg-teal-500/20 text-teal-400' : 'text-gray-500 hover:text-white'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      {/* AI Actions */}
      <UniversalActions domain="chem" artifactId={compoundItems[0]?.id} compact />

      <AnimatePresence mode="wait">
      {activeTab === 'elements' && (
        <motion.div key="elements" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
          {/* Mini Periodic Table Reference */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Atom className="w-4 h-4 text-neon-blue" /> Periodic Table Quick Reference</h3>
            <div className="grid grid-cols-6 md:grid-cols-9 gap-1">
              {[
                { sym: 'H', num: 1, name: 'Hydrogen', cat: 'nonmetal' },
                { sym: 'He', num: 2, name: 'Helium', cat: 'noble' },
                { sym: 'Li', num: 3, name: 'Lithium', cat: 'alkali' },
                { sym: 'Be', num: 4, name: 'Beryllium', cat: 'alkaline' },
                { sym: 'B', num: 5, name: 'Boron', cat: 'metalloid' },
                { sym: 'C', num: 6, name: 'Carbon', cat: 'nonmetal' },
                { sym: 'N', num: 7, name: 'Nitrogen', cat: 'nonmetal' },
                { sym: 'O', num: 8, name: 'Oxygen', cat: 'nonmetal' },
                { sym: 'F', num: 9, name: 'Fluorine', cat: 'halogen' },
                { sym: 'Ne', num: 10, name: 'Neon', cat: 'noble' },
                { sym: 'Na', num: 11, name: 'Sodium', cat: 'alkali' },
                { sym: 'Mg', num: 12, name: 'Magnesium', cat: 'alkaline' },
                { sym: 'Al', num: 13, name: 'Aluminum', cat: 'metal' },
                { sym: 'Si', num: 14, name: 'Silicon', cat: 'metalloid' },
                { sym: 'P', num: 15, name: 'Phosphorus', cat: 'nonmetal' },
                { sym: 'S', num: 16, name: 'Sulfur', cat: 'nonmetal' },
                { sym: 'Cl', num: 17, name: 'Chlorine', cat: 'halogen' },
                { sym: 'Ar', num: 18, name: 'Argon', cat: 'noble' },
              ].map((el, i) => {
                const catColors: Record<string, string> = {
                  nonmetal: 'bg-green-500/20 border-green-500/30 text-green-400',
                  noble: 'bg-purple-500/20 border-purple-500/30 text-purple-400',
                  alkali: 'bg-red-500/20 border-red-500/30 text-red-400',
                  alkaline: 'bg-orange-500/20 border-orange-500/30 text-orange-400',
                  metalloid: 'bg-teal-500/20 border-teal-500/30 text-teal-400',
                  halogen: 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400',
                  metal: 'bg-blue-500/20 border-blue-500/30 text-blue-400',
                };
                return (
                  <motion.div key={el.sym} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.02 }}
                    className={`p-1.5 rounded border text-center cursor-pointer hover:scale-105 transition-transform ${catColors[el.cat] || ''}`}
                    title={el.name}>
                    <span className="text-[10px] text-gray-500">{el.num}</span>
                    <p className="text-sm font-bold">{el.sym}</p>
                    <p className="text-[9px] text-gray-500 truncate">{el.name}</p>
                  </motion.div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-3 mt-3">
              {[
                { cat: 'Nonmetal', color: 'bg-green-500' }, { cat: 'Noble Gas', color: 'bg-purple-500' },
                { cat: 'Alkali Metal', color: 'bg-red-500' }, { cat: 'Alkaline Earth', color: 'bg-orange-500' },
                { cat: 'Metalloid', color: 'bg-teal-500' }, { cat: 'Halogen', color: 'bg-yellow-500' },
              ].map(l => (
                <span key={l.cat} className="flex items-center gap-1 text-xs text-gray-400">
                  <span className={`w-2 h-2 rounded-sm ${l.color}`} /> {l.cat}
                </span>
              ))}
            </div>
          </div>

          {/* Reaction Equation Display */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Zap className="w-4 h-4 text-neon-purple" /> Common Reaction Equations</h3>
            <div className="space-y-2">
              {[
                { eq: '2H\u2082 + O\u2082 \u2192 2H\u2082O', name: 'Water Synthesis', type: 'Combustion' },
                { eq: 'CH\u2084 + 2O\u2082 \u2192 CO\u2082 + 2H\u2082O', name: 'Methane Combustion', type: 'Combustion' },
                { eq: 'NaOH + HCl \u2192 NaCl + H\u2082O', name: 'Neutralization', type: 'Acid-Base' },
                { eq: '6CO\u2082 + 6H\u2082O \u2192 C\u2086H\u2081\u2082O\u2086 + 6O\u2082', name: 'Photosynthesis', type: 'Biochemical' },
              ].map((rxn, i) => (
                <motion.div key={rxn.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                  className="flex items-center justify-between p-3 bg-black/20 rounded-lg border border-white/5">
                  <div>
                    <p className="font-mono text-sm text-neon-cyan">{rxn.eq}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{rxn.name}</p>
                  </div>
                  <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">{rxn.type}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {activeTab === 'reactions' && (
        <motion.div key="reactions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Reaction Chamber */}
        <div className="lg:col-span-2 panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-neon-purple" />
            Reaction Chamber
          </h3>

          <div className="graph-container flex items-center justify-center relative">
            <div className="absolute inset-0 bg-gradient-to-b from-neon-purple/5 to-neon-blue/5" />
            <div className="text-center">
              <Beaker className="w-24 h-24 mx-auto text-neon-cyan animate-pulse" />
              <p className="text-gray-400 mt-4">
                Enter a reaction formula to simulate
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={reactionInput}
              onChange={(e) => setReactionInput(e.target.value)}
              placeholder="e.g., H2 + O2 → H2O"
              className="input-lattice flex-1 font-mono"
            />
            <button
              onClick={() => runReaction.mutate(reactionInput)}
              disabled={!reactionInput || runReaction.isPending}
              className="btn-neon purple"
            >
              <Zap className="w-4 h-4 mr-2 inline" />
              {runReaction.isPending ? 'Reacting...' : 'React'}
            </button>
          </div>
        </div>

        {/* Compound Library */}
        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Atom className="w-4 h-4 text-neon-blue" />
            Compound Library
          </h3>

          <div className="space-y-2 max-h-[400px] overflow-auto">
            {compounds?.map((compound: Compound) => (
              <button
                key={compound.id}
                onClick={() => setSelectedCompound(compound.id)}
                className={`w-full text-left lens-card ${
                  selectedCompound === compound.id ? 'border-neon-cyan' : ''
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{compound.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded border ${
                      typeColors[compound.type]
                    }`}
                  >
                    {compound.type}
                  </span>
                </div>
                <p className="font-mono text-sm text-gray-400">{compound.formula}</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-gray-500">Stability:</span>
                  <div className="flex-1 h-1 bg-lattice-deep rounded">
                    <div
                      className={`h-full rounded ${
                        compound.stability > 0.7
                          ? 'bg-neon-green'
                          : compound.stability > 0.4
                          ? 'bg-neon-blue'
                          : 'bg-neon-pink'
                      }`}
                      style={{ width: `${compound.stability * 100}%` }}
                    />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recent Reactions */}
      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-green" />
          Recent Reactions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reactions?.length === 0 ? (
            <p className="col-span-full text-center py-8 text-gray-500">
              No reactions yet. Try the reaction chamber!
            </p>
          ) : (
            reactions?.slice(0, 6).map((reaction: Reaction, i: number) => (
              <motion.div key={reaction.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} className="lens-card">
                <p className="font-mono text-sm mb-2">{reaction.formula}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">
                    {new Date(reaction.timestamp).toLocaleString()}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded ${
                      reaction.success
                        ? 'bg-neon-green/20 text-neon-green'
                        : 'bg-neon-pink/20 text-neon-pink'
                    }`}
                  >
                    {reaction.success ? 'Success' : 'Failed'}
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
        </motion.div>
      )}

      {activeTab === 'compounds' && (
        <motion.div key="compounds" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="panel p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Atom className="w-4 h-4 text-neon-blue" />
              Full Compound Library
            </h3>
            <div className="space-y-2 max-h-[500px] overflow-auto">
              {compounds?.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No compounds in library. Add via reactions or import.</p>
              ) : compounds?.map((compound: Compound, i: number) => (
                <motion.button
                  key={compound.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => setSelectedCompound(compound.id)}
                  className={`w-full text-left lens-card ${selectedCompound === compound.id ? 'border-neon-cyan' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium">{compound.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded border ${typeColors[compound.type]}`}>{compound.type}</span>
                  </div>
                  <p className="font-mono text-sm text-gray-400">{compound.formula}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-xs text-gray-500">Stability:</span>
                    <div className="flex-1 h-1 bg-lattice-deep rounded">
                      <motion.div initial={{ width: 0 }} animate={{ width: `${compound.stability * 100}%` }}
                        className={`h-full rounded ${compound.stability > 0.7 ? 'bg-neon-green' : compound.stability > 0.4 ? 'bg-neon-blue' : 'bg-neon-pink'}`}
                      />
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Backend Computational Actions */}
      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Zap className="w-4 h-4 text-neon-cyan" /> Computational Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => handleChemAction('molecularAnalysis')}
            disabled={isRunning !== null}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-cyan/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'molecularAnalysis'
              ? <Loader2 className="w-5 h-5 text-neon-cyan animate-spin" />
              : <Atom className="w-5 h-5 text-neon-cyan" />}
            <span className="text-xs text-gray-300">Molecular Analysis</span>
          </button>
          <button
            onClick={() => handleChemAction('balanceReaction')}
            disabled={isRunning !== null}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-purple/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'balanceReaction'
              ? <Loader2 className="w-5 h-5 text-neon-purple animate-spin" />
              : <FlaskConical className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Balance Reaction</span>
          </button>
          <button
            onClick={() => handleChemAction('solutionChemistry')}
            disabled={isRunning !== null}
            className="flex flex-col items-center gap-2 p-3 bg-lattice-bg rounded-lg border border-lattice-border hover:border-neon-green/50 transition-colors disabled:opacity-50"
          >
            {isRunning === 'solutionChemistry'
              ? <Loader2 className="w-5 h-5 text-neon-green animate-spin" />
              : <Beaker className="w-5 h-5 text-neon-green" />}
            <span className="text-xs text-gray-300">Solution Chemistry</span>
          </button>
        </div>

        {/* Action Result Display */}
        {actionResult && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-4 bg-black/30 rounded-lg border border-white/10"
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-white flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-neon-cyan" /> Action Result
              </h4>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white transition-colors">
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            {/* Molecular Analysis Result */}
            {actionResult.formula !== undefined && actionResult.molecularWeight !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="font-mono text-lg font-bold text-neon-cyan">{actionResult.formula as string}</span>
                  <span className="text-sm text-gray-300">MW: <span className="font-bold text-white">{actionResult.molarMass as string}</span></span>
                  {actionResult.degreeOfUnsaturation !== null && actionResult.degreeOfUnsaturation !== undefined && (
                    <span className="text-xs px-2 py-0.5 rounded bg-neon-purple/20 text-neon-purple">DoU: {actionResult.degreeOfUnsaturation as number}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-green">{actionResult.totalAtoms as number}</p>
                    <p className="text-[10px] text-gray-500">Total Atoms</p>
                  </div>
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-blue">{actionResult.empiricalFormula as string}</p>
                    <p className="text-[10px] text-gray-500">Empirical Formula</p>
                  </div>
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-purple">{actionResult.formulaToEmpiricalRatio as number}×</p>
                    <p className="text-[10px] text-gray-500">Formula Ratio</p>
                  </div>
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-cyan">{actionResult.molesPerGram as number}</p>
                    <p className="text-[10px] text-gray-500">mol/g</p>
                  </div>
                </div>
                {(actionResult.elements as Array<{ element: string; count: number; massPercent: number }>)?.length > 0 && (
                  <div className="space-y-1">
                    {(actionResult.elements as Array<{ element: string; count: number; massPercent: number }>).map(el => (
                      <div key={el.element} className="flex items-center gap-2 text-xs">
                        <span className="w-6 font-mono text-gray-300">{el.element}</span>
                        <div className="flex-1 h-1.5 bg-lattice-deep rounded overflow-hidden">
                          <div className="h-full bg-neon-cyan rounded" style={{ width: `${el.massPercent}%` }} />
                        </div>
                        <span className="text-gray-400 w-10 text-right">{el.massPercent}%</span>
                        <span className="text-gray-500 w-8 text-right">×{el.count}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Balance Reaction Result */}
            {actionResult.equation !== undefined && actionResult.coefficients !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${(actionResult.balanced as boolean) ? 'bg-neon-green/20 text-neon-green' : 'bg-neon-pink/20 text-neon-pink'}`}>
                    {(actionResult.balanced as boolean) ? 'Balanced' : 'Unbalanced'}
                  </span>
                </div>
                <p className="font-mono text-sm text-neon-cyan p-2 bg-black/30 rounded">{actionResult.equation as string}</p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Reactants</p>
                    {(actionResult.reactants as Array<{ formula: string; coefficient: number }>)?.map(r => (
                      <div key={r.formula} className="flex items-center gap-2 text-xs py-0.5">
                        <span className="font-bold text-neon-blue w-6">{r.coefficient}</span>
                        <span className="font-mono text-gray-300">{r.formula}</span>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Products</p>
                    {(actionResult.products as Array<{ formula: string; coefficient: number }>)?.map(p => (
                      <div key={p.formula} className="flex items-center gap-2 text-xs py-0.5">
                        <span className="font-bold text-neon-green w-6">{p.coefficient}</span>
                        <span className="font-mono text-gray-300">{p.formula}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Solution Chemistry Result */}
            {actionResult.pH !== undefined && actionResult.nature !== undefined && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold text-neon-cyan">{actionResult.pH as number}</div>
                  <div>
                    <span className={`text-sm font-medium px-2 py-0.5 rounded ${
                      (actionResult.nature as string) === 'acidic' ? 'bg-red-500/20 text-red-400' :
                      (actionResult.nature as string) === 'basic' ? 'bg-blue-500/20 text-blue-400' :
                      'bg-gray-500/20 text-gray-400'
                    }`}>
                      {(actionResult.nature as string).charAt(0).toUpperCase() + (actionResult.nature as string).slice(1)}
                    </span>
                    <p className="text-xs text-gray-400 mt-1">{actionResult.type as string} · {actionResult.concentration as number} mol/L</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-green">{actionResult.pOH as number}</p>
                    <p className="text-[10px] text-gray-500">pOH</p>
                  </div>
                  <div className="p-2 bg-lattice-bg rounded text-center">
                    <p className="text-sm font-bold text-neon-blue">{actionResult.hydrogenIonConc as number}</p>
                    <p className="text-[10px] text-gray-500">[H⁺] mol/L</p>
                  </div>
                </div>
              </div>
            )}

            {/* Fallback: generic JSON display */}
            {actionResult.formula === undefined && actionResult.equation === undefined && actionResult.pH === undefined && !!actionResult.message && (
              <p className="text-sm text-gray-400">{actionResult.message as string}</p>
            )}
            {actionResult.formula === undefined && actionResult.equation === undefined && actionResult.pH === undefined && !actionResult.message && (
              <pre className="text-xs font-mono text-gray-400 overflow-auto max-h-48">{JSON.stringify(actionResult, null, 2)}</pre>
            )}
          </motion.div>
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
            <LensFeaturePanel lensId="chem" />
          </div>
        )}
      </div>
    </div>
  );
}
