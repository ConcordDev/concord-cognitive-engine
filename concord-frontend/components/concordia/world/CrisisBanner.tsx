'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useEvent } from '@/lib/realtime/event-bus';
import { motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface Crisis {
  id: string;
  type: string;
  description: string;
  originWorldId?: string;
  endsAt: number;
}

function useCountdown(endsAt: number) {
  const [remaining, setRemaining] = useState(() => Math.max(0, endsAt - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setRemaining(Math.max(0, endsAt - Date.now())), 10_000);
    return () => clearInterval(t);
  }, [endsAt]);
  const h = Math.floor(remaining / 3_600_000);
  const m = Math.floor((remaining % 3_600_000) / 60_000);
  return remaining <= 0 ? 'expired' : `${h}h ${m}m`;
}

function CrisisItem({ crisis, onDismiss }: { crisis: Crisis; onDismiss: () => void }) {
  const countdown = useCountdown(crisis.endsAt);

  const respond = async () => {
    await fetch(`/api/worlds/crises/${crisis.id}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome: 'Resolved by community response.' }),
    });
    onDismiss();
  };

  return (
    <div className="flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white/90 leading-snug">{crisis.description}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="text-xs text-red-400/70 font-mono">{countdown}</span>
          <button
            onClick={respond}
            className="text-xs text-white/60 hover:text-white border border-white/20 hover:border-white/40 rounded px-2 py-0.5 transition"
          >
            Respond
          </button>
        </div>
      </div>
      <button onClick={onDismiss} className="text-white/30 hover:text-white/60 flex-shrink-0" aria-label="Close">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

export function CrisisBanner() {
  const [crises, setCrises] = useState<Crisis[]>([]);

  // Load active crises on mount
  useEffect(() => {
    fetch('/api/worlds/crises')
      .then(r => r.json())
      .then(d => setCrises(d.crises || []))
      .catch(() => {});
  }, []);

  // React to new crises via socket
  useEvent<Crisis>('world:crisis', (data) => {
    setCrises(prev => [data, ...prev.filter(c => c.id !== data.id)]);
  });

  useEvent<{ id: string }>('world:crisis-resolved', ({ id }) => {
    setCrises(prev => prev.filter(c => c.id !== id));
  });

  const dismiss = useCallback((id: string) => {
    setCrises(prev => prev.filter(c => c.id !== id));
  }, []);

  if (crises.length === 0) return null;

  return (
    <motion.div
      initial={{ y: -60, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed top-0 inset-x-0 z-[9996] bg-gradient-to-r from-red-950/95 via-red-900/95 to-red-950/95 border-b border-red-500/40 px-4 py-3 pointer-events-auto"
    >
      <div className="max-w-4xl mx-auto flex flex-col gap-2">
        {crises.map(c => (
          <CrisisItem key={c.id} crisis={c} onDismiss={() => dismiss(c.id)} />
        ))}
      </div>
    </motion.div>
  );
}
