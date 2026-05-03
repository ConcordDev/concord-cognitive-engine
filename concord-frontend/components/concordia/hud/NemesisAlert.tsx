'use client';

import React, { useState } from 'react';
import { useEvent } from '@/lib/realtime/event-bus';
import { motion, AnimatePresence } from 'framer-motion';

interface NemesisRisenEvent {
  npcName: string;
  npcTitle: string;
  killCount: number;
}

interface NemesisDefeatedEvent {
  npcId: string;
}

export function NemesisAlert() {
  const [risen, setRisen] = useState<NemesisRisenEvent | null>(null);
  const [defeated, setDefeated] = useState<string | null>(null);

  useEvent<NemesisRisenEvent>('world:nemesis-risen', (data) => {
    setRisen(data);
    setTimeout(() => setRisen(null), 6000);
  });

  useEvent<NemesisDefeatedEvent>('nemesis:defeated', () => {
    setDefeated('Nemesis Defeated!');
    setTimeout(() => setDefeated(null), 4000);
  });

  return (
    <>
      <AnimatePresence>
        {risen && (
          <motion.div
            key="nemesis-risen"
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            className="fixed inset-x-0 top-0 z-[9999] flex justify-center pt-8 pointer-events-none"
          >
            <div className="bg-black/95 border-2 border-red-500/60 rounded-xl px-8 py-5 text-center shadow-2xl shadow-red-900/30 max-w-md">
              <div className="text-red-400 text-xs font-mono uppercase tracking-widest mb-1">
                ⚠ Nemesis Risen
              </div>
              <div className="text-white font-bold text-xl mb-1">{risen.npcName}</div>
              <div className="text-red-300 italic text-sm mb-2">"{risen.npcTitle}"</div>
              {risen.killCount > 1 && (
                <div className="text-gray-500 text-xs">
                  They have defeated you {risen.killCount} time{risen.killCount > 1 ? 's' : ''}.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {defeated && (
          <motion.div
            key="nemesis-defeated"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.1 }}
            className="fixed inset-x-0 top-0 z-[9999] flex justify-center pt-8 pointer-events-none"
          >
            <div className="bg-black/95 border-2 border-emerald-500/60 rounded-xl px-8 py-5 text-center shadow-2xl shadow-emerald-900/30">
              <div className="text-emerald-400 text-xs font-mono uppercase tracking-widest mb-1">
                ✓ Nemesis Slain
              </div>
              <div className="text-white font-bold text-xl">Your nemesis has fallen.</div>
              <div className="text-emerald-300 text-sm mt-1">+50 CC awarded</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
