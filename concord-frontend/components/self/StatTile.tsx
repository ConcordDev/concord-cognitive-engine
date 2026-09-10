'use client';

import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

export function StatTile({ label, value, icon: Icon }: { label: string; value: number | string; icon: LucideIcon }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.18 }}
      className="rounded-lg border border-rose-900/40 bg-rose-950/10 p-3 text-rose-200">
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-rose-700">
        <span>{label}</span><Icon className="h-3.5 w-3.5" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}
