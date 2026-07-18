'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ArxivPanel } from '@/components/research/ArxivPanel';
import { PubChemPanel } from '@/components/chem/PubChemPanel';
import { PeriodicTable } from '@/components/chem/PeriodicTable';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { apiHelpers } from '@/lib/api/client';
import { useMutation } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Atom, Beaker, FlaskConical, Sparkles, Zap, TestTube2, AlertTriangle } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { SubLensQuickNav } from '@/components/lens/SubLensQuickNav';
import LiveFeed, { adaptToLiveFeedArticles } from '@/components/lens/LiveFeed';
import ChemWorkbench from '@/components/chem/ChemWorkbench';
import ChemStructureLab from '@/components/chem/ChemStructureLab';
import { ChemActionPanel } from '@/components/chem/ChemActionPanel';
import { ChemSafetyPanel } from '@/components/chem/ChemSafetyPanel';
import { PipingProvider } from '@/components/panel-polish';

interface Compound {
  id: string;
  name: string;
  formula: string;
  type: 'catalyst' | 'reagent' | 'product';
  molecularWeight?: number | null;
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
  const [activeTab, setActiveTab] = useState<'elements' | 'reactions' | 'compounds'>('reactions');
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('chem');

  useLensCommand(
    [
      { id: 'tab-elements', keys: 'e', description: 'Elements', category: 'navigation', action: () => setActiveTab('elements') },
      { id: 'tab-reactions', keys: 'r', description: 'Reactions', category: 'navigation', action: () => setActiveTab('reactions') },
      { id: 'tab-compounds', keys: 'c', description: 'Compounds', category: 'navigation', action: () => setActiveTab('compounds') },
    ],
    { lensId: 'chem' }
  );

  const { items: compoundItems, isLoading, isError: isError, error: error, refetch: refetch, create: createCompound } = useLensData<Record<string, unknown>>('chem', 'compound', { seed: [] });
  const compounds = compoundItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Compound[];

  const { items: reactionItems, isError: isError2, error: error2, refetch: refetch2, create: createReaction } = useLensData<Record<string, unknown>>('chem', 'reaction', { seed: [] });
  const reactions = reactionItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Reaction[];

