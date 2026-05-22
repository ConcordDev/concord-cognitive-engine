/* eslint-disable @next/next/no-img-element */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Bookmark, Plus, X, Loader2, Lock, FolderOpen, ImageIcon, ChevronLeft,
} from 'lucide-react';

interface Collection {
  id: string; userId: string; name: string; description: string;
  isPrivate: boolean; projectIds: string[]; itemCount: number; createdAt: string;
}
interface BoardProject {
  id: string; title: string; discipline: string; coverUrl: string;
  images: { url: string }[]; views: number; appreciations?: number;
}
interface OwnProject { id: string; title: string }

export function Collections() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [boardItems, setBoardItems] = useState<BoardProject[]>([]);
  const [boardCollection, setBoardCollection] = useState<Collection | null>(null);
  const [ownProjects, setOwnProjects] = useState<OwnProject[]>([]);

  const [cName, setCName] = useState('');
  const [cDesc, setCDesc] = useState('');
  const [cPrivate, setCPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, p] = await Promise.all([
      lensRun('artistry', 'collectionList', {}),
      lensRun('artistry', 'projectList', {}),
    ]);
    setCollections((c.data?.result?.collections as Collection[]) || []);
    setOwnProjects(((p.data?.result?.projects as OwnProject[]) || []).map((x) => ({ id: x.id, title: x.title })));
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const create = useCallback(async () => {
    if (!cName.trim()) return;
    setSaving(true);
    const r = await lensRun('artistry', 'collectionCreate', {
      name: cName, description: cDesc, isPrivate: cPrivate,
    });
    setSaving(false);
    if (r.data?.ok) {
      setShowCreate(false); setCName(''); setCDesc(''); setCPrivate(false); load();
    }
  }, [cName, cDesc, cPrivate, load]);

  const openBoard = useCallback(async (id: string) => {
    setOpenId(id);
    setBoardItems([]);
    setBoardCollection(null);
    const r = await lensRun('artistry', 'collectionItems', { collectionId: id });
    if (r.data?.ok) {
      setBoardItems((r.data.result.items as BoardProject[]) || []);
      setBoardCollection(r.data.result.collection as Collection);
    }
  }, []);

  const toggleSave = useCallback(async (collectionId: string, projectId: string) => {
    await lensRun('artistry', 'collectionSave', { collectionId, projectId });
    if (openId === collectionId) openBoard(collectionId);
    load();
  }, [openId, openBoard, load]);

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-neon-pink" /></div>;
  }

  // Board detail view
  if (openId && boardCollection) {
    const savedSet = new Set(boardCollection.projectIds);
    return (
      <div className="space-y-4">
        <button onClick={() => { setOpenId(null); setBoardCollection(null); }} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to collections
        </button>
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            {boardCollection.isPrivate && <Lock className="w-4 h-4 text-yellow-500" />}
            {boardCollection.name}
          </h2>
          {boardCollection.description && <p className="text-sm text-gray-400 mt-1">{boardCollection.description}</p>}
        </div>
        {boardItems.length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">No projects saved to this board yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boardItems.map((p) => (
              <div key={p.id} className="bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                <div className="aspect-video bg-white/5 flex items-center justify-center overflow-hidden">
                  {(p.coverUrl || p.images?.[0]?.url)
                    ? <img src={p.coverUrl || p.images[0].url} alt={p.title} className="w-full h-full object-cover" />
                    : <ImageIcon className="w-7 h-7 text-gray-600" />}
                </div>
                <div className="p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm truncate">{p.title}</h3>
                    <div className="text-[11px] text-gray-500 capitalize">{p.discipline}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add own projects to board */}
        {ownProjects.length > 0 && (
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">Save your projects to this board</h4>
            <div className="flex flex-wrap gap-1.5">
              {ownProjects.map((op) => (
                <button
                  key={op.id}
                  onClick={() => toggleSave(boardCollection.id, op.id)}
                  className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    savedSet.has(op.id)
                      ? 'bg-neon-pink/20 border-neon-pink/30 text-neon-pink'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-neon-pink/30'
                  }`}
                >
                  <Bookmark className={`w-3 h-3 inline mr-1 ${savedSet.has(op.id) ? 'fill-neon-pink' : ''}`} />
                  {op.title}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Collections list view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Bookmark className="w-5 h-5 text-neon-pink" /> Collections
        </h2>
        <button onClick={() => setShowCreate(true)} className="px-3 py-1.5 text-xs bg-neon-pink/20 border border-neon-pink/30 rounded-lg hover:bg-neon-pink/30 flex items-center gap-1">
          <Plus className="w-3 h-3" /> New Board
        </button>
      </div>

      {collections.length === 0 ? (
        <div className="text-center py-12 text-gray-500 text-sm">No collections yet. Create a board to save projects.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {collections.map((c) => (
            <button key={c.id} onClick={() => openBoard(c.id)} className="bg-white/5 border border-white/10 rounded-lg p-4 text-left hover:border-neon-pink/30 transition-colors">
              <div className="flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-neon-pink" />
                <h3 className="font-medium text-sm truncate flex-1">{c.name}</h3>
                {c.isPrivate && <Lock className="w-3 h-3 text-yellow-500" />}
              </div>
              {c.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{c.description}</p>}
              <div className="text-[11px] text-gray-500 mt-2">{c.itemCount} {c.itemCount === 1 ? 'project' : 'projects'}</div>
            </button>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-900 border border-white/10 rounded-lg p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-semibold">New Collection</h3>
              <button onClick={() => setShowCreate(false)} aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <input value={cName} onChange={(e) => setCName(e.target.value)} placeholder="Collection name" className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <textarea value={cDesc} onChange={(e) => setCDesc(e.target.value)} placeholder="Description (optional)" rows={2} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm" />
              <label className="flex items-center gap-2 text-sm text-gray-300">
                <input type="checkbox" checked={cPrivate} onChange={(e) => setCPrivate(e.target.checked)} /> Private board
              </label>
              <button onClick={create} disabled={saving || !cName.trim()} className="w-full py-2 bg-neon-pink/20 rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Collection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
