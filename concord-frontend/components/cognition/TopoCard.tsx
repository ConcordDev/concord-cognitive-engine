'use client';

import { motion } from 'framer-motion';
import { Eye } from 'lucide-react';

export function TopoCard({ label, value, hint, tone = 'ok' }: { label: string; value: number | string; hint?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneCls = tone === 'bad' ? 'border-rose-700/40 text-rose-200'
                : tone === 'warn' ? 'border-yellow-700/40 text-yellow-200'
                : 'border-violet-900/40 text-violet-200';
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className={`rounded-lg border bg-violet-950/10 p-3 ${toneCls}`}
    >
      <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wider text-violet-700">
        <span>{label}</span><Eye className="h-3 w-3" aria-hidden />
      </div>
      <div className="font-mono text-xl font-semibold">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-violet-700">{hint}</div>}
    </motion.div>
  );
}
