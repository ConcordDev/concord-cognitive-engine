'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Atom, Beaker, FlaskConical, Sparkles, Zap, AlertTriangle } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { Compound, Reaction } from './types';

const typeColors = {
  catalyst: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30',
  reagent: 'bg-neon-blue/20 text-neon-blue border-neon-blue/30',
  product: 'bg-neon-green/20 text-neon-green border-neon-green/30',
};

export function ReactionsPanel({ onGotoCompounds }: { onGotoCompounds?: () => void }) {
  const [selectedCompound, setSelectedCompound] = useState<string | null>(null);
  const [reactionInput, setReactionInput] = useState('');

  const { items: compoundItems, refetch: refetch, create: createCompound } = useLensData<Record<string, unknown>>('chem', 'compound', { seed: [] });
  const compounds = compoundItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Compound[];

  const { items: reactionItems, refetch: refetch2, create: createReaction } = useLensData<Record<string, unknown>>('chem', 'reaction', { seed: [] });
  const reactions = reactionItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Reaction[];

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
        } catch { /* MW lookup best-effort */ }
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-neon-purple" />
            Reaction Chamber
          </h3>
          <div className="graph-container flex items-center justify-center relative">
            <div className="absolute inset-0 bg-gradient-to-b from-neon-purple/5 to-neon-blue/5" />
            <div className="text-center">
              <Beaker className="w-24 h-24 mx-auto text-neon-cyan animate-pulse" />
              <p className="text-gray-400 mt-4">Enter a reaction formula to simulate</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input type="text" value={reactionInput} onChange={(e) => setReactionInput(e.target.value)}
              placeholder="e.g., H2 + O2 → H2O" className="input-lattice flex-1 font-mono" />
            <button onClick={() => runReaction.mutate(reactionInput)} disabled={!reactionInput || runReaction.isPending} className="btn-neon purple">
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

        <div className="panel p-4 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Atom className="w-4 h-4 text-neon-blue" />
            Compound Library
          </h3>
          <div className="space-y-2 max-h-[400px] overflow-auto">
            {compounds?.map((compound: Compound) => (
              <button key={compound.id} onClick={() => setSelectedCompound(compound.id)}
                className={`w-full text-left lens-card ${selectedCompound === compound.id ? 'border-neon-cyan' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-medium">{compound.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${typeColors[compound.type]}`}>{compound.type}</span>
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

      <div className="panel p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-neon-green" />
          Recent Reactions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {reactions?.length === 0 ? (
            <p className="col-span-full text-center py-8 text-gray-400">No reactions yet. Try the reaction chamber!</p>
          ) : (
            reactions?.slice(0, 6).map((reaction: Reaction, i: number) => (
              <motion.div key={reaction.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.05 }} className="lens-card">
                <p className="font-mono text-sm mb-2">{reaction.formula}</p>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">{new Date(reaction.timestamp).toLocaleString()}</span>
                  <span className={`px-2 py-0.5 rounded ${reaction.success ? 'bg-neon-green/20 text-neon-green' : 'bg-neon-pink/20 text-neon-pink'}`}>
                    {reaction.success ? 'Success' : 'Failed'}
                  </span>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
