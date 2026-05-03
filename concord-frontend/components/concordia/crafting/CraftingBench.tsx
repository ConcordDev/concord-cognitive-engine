'use client';

import React, { useState } from 'react';
import { BlueprintPanel } from './BlueprintPanel';
import { ToolTreePanel } from './ToolTreePanel';

type Tab = 'blueprints' | 'tools';

interface CraftingBenchProps {
  playerId: string;
  toolTier: number;
  toolQuality: number;
  skillLevel: number;
  onClose: () => void;
}

export function CraftingBench({ playerId, toolTier, toolQuality: _toolQuality, skillLevel, onClose }: CraftingBenchProps) {
  const [tab, setTab] = useState<Tab>('blueprints');

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm z-40">
      <div className="bg-black/90 border border-white/10 rounded-2xl w-full max-w-2xl mx-4 flex flex-col"
        style={{ height: '80vh', maxHeight: 600 }}>

        {/* Tab bar */}
        <div className="flex border-b border-white/10 px-4 pt-3 gap-4">
          <button
            onClick={() => setTab('blueprints')}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-all ${tab === 'blueprints' ? 'border-blue-500 text-white' : 'border-transparent text-white/40 hover:text-white/60'}`}
          >
            Blueprints
          </button>
          <button
            onClick={() => setTab('tools')}
            className={`pb-2.5 text-sm font-semibold border-b-2 transition-all ${tab === 'tools' ? 'border-blue-500 text-white' : 'border-transparent text-white/40 hover:text-white/60'}`}
          >
            Tool Tree
          </button>
          <button onClick={onClose} className="ml-auto mb-2.5 text-white/30 hover:text-white text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-hidden">
          {tab === 'blueprints' && (
            <BlueprintPanel
              playerId={playerId}
              toolTier={toolTier}
              skillLevel={skillLevel}
              onClose={onClose}
            />
          )}
          {tab === 'tools' && (
            <ToolTreePanel onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
