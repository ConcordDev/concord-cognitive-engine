'use client';

import React, { useState, useCallback } from 'react';
import { useEvent } from '@/lib/realtime/event-bus';
import { motion, AnimatePresence } from 'framer-motion';

interface XPEvent {
  dtuId: string;
  awarded: number;
  leveledUp: boolean;
  mastery?: { title: string };
}

interface Toast {
  id: number;
  awarded: number;
  leveledUp: boolean;
  masteryTitle?: string;
}

let _nextId = 0;

export function XPToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const handleXP = useCallback((data: XPEvent) => {
    if (!data.awarded || data.awarded <= 0) return;
    const toast: Toast = {
      id: ++_nextId,
      awarded: data.awarded,
      leveledUp: data.leveledUp,
      masteryTitle: data.leveledUp ? data.mastery?.title : undefined,
    };
    setToasts(prev => [...prev, toast]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toast.id)), 2000);
  }, []);

  useEvent<XPEvent>('skill:xp-awarded', handleXP);

  return (
    <div className="fixed right-4 bottom-24 z-50 flex flex-col gap-1 items-end pointer-events-none">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.9 }}
            transition={{ duration: 0.2 }}
            className="px-3 py-1 rounded-full text-xs font-bold font-mono shadow-lg bg-emerald-500/90 text-white"
          >
            {t.leveledUp && t.masteryTitle
              ? `⬆ ${t.masteryTitle}!`
              : `+${t.awarded.toFixed(1)} XP`}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
