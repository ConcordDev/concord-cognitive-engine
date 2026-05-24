'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Search, X, Loader2, MessageSquare, Clock } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useViewport } from '@/hooks/useViewport';

export interface ThreadHit {
  threadId: string;
  title: string;
  snippet: string;
  projectId: string | null;
  lastMsgAt: string;
  indexedAt: string;
  score: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (threadId: string) => void;
  projectId?: string | null;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Math.max(0, now - then);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

export function ThreadSearchOverlay({ open, onClose, onSelect, projectId }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ThreadHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [totalIndexed, setTotalIndexed] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Phase 12 (Item C5) — collapse to a bottom sheet on touch viewports.
  const { isMobile, isTouch } = useViewport();
  const useSheet = isMobile || isTouch;

  useEffect(() => {
    if (open) {
      setQuery('');
      setHits([]);
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const search = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'chat',
        action: 'threads-search',
        input: { query: trimmed, projectId: projectId || undefined, limit: 30 },
      });
      const result = (res.data as {
        result?: { hits?: ThreadHit[]; totalIndexed?: number };
      })?.result;
      setHits(result?.hits || []);
      setTotalIndexed(result?.totalIndexed || 0);
      setActiveIdx(0);
    } catch (e) {
      console.error('[ThreadSearchOverlay] search failed', e);
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(query), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(hits.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && hits[activeIdx]) {
      e.preventDefault();
      onSelect(hits[activeIdx].threadId);
      onClose();
    }
  };

  if (!open) return null;

  // Mobile: render as a bottom sheet (full-width, ~85vh, swipeable).
  // Desktop: keep the centered overlay with click-outside dismiss.
  const containerClasses = useSheet
    ? 'fixed inset-x-0 bottom-0 z-50 px-0 bg-black/60 backdrop-blur-sm flex items-end'
    : 'fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/60 backdrop-blur-sm';
  const panelClasses = useSheet
    ? 'w-full max-h-[85vh] bg-[#0d1117] border-t border-cyan-500/30 rounded-t-2xl shadow-2xl overflow-hidden flex flex-col'
    : 'w-full max-w-[640px] bg-[#0d1117] border border-cyan-500/30 rounded-xl shadow-2xl overflow-hidden flex flex-col';

  return (
    <div
      className={containerClasses}
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className={panelClasses}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
      >
        <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
          <Search className="w-4 h-4 text-cyan-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={projectId ? 'Search this project…' : 'Search all conversations…'}
            className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 focus:outline-none"
          />
          {loading && <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/5 text-gray-400"
            aria-label="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="px-4 py-12 text-center">
              <Search className="w-8 h-8 mx-auto text-gray-700 mb-2" />
              <p className="text-xs text-gray-500">Start typing to search</p>
              <p className="text-[10px] text-gray-600 mt-1">
                {totalIndexed} thread{totalIndexed === 1 ? '' : 's'} indexed
              </p>
            </div>
          ) : hits.length === 0 && !loading ? (
            <div className="px-4 py-12 text-center">
              <MessageSquare className="w-8 h-8 mx-auto text-gray-700 mb-2" />
              <p className="text-xs text-gray-500">No matches</p>
              <p className="text-[10px] text-gray-600 mt-1">
                Try different keywords. Searching across {totalIndexed} threads.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {hits.map((h, i) => (
                <li key={h.threadId}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(h.threadId);
                      onClose();
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={cn(
                      'w-full text-left px-4 py-3 transition',
                      i === activeIdx ? 'bg-cyan-500/10' : 'hover:bg-white/5',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <MessageSquare className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-gray-100 truncate">
                            {h.title || 'Untitled conversation'}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{h.snippet}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-[10px] text-cyan-400 font-mono">×{h.score}</span>
                        <span className="text-[10px] text-gray-600 inline-flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {relativeTime(h.lastMsgAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-4 py-2 border-t border-white/10 flex items-center justify-between text-[10px] text-gray-600 bg-black/40">
          <div className="flex items-center gap-3">
            <span><kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5">↑↓</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5">↵</kbd> open</span>
            <span><kbd className="px-1 py-0.5 rounded border border-white/10 bg-white/5">esc</kbd> close</span>
          </div>
          {hits.length > 0 && <span>{hits.length} result{hits.length === 1 ? '' : 's'}</span>}
        </div>
      </div>
    </div>
  );
}

export default ThreadSearchOverlay;
