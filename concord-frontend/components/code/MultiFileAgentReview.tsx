'use client';

import { useState } from 'react';
import { Sparkles, X, Check, RotateCcw, Loader2, FileCode, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { cn } from '@/lib/utils';

const MonacoDiffViewer = dynamic(() => import('./MonacoDiffViewer'), { ssr: false });

export interface MultiFileEdit {
  filename: string;
  scriptId?: string;
  language: string;
  before: string;
  after: string;
  reason?: string;
  status?: 'pending' | 'accepted' | 'rejected';
}

interface MultiFileAgentReviewProps {
  open: boolean;
  onClose: () => void;
  prompt: string;
  edits: MultiFileEdit[];
  loading?: boolean;
  onApply: (acceptedEdits: MultiFileEdit[]) => Promise<void>;
  onRegenerate?: () => void;
}

export function MultiFileAgentReview({ open, onClose, prompt, edits, loading, onApply, onRegenerate }: MultiFileAgentReviewProps) {
  const [statuses, setStatuses] = useState<Record<string, 'pending' | 'accepted' | 'rejected'>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(edits[0] ? [keyFor(edits[0])] : []));
  const [applying, setApplying] = useState(false);

  const setStatus = (k: string, s: 'pending' | 'accepted' | 'rejected') => {
    setStatuses(prev => ({ ...prev, [k]: s }));
  };

  const acceptAll = () => {
    const next: Record<string, 'pending' | 'accepted' | 'rejected'> = {};
    for (const e of edits) next[keyFor(e)] = 'accepted';
    setStatuses(next);
  };

  const rejectAll = () => {
    const next: Record<string, 'pending' | 'accepted' | 'rejected'> = {};
    for (const e of edits) next[keyFor(e)] = 'rejected';
    setStatuses(next);
  };

  const toggle = (k: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const accepted = edits.filter(e => statuses[keyFor(e)] === 'accepted');

  async function handleApply() {
    if (accepted.length === 0) return;
    setApplying(true);
    try {
      await onApply(accepted);
      onClose();
    } finally {
      setApplying(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => { if (!applying) onClose(); }}
        >
          <motion.div
            initial={{ y: -16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -16, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-full max-w-6xl max-h-[88vh] bg-[#0d1117] border border-purple-500/40 rounded-xl shadow-2xl shadow-purple-500/20 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-title"
          >
            <header className="px-4 py-3 border-b border-purple-500/20 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-purple-400 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <h2 id="agent-title" className="text-sm font-bold text-white">AI Agent · multi-file plan</h2>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{prompt}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onRegenerate && (
                  <button
                    onClick={onRegenerate}
                    disabled={loading}
                    title="Regenerate plan"
                    className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10"
                  >
                    <RotateCcw className={cn('w-4 h-4', loading && 'animate-spin')} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  disabled={applying}
                  aria-label="Close"
                  className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </header>

            <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 bg-[#0a0e17]">
              <span className="text-[11px] text-gray-400">
                {edits.length} file{edits.length === 1 ? '' : 's'} · {accepted.length} accepted
              </span>
              <button
                onClick={acceptAll}
                disabled={loading || edits.length === 0}
                className="ml-auto px-2 py-0.5 text-[11px] rounded border border-green-500/40 text-green-400 hover:bg-green-500/10 disabled:opacity-50"
              >
                Accept all
              </button>
              <button
                onClick={rejectAll}
                disabled={loading || edits.length === 0}
                className="px-2 py-0.5 text-[11px] rounded border border-red-500/40 text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                Reject all
              </button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3">
                  <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                  <p className="text-xs text-gray-500">Planning multi-file edits…</p>
                </div>
              ) : edits.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2 text-gray-500">
                  <Sparkles className="w-8 h-8 opacity-30" />
                  <p className="text-xs">The agent didn't propose any file edits.</p>
                </div>
              ) : (
                <ul className="divide-y divide-white/5">
                  {edits.map((e) => {
                    const k = keyFor(e);
                    const status = statuses[k] || 'pending';
                    const isOpen = expanded.has(k);
                    const before = (e.before || '').split('\n');
                    const after = (e.after || '').split('\n');
                    return (
                      <li key={k}>
                        <div className={cn(
                          'px-4 py-2 flex items-center gap-2',
                          status === 'accepted' && 'bg-green-500/[0.06]',
                          status === 'rejected' && 'bg-red-500/[0.06] opacity-60',
                        )}>
                          <button
                            onClick={() => toggle(k)}
                            className="text-gray-500 hover:text-white"
                            aria-label={isOpen ? 'Collapse' : 'Expand'}
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <FileCode className="w-4 h-4 text-cyan-400" />
                          <span className="text-sm text-white font-mono">{e.filename}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{e.language}</span>
                          <span className="ml-3 text-[10px] text-green-400">+{after.length}</span>
                          <span className="text-[10px] text-red-400">−{before.length}</span>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              onClick={() => setStatus(k, status === 'rejected' ? 'pending' : 'rejected')}
                              title="Reject"
                              className={cn(
                                'p-1.5 rounded border',
                                status === 'rejected'
                                  ? 'bg-red-500/20 border-red-500/50 text-red-300'
                                  : 'border-white/10 text-gray-400 hover:text-red-400 hover:border-red-500/40'
                              )}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setStatus(k, status === 'accepted' ? 'pending' : 'accepted')}
                              title="Accept"
                              className={cn(
                                'p-1.5 rounded border',
                                status === 'accepted'
                                  ? 'bg-green-500/20 border-green-500/50 text-green-300'
                                  : 'border-white/10 text-gray-400 hover:text-green-400 hover:border-green-500/40'
                              )}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                        {e.reason && isOpen && (
                          <p className="px-12 pb-2 text-[11px] text-purple-300 italic">{e.reason}</p>
                        )}
                        {isOpen && (
                          <div className="px-4 pb-3">
                            <MonacoDiffViewer
                              original={e.before}
                              modified={e.after}
                              language={e.language}
                              height={Math.max(180, Math.min(480, (before.length + after.length) * 16))}
                              renderSideBySide
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="px-4 py-3 border-t border-white/10 bg-[#0a0e17] flex items-center justify-between gap-3">
              <span className="text-[11px] text-gray-400">
                {accepted.length === 0 ? 'No edits selected to apply' : `Will apply ${accepted.length} edit${accepted.length === 1 ? '' : 's'}`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={applying}
                  className="px-3 py-1.5 text-xs rounded border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-50"
                >Cancel</button>
                <button
                  onClick={handleApply}
                  disabled={applying || accepted.length === 0}
                  className="px-4 py-1.5 text-xs font-bold rounded bg-purple-500 hover:bg-purple-400 text-white disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {applying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Apply {accepted.length}
                </button>
              </div>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function keyFor(e: MultiFileEdit): string {
  return `${e.scriptId || ''}::${e.filename}`;
}

export default MultiFileAgentReview;
