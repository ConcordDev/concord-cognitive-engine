'use client';

import React, { useState } from 'react';
import { useEvent } from '@/lib/realtime/event-bus';
import { motion, AnimatePresence } from 'framer-motion';

interface HybridCreatedEvent {
  id: string;
  title: string;
  domainAffinity?: string[];
  skill_level?: number;
  parentIds?: string[];
}

export function HybridReveal() {
  const [hybrid, setHybrid] = useState<HybridCreatedEvent | null>(null);

  useEvent<HybridCreatedEvent>('hybrid:created', (data) => {
    setHybrid(data);
  });

  const dismiss = () => setHybrid(null);

  return (
    <AnimatePresence>
      {hybrid && (
        <motion.div
          key={hybrid.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9997] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.5, rotate: -6 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 200 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-black/95 border-2 border-neon-purple/60 rounded-2xl p-10 text-center shadow-2xl shadow-purple-900/40 max-w-sm"
          >
            <div className="text-neon-purple text-xs font-mono uppercase tracking-widest mb-4">
              ◆ Hybrid Skill Forged ◆
            </div>

            {/* Parent merging animation */}
            <div className="flex items-center justify-center gap-3 mb-6">
              <div className="w-8 h-8 rounded-full bg-neon-cyan/20 border border-neon-cyan/40 flex items-center justify-center">
                <span className="text-neon-cyan text-xs">◈</span>
              </div>
              <motion.div
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                transition={{ repeat: 2, duration: 0.8 }}
                className="text-neon-purple text-lg"
              >
                ⟡
              </motion.div>
              <div className="w-8 h-8 rounded-full bg-neon-purple/20 border border-neon-purple/40 flex items-center justify-center">
                <span className="text-neon-purple text-xs">◈</span>
              </div>
            </div>

            <div className="text-white font-bold text-2xl mb-1">{hybrid.title}</div>
            {hybrid.domainAffinity && hybrid.domainAffinity.length > 0 && (
              <div className="flex gap-1 justify-center flex-wrap mt-2 mb-3">
                {hybrid.domainAffinity.map(d => (
                  <span key={d} className="text-[10px] bg-neon-purple/10 border border-neon-purple/30 rounded px-1.5 py-0.5 text-neon-purple-bright font-mono">
                    {d}
                  </span>
                ))}
              </div>
            )}
            {hybrid.skill_level && (
              <div className="text-gray-400 text-sm mb-4 font-mono">
                Starting level: {hybrid.skill_level.toFixed(1)}
              </div>
            )}
            <button
              onClick={dismiss}
              className="mt-2 px-6 py-2 rounded-lg bg-neon-purple/20 border border-neon-purple/40 text-neon-purple-bright text-sm hover:bg-neon-purple/30 transition"
            >
              Claim Skill
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