  // Reaction Chamber runs the REAL chem.balanceReaction Gaussian-elimination
  // solver (server/domains/chem.js) — this used to just archive whatever
  // string the user typed with no chemistry behind it, and `success` was
  // never set so every reaction rendered "Failed". Now the reaction record
  // stores the actual balanced equation + the solver's real balanced flag,
  // and each product gets minted into the Compound Library with its real
  // molecular weight (from chem.molecularAnalysis) — never a fabricated
  // stability number.
  const runReaction = useMutation({
    mutationFn: async (equation: string) => {
      const r = await apiHelpers.lens.runDomain('chem', 'balanceReaction', { input: { equation } });
      const env = (r.data as { ok?: boolean; result?: { ok?: boolean; error?: string; equation?: string; balanced?: boolean; reactants?: { formula: string }[]; products?: { formula: string }[] } })?.result;
      if (!env || env.ok === false) throw new Error(env?.error || 'Could not balance that equation.');
      await createReaction({ title: env.equation, data: { formula: env.equation, ranAt: new Date().toISOString(), success: !!env.balanced } });
      for (const p of env.products || []) {
        try {
          const mwR = await apiHelpers.lens.runDomain('chem', 'molecular-weight', { input: { formula: p.formula } });
          const mw = (mwR.data as { result?: { ok?: boolean; molecularWeight?: number } })?.result;
          const weight = mw && mw.ok !== false ? mw.molecularWeight ?? null : null;
          await createCompound({ title: p.formula, data: { name: p.formula, formula: p.formula, type: 'product', molecularWeight: weight } });
        } catch { /* MW lookup is best-effort — an unparseable formula still keeps the compound record */ }
      }
      return env;
    },
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

  if (isLoading) {
    return (
      <div data-lens-theme="chem" className="flex items-center justify-center h-full p-8" role="status" aria-live="polite" aria-busy="true">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading lab results...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8" role="alert">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <LensShell lensId="chem" asMain={false}>
      <FirstRunTour lensId="chem" />
      <ManifestActionBar />
      <DepthBadge lensId="chem" size="sm" className="ml-2" />
    <div data-lens-theme="chem" className="p-6 space-y-6">
      {/* Phase 4 — REAL arXiv chemistry feed (physics.chem-ph). */}
      <ArxivPanel domain="chem" title="arXiv · Chemical Physics" />
      {/* Phase 4 — REAL PubChem (NIH) compound lookup. */}
      <PubChemPanel />
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


      {/* Live arXiv papers — physics.chem-ph + cond-mat categories */}
      <LiveFeed
        articles={adaptToLiveFeedArticles(realtimeData as Record<string, unknown> | null)}
        domain="research"
        isLive={isLive}
        lastUpdated={lastUpdated}
        limit={8}
      />
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
              activeTab === tab.key ? 'bg-teal-500/20 text-teal-400' : 'text-gray-400 hover:text-white'
            }`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
      {activeTab === 'elements' && (
        <motion.div key="elements" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-4">
          {/* Full 118-element periodic table (chem.periodic-table), click-to-detail + Save-as-DTU. */}
          <div className="panel p-4">
            <PeriodicTable />
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
          {runReaction.isError && (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> {runReaction.error instanceof Error ? runReaction.error.message : 'Could not balance that equation.'}
            </p>
          )}
          <p className="text-xs text-gray-500">Runs the real chem.balanceReaction Gaussian-elimination solver — coefficients are computed, not guessed. Each product is minted into the Compound Library with its real molecular weight.</p>
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
                {compound.molecularWeight != null && (
                  <p className="text-xs text-gray-500 mt-1">MW: <span className="text-gray-300 font-mono">{compound.molecularWeight} g/mol</span></p>
                )}
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
            <p className="col-span-full text-center py-8 text-gray-400">
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
                <div className="text-center py-8 space-y-3" data-testid="chem-compounds-empty">
                  <p className="text-gray-400">No compounds in library yet. Run a reaction to mint your first compound.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('reactions')}
                    className="px-4 py-2 rounded bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 text-sm font-medium"
                  >
                    Run a reaction
                  </button>
                </div>
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
                  {compound.molecularWeight != null && (
                    <p className="text-xs text-gray-500 mt-1">MW: <span className="text-gray-300 font-mono">{compound.molecularWeight} g/mol</span></p>
                  )}
                </motion.button>
              ))}
            </div>
          </div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Compound safety data sheet + interaction checker + element reference —
          chem.generate-safety / chem.check-interactions / chem.explore-element
          had zero bespoke UI before this rebuild. */}
      <ChemSafetyPanel />
    </div>

      <a href="#chem-skip" className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none">Skip to chem content</a>

      {/* 2026 parity workbench — MW, molarity, dilution, pH, gas law, periodic table */}
      <button
        type="button"
        onClick={() => setWorkbenchOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-violet-500 hover:bg-violet-400 text-violet-50 shadow-2xl text-sm font-medium"
        title="Chem Workbench — MW, molarity, dilution, pH, gas law, periodic table"
      >
        Chem Workbench
      </button>
      <ChemWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />

      {/* 2026 parity backlog — structure editor, 3D viewer, SMILES/InChI,
          stoichiometry, spectroscopy, mechanisms, lab notebook. */}
      <div className="mt-6">
        <ChemStructureLab />
      </div>

      <PipingProvider>
        <section className="mt-6">
          <ChemActionPanel />
        </section>
      </PipingProvider>
          <RecentMineCard domain="chem" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="chem" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="chem" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
    </LensShell>
  );
}
