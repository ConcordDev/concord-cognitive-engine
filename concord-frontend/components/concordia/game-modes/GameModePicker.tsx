'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Play } from 'lucide-react';
import { getAllGameModes, type GameMode } from '@/lib/concordia/game-mode-orchestrator';
import { useGameMode } from '@/hooks/useGameMode';

// Import all mode registrations so they appear in the registry
import '@/lib/concordia/game-modes/architect';
import '@/lib/concordia/game-modes/master-forge';
import '@/lib/concordia/game-modes/expedition';
import '@/lib/concordia/game-modes/crisis-response';
import '@/lib/concordia/game-modes/mentor';
import '@/lib/concordia/game-modes/ghost-hunt';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function GameModePicker({ open, onClose }: Props) {
  const [modes, setModes] = useState<GameMode[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const { active, start } = useGameMode();

  useEffect(() => {
    setModes(getAllGameModes());
  }, [open]);

  function handleStart(modeId: string) {
    start(modeId);
    onClose();
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[850] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            key="picker-panel"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-x-4 bottom-20 top-20 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-[640px] z-[860] flex flex-col"
          >
            <div className="bg-zinc-950 border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl h-full">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                <div>
                  <h2 className="text-white font-semibold text-base">Game Modes</h2>
                  <p className="text-white/40 text-xs mt-0.5">Structured experiences that sequence modes + lenses automatically</p>
                </div>
                <button
                  onClick={onClose}
                  className="text-white/40 hover:text-white transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Mode grid */}
              <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {modes.map(mode => {
                  const isActive = active?.id === mode.id;
                  const isHovered = hovered === mode.id;
                  return (
                    <motion.div
                      key={mode.id}
                      onHoverStart={() => setHovered(mode.id)}
                      onHoverEnd={() => setHovered(null)}
                      className={`relative rounded-xl border p-4 cursor-pointer transition-colors ${
                        isActive
                          ? 'border-indigo-500/60 bg-indigo-500/10'
                          : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20'
                      }`}
                    >
                      {/* Icon + name */}
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{mode.icon}</span>
                          <div>
                            <div className="text-white font-medium text-sm">{mode.name}</div>
                            <div className="text-white/40 text-xs">{mode.stages.length} stages</div>
                          </div>
                        </div>
                        {isActive && (
                          <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/20 px-1.5 py-0.5 rounded-full">
                            ACTIVE
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-white/50 text-xs leading-relaxed mb-3">
                        {mode.description}
                      </p>

                      {/* Stage list */}
                      <div className="flex flex-wrap gap-1 mb-3">
                        {mode.stages.map(s => (
                          <span
                            key={s.id}
                            className="text-[10px] text-white/30 bg-white/5 rounded px-1.5 py-0.5"
                          >
                            {s.name}
                          </span>
                        ))}
                      </div>

                      {/* Start button */}
                      <AnimatePresence>
                        {(isHovered || isActive) && (
                          <motion.button
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            onClick={() => handleStart(mode.id)}
                            className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg py-2 transition-colors"
                          >
                            <Play className="w-3 h-3" />
                            {isActive ? 'Restart' : 'Start'}
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
