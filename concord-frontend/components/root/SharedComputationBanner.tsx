'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link2, X } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import type { ReloadPayload } from './ComputationNotebook';

interface ShareSnapshot {
  shareId: string;
  kind: 'operation' | 'expression' | 'bitwise';
  a?: number | string;
  b?: number | string | null;
  op?: string;
  expression?: string;
  label: string;
  resultGlyph: string | null;
  resultDecimal: number | null;
  sharedBy: string;
  sharedAt: string;
}

/* Resolves a ?share=<id> URL param via root.getShare and surfaces the shared
   computation with a one-click "open in playground" action. */
export function SharedComputationBanner({ onOpen }: { onOpen?: (p: ReloadPayload) => void }) {
  const [snapshot, setSnapshot] = useState<ShareSnapshot | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const resolve = useCallback(async (shareId: string) => {
    const r = await lensRun<{ snapshot: ShareSnapshot }>('root', 'getShare', { shareId });
    if (r.data?.ok && r.data.result) setSnapshot(r.data.result.snapshot);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('share');
    if (id) void resolve(id);
  }, [resolve]);

  if (!snapshot || dismissed) return null;

  const open = () => {
    if (snapshot.kind === 'expression') {
      onOpen?.({ kind: 'expression', expression: snapshot.expression || '' });
    } else {
      onOpen?.({
        kind: snapshot.kind,
        a: snapshot.a != null ? String(snapshot.a) : '',
        b: snapshot.b != null ? String(snapshot.b) : '',
        op: snapshot.op || '+',
      });
    }
    setDismissed(true);
  };

  return (
    <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className="bg-violet-950/40 border border-violet-800/50 rounded-xl p-4 flex items-center gap-3">
      <Link2 className="w-5 h-5 text-violet-300 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-violet-200">Shared computation</div>
        <div className="text-xs text-gray-400 font-mono truncate">
          {snapshot.label || snapshot.expression || `${snapshot.a} ${snapshot.op} ${snapshot.b ?? ''}`}
          {snapshot.resultGlyph && <span className="text-violet-300"> → {snapshot.resultGlyph}</span>}
        </div>
      </div>
      <button onClick={open}
        className="text-xs px-3 py-1.5 bg-violet-700/60 hover:bg-violet-700/80 border border-violet-700 rounded text-violet-100 shrink-0">
        Open in playground
      </button>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss"
        className="p-1 text-gray-400 hover:text-gray-300">
        <X className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
