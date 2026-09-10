'use client';

/**
 * CollectionPanel — personal poem notebook list (poetry.poem-list substrate).
 * Search is server-side (title + body); form filter is client-side.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { motion } from 'framer-motion';
import { BookOpen, Download, Edit2, Feather, Search, Trash2 } from 'lucide-react';
import { api, lensRun } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { ErrorState } from '@/components/common/EmptyState';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import {
  POEM_FORMS,
  type PoemDetail,
  type PoemForm,
  type PoemMeta,
} from '@/components/poetry/poetry-craft';

export interface CollectionPanelProps {
  onOpenPoem: (id: string) => void;
  onNewPoem: () => void;
  searchInputRef?: RefObject<HTMLInputElement>;
}

export function CollectionPanel({ onOpenPoem, onNewPoem, searchInputRef }: CollectionPanelProps) {
  const [poems, setPoems] = useState<PoemMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [loadErrorMsg, setLoadErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [formFilter, setFormFilter] = useState<PoemForm | null>(null);
  const localSearchRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? localSearchRef;

  const refetch = useCallback(async (query?: string) => {
    setIsLoading(true);
    try {
      const params: Record<string, unknown> = {};
      const q = query?.trim();
      if (q) params.query = q;
      const r = await lensRun('poetry', 'poem-list', params);
      if (r.data?.ok) {
        setPoems((r.data.result?.poems as PoemMeta[]) || []);
        setIsError(false);
        setLoadErrorMsg(null);
      } else {
        setIsError(true);
        setLoadErrorMsg(r.data?.error || 'Failed to load poems');
      }
    } catch (err) {
      setIsError(true);
      setLoadErrorMsg(err instanceof Error ? err.message : 'Failed to load poems');
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void refetch(searchQuery); }, searchQuery ? 250 : 0);
    return () => clearTimeout(t);
  }, [searchQuery, refetch]);

  const filteredPoems = useMemo(() => {
    if (!formFilter) return poems;
    return poems.filter((p) => p.form === formFilter);
  }, [poems, formFilter]);

  const deletePoem = useCallback(async (id: string) => {
    try {
      await lensRun('poetry', 'poem-delete', { id });
      await refetch(searchQuery);
    } catch (err) {
      console.error('[Poetry] Failed to delete poem:', err);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to delete poem' });
    }
  }, [refetch, searchQuery]);

  const mintPoem = useCallback(async (id: string) => {
    const detail = await lensRun('poetry', 'poem-detail', { id });
    if (!detail.data?.ok || !detail.data.result?.poem) {
      useUIStore.getState().addToast({ type: 'error', message: 'Could not load poem' });
      return;
    }
    const p = detail.data.result.poem as PoemDetail;
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'dtu', name: 'create',
        input: withContentLicense({
          title: `Poem — ${p.title}`,
          creti: `${p.title}\n\n${p.body}`,
          tags: ['poetry', p.form].filter(Boolean),
          source: 'poetry:poem:mint',
          meta: { visibility: 'private' },
        }, 'media', ['private']),
      });
      const dtuId = res.data?.result?.dtu?.id ?? res.data?.dtu?.id;
      if (dtuId) useUIStore.getState().addToast({ type: 'success', message: 'Poem minted to your substrate' });
      else useUIStore.getState().addToast({ type: 'error', message: 'Mint failed' });
    } catch (err) {
      console.error('[Poetry] Mint failed:', err);
      useUIStore.getState().addToast({ type: 'error', message: 'Mint failed' });
    }
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-rose-400" /> Collection
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Your notebook — same store Workshop and Studio read from.
            {isLoading && <span className="ml-2 text-rose-400">Loading…</span>}
          </p>
        </div>
      </div>

      {isError && <ErrorState error={loadErrorMsg || undefined} onRetry={() => refetch(searchQuery)} />}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search poems..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-rose-500/50"
          />
        </div>
        <select
          value={formFilter || ''}
          onChange={(e) => setFormFilter((e.target.value || null) as PoemForm | null)}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm"
        >
          <option value="">All forms</option>
          {POEM_FORMS.map((f) => (
            <option key={f.id} value={f.id}>{f.label}</option>
          ))}
        </select>
      </div>

      {filteredPoems.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Feather className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No poems yet. Begin composing.</p>
          <button
            type="button"
            onClick={onNewPoem}
            className="mt-3 px-4 py-2 text-xs bg-rose-500/20 rounded-lg hover:bg-rose-500/30"
          >
            Compose
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPoems.map((poem) => (
            <motion.div
              key={poem.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-white/5 border border-white/10 rounded-lg p-4 hover:border-rose-500/30 transition-colors cursor-pointer"
              onClick={() => onOpenPoem(poem.id)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-sm italic">{poem.title}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>{poem.form || 'free-verse'}</span>
                    <span>{poem.lineCount || 0} lines</span>
                    <span className="capitalize">{poem.status}</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); mintPoem(poem.id); }}
                    className="p-1 hover:bg-white/10 rounded"
                    aria-label="Mint as DTU"
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenPoem(poem.id); }}
                    className="p-1 hover:bg-white/10 rounded"
                    aria-label="Edit"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); deletePoem(poem.id); }}
                    className="p-1 hover:bg-white/10 rounded text-red-400"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
