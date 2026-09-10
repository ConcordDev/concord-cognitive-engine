'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Atom } from 'lucide-react';
import { useLensData } from '@/lib/hooks/use-lens-data';
import type { Compound } from './types';

const typeColors = {
  catalyst: 'bg-neon-purple/20 text-neon-purple border-neon-purple/30',
  reagent: 'bg-neon-blue/20 text-neon-blue border-neon-blue/30',
  product: 'bg-neon-green/20 text-neon-green border-neon-green/30',
};

export function CompoundsPanel({ onGotoReactions }: { onGotoReactions?: () => void }) {
  const [selectedCompound, setSelectedCompound] = useState<string | null>(null);
  const { items: compoundItems } = useLensData<Record<string, unknown>>('chem', 'compound', { seed: [] });
  const compounds = compoundItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as Compound[];

  return (
    <div className="panel p-4 space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <Atom className="w-4 h-4 text-neon-blue" />
        Full Compound Library
      </h3>
      <div className="space-y-2 max-h-[500px] overflow-auto">
        {compounds?.length === 0 ? (
          <div className="text-center py-8 space-y-3" data-testid="chem-compounds-empty">
            <p className="text-gray-400">No compounds in library yet. Run a reaction to mint your first compound.</p>
            {onGotoReactions && (
              <button type="button" onClick={onGotoReactions}
                className="px-4 py-2 rounded bg-teal-500/20 text-teal-300 hover:bg-teal-500/30 text-sm font-medium">
                Run a reaction
              </button>
            )}
          </div>
        ) : compounds?.map((compound: Compound, i: number) => (
          <motion.button key={compound.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.03 }} onClick={() => setSelectedCompound(compound.id)}
            className={`w-full text-left lens-card ${selectedCompound === compound.id ? 'border-neon-cyan' : ''}`}>
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
  );
}
