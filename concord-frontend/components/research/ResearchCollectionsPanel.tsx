'use client';

/**
 * ResearchCollectionsPanel — organise references into collections.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, FolderOpen, Trash2, ChevronRight } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Collection { id: string; name: string; referenceCount: number }
interface Reference { id: string; title: string; authors: string | null; year: number | null }

export function ResearchCollectionsPanel({ onChange }: { onChange: () => void }) {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [allRefs, setAllRefs] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [openRefs, setOpenRefs] = useState<Reference[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, r] = await Promise.all([
      lensRun('research', 'collection-list', {}),
      lensRun('research', 'reference-list', {}),
    ]);
    setCollections(c.data?.result?.collections || []);
    setAllRefs(r.data?.result?.references || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    if (!name.trim()) { setError('Collection name is required.'); return; }
    const r = await lensRun('research', 'collection-create', { name: name.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setName(''); setError(null);
    await refresh(); onChange();
  };
  const openCollection = async (id: string) => {
    if (open === id) { setOpen(null); return; }
    setOpen(id);
    const r = await lensRun('research', 'collection-detail', { id });
    setOpenRefs(r.data?.ok === false ? [] : (r.data?.result?.references || []));
  };
  const toggleRef = async (collectionId: string, referenceId: string, inCol: boolean) => {
    await lensRun('research', 'collection-add-reference', { collectionId, referenceId, remove: inCol });
    const r = await lensRun('research', 'collection-detail', { id: collectionId });
    setOpenRefs(r.data?.result?.references || []);
    await refresh(); onChange();
  };
  const del = async (id: string) => {
    await lensRun('research', 'collection-delete', { id });
    if (open === id) setOpen(null);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New collection name"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={create}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Create
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {collections.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No collections. Group your references by project or topic.
        </div>
      ) : (
        <ul className="space-y-2">
          {collections.map((c) => (
            <li key={c.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl overflow-hidden">
              <div className="flex items-center">
                <button type="button" onClick={() => openCollection(c.id)}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-900">
                  <ChevronRight className={cn('w-4 h-4 text-zinc-600 transition-transform', open === c.id && 'rotate-90')} />
                  <FolderOpen className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-semibold text-zinc-100">{c.name}</span>
                  <span className="text-[11px] text-zinc-400">{c.referenceCount} references</span>
                </button>
                <button type="button" onClick={() => del(c.id)} aria-label={`Delete collection ${c.name}`} className="px-3 text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              {open === c.id && (
                <div className="border-t border-zinc-800 p-3 bg-zinc-950/50">
                  {allRefs.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic">No references in the library yet.</p>
                  ) : (
                    <ul className="space-y-1">
                      {allRefs.map((r) => {
                        const inCol = openRefs.some((x) => x.id === r.id);
                        return (
                          <li key={r.id}>
                            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                              <input type="checkbox" checked={inCol}
                                onChange={() => toggleRef(c.id, r.id, inCol)}
                                className="accent-red-500" />
                              <span className="truncate">{r.title} <span className="text-zinc-600">{r.year || ''}</span></span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
