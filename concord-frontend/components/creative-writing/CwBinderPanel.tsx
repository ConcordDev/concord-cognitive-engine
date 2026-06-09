'use client';

/**
 * CwBinderPanel — the chapter/scene binder and the scene editor. Scene
 * prose persists through scene-write.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2, Plus, FileText, Folder, ChevronUp, ChevronDown, Trash2, Save,
  Columns2, X, BookOpen,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Chapter { id: string; title: string; order: number }
interface Scene {
  id: string; projectId: string; chapterId: string | null; title: string;
  synopsis: string | null; status: string; content: string; wordCount: number;
  povCharacterId: string | null; order: number;
}
interface Character { id: string; name: string }
interface RefNote { id: string; title: string; kind: string; body: string }

const STATUS = ['outline', 'draft', 'revised', 'final'];
const STATUS_COLOR: Record<string, string> = {
  outline: 'text-zinc-400', draft: 'text-amber-400', revised: 'text-sky-400', final: 'text-emerald-400',
};

export function CwBinderPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>('');
  const [draft, setDraft] = useState<Scene | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [snapshots, setSnapshots] = useState<{ id: string; title: string; wordCount: number }[]>([]);
  const [comments, setComments] = useState<{ id: string; body: string }[]>([]);
  const [commentDraft, setCommentDraft] = useState('');
  // Split-screen reference pane.
  const [refOpen, setRefOpen] = useState(false);
  const [refMode, setRefMode] = useState<'scene' | 'note'>('scene');
  const [refSceneId, setRefSceneId] = useState('');
  const [refNotes, setRefNotes] = useState<RefNote[]>([]);
  const [refNoteId, setRefNoteId] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('creative-writing', 'project-get', { id: projectId });
    setChapters((r.data?.result?.chapters as Chapter[]) || []);
    setScenes((r.data?.result?.scenes as Scene[]) || []);
    setCharacters((r.data?.result?.characters as Character[]) || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const sc = scenes.find((x) => x.id === selected);
    setDraft(sc ? { ...sc } : null);
    setDirty(false);
  }, [selected, scenes]);

  const loadSceneExtras = useCallback(async () => {
    if (!selected) { setSnapshots([]); setComments([]); return; }
    const [snaps, cmts] = await Promise.all([
      lensRun('creative-writing', 'snapshot-list', { sceneId: selected }),
      lensRun('creative-writing', 'scene-comment-list', { sceneId: selected }),
    ]);
    setSnapshots(snaps.data?.result?.snapshots || []);
    setComments(cmts.data?.result?.comments || []);
  }, [selected]);

  useEffect(() => { void loadSceneExtras(); }, [loadSceneExtras]);

  // Load notes for the reference pane on first open.
  const loadRefNotes = useCallback(async () => {
    const r = await lensRun('creative-writing', 'note-list', { projectId });
    setRefNotes((r.data?.result?.notes as RefNote[]) || []);
  }, [projectId]);

  useEffect(() => { if (refOpen) void loadRefNotes(); }, [refOpen, loadRefNotes]);

  const takeSnapshot = async () => {
    if (!selected) return;
    await lensRun('creative-writing', 'snapshot-take', { sceneId: selected });
    await loadSceneExtras();
  };
  const restoreSnapshot = async (id: string) => {
    await lensRun('creative-writing', 'snapshot-restore', { id });
    await refresh();
  };
  const addComment = async () => {
    if (!selected || !commentDraft.trim()) return;
    await lensRun('creative-writing', 'scene-comment-add', { sceneId: selected, body: commentDraft.trim() });
    setCommentDraft('');
    await loadSceneExtras();
  };

  const addChapter = async () => {
    await lensRun('creative-writing', 'chapter-add', { projectId });
    await refresh();
  };
  const addScene = async (chapterId: string | null) => {
    const r = await lensRun('creative-writing', 'scene-add', { projectId, chapterId: chapterId || undefined });
    await refresh();
    if (r.data?.result?.scene?.id) setSelected(r.data.result.scene.id);
  };
  const delScene = async (id: string) => {
    await lensRun('creative-writing', 'scene-delete', { sceneId: id });
    if (selected === id) setSelected('');
    await refresh();
  };
  const delChapter = async (id: string) => {
    await lensRun('creative-writing', 'chapter-delete', { projectId, chapterId: id });
    await refresh();
  };
  const moveChapter = async (id: string, direction: 'up' | 'down') => {
    await lensRun('creative-writing', 'chapter-reorder', { chapterId: id, direction });
    await refresh();
  };
  const moveScene = async (id: string, direction: 'up' | 'down') => {
    await lensRun('creative-writing', 'scene-reorder', { sceneId: id, direction });
    await refresh();
  };

  const saveScene = async () => {
    if (!draft) return;
    setSaving(true);
    await lensRun('creative-writing', 'scene-update', {
      sceneId: draft.id, title: draft.title, synopsis: draft.synopsis || '',
      status: draft.status, povCharacterId: draft.povCharacterId,
    });
    await lensRun('creative-writing', 'scene-write', { sceneId: draft.id, content: draft.content });
    setSaving(false);
    setDirty(false);
    await refresh();
  };

  const liveWords = useMemo(
    () => (draft ? draft.content.split(/\s+/).filter(Boolean).length : 0), [draft]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const renderSceneRow = (sc: Scene) => (
    <li key={sc.id} className="group flex items-center gap-1">
      <button type="button" onClick={() => setSelected(sc.id)}
        className={cn('flex items-center gap-1.5 flex-1 text-left px-2 py-1 rounded text-xs',
          selected === sc.id ? 'bg-amber-600/30 text-amber-200' : 'text-zinc-300 hover:bg-zinc-800')}>
        <FileText className="w-3 h-3 shrink-0" />
        <span className="truncate flex-1">{sc.title}</span>
        <span className="text-[9px] text-zinc-400">{sc.wordCount}</span>
        <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_COLOR[sc.status].replace('text-', 'bg-'))} />
      </button>
      <div className="flex opacity-0 group-hover:opacity-100">
        <button aria-label="Collapse" type="button" onClick={() => moveScene(sc.id, 'up')} className="text-zinc-600 hover:text-zinc-300">
          <ChevronUp className="w-3 h-3" />
        </button>
        <button aria-label="Expand" type="button" onClick={() => moveScene(sc.id, 'down')} className="text-zinc-600 hover:text-zinc-300">
          <ChevronDown className="w-3 h-3" />
        </button>
        <button aria-label="Delete" type="button" onClick={() => delScene(sc.id)} className="text-zinc-600 hover:text-rose-400">
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </li>
  );

  const unfiled = scenes.filter((sc) => !sc.chapterId);
  const refScene = scenes.find((sc) => sc.id === refSceneId) || null;
  const refNote = refNotes.find((n) => n.id === refNoteId) || null;

  return (
    <div className={cn('grid grid-cols-1 gap-3',
      refOpen ? 'lg:grid-cols-[220px_1fr_300px]' : 'lg:grid-cols-[260px_1fr]')}>
      {/* Binder */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-300">Binder</h3>
          <button type="button" onClick={addChapter} className="text-zinc-400 hover:text-amber-300" title="Add chapter">
            <Plus className="w-4 h-4" />
          </button>
        </div>
        {chapters.length === 0 && unfiled.length === 0 && (
          <p className="text-[11px] text-zinc-400 italic">Add a chapter to start your binder.</p>
        )}
        {chapters.map((ch) => (
          <div key={ch.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-1.5">
            <div className="group flex items-center gap-1 px-1">
              <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-xs font-medium text-zinc-200 flex-1 truncate">{ch.title}</span>
              <div className="flex opacity-0 group-hover:opacity-100">
                <button aria-label="Collapse" type="button" onClick={() => moveChapter(ch.id, 'up')} className="text-zinc-600 hover:text-zinc-300">
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button aria-label="Expand" type="button" onClick={() => moveChapter(ch.id, 'down')} className="text-zinc-600 hover:text-zinc-300">
                  <ChevronDown className="w-3 h-3" />
                </button>
                <button aria-label="Delete" type="button" onClick={() => delChapter(ch.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            <ul className="mt-1 space-y-0.5">
              {scenes.filter((sc) => sc.chapterId === ch.id).map(renderSceneRow)}
            </ul>
            <button type="button" onClick={() => addScene(ch.id)}
              className="mt-1 flex items-center gap-1 text-[10px] text-zinc-400 hover:text-amber-300 px-1">
              <Plus className="w-3 h-3" /> Scene
            </button>
          </div>
        ))}
        {unfiled.length > 0 && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-1.5">
            <span className="text-[10px] text-zinc-400 px-1 uppercase">Unfiled</span>
            <ul className="mt-1 space-y-0.5">{unfiled.map(renderSceneRow)}</ul>
          </div>
        )}
        <button type="button" onClick={() => addScene(null)}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-amber-300 px-1">
          <Plus className="w-3 h-3" /> Unfiled scene
        </button>
      </div>

      {/* Editor */}
      <div>
        {!draft ? (
          <div className="flex items-center justify-center h-full min-h-[200px] text-[11px] text-zinc-400 italic border border-zinc-800 rounded-xl">
            Select a scene to write, or add one from the binder.
          </div>
        ) : (
          <div className="space-y-2">
            <input value={draft.title}
              onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setDirty(true); }}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-semibold text-zinc-100" />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <select value={draft.status}
                onChange={(e) => { setDraft({ ...draft, status: e.target.value }); setDirty(true); }}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
                {STATUS.map((st) => <option key={st} value={st}>{st}</option>)}
              </select>
              <select value={draft.povCharacterId || ''}
                onChange={(e) => { setDraft({ ...draft, povCharacterId: e.target.value || null }); setDirty(true); }}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">POV: none</option>
                {characters.map((c) => <option key={c.id} value={c.id}>POV: {c.name}</option>)}
              </select>
              <span className="flex items-center justify-end text-[11px] text-zinc-400">{liveWords} words</span>
            </div>
            <input placeholder="Synopsis (one-line card)" value={draft.synopsis || ''}
              onChange={(e) => { setDraft({ ...draft, synopsis: e.target.value }); setDirty(true); }}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-300" />
            <textarea value={draft.content} placeholder="Write your scene…"
              onChange={(e) => { setDraft({ ...draft, content: e.target.value }); setDirty(true); }}
              rows={16}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 leading-relaxed resize-y font-serif" />
            <div className="flex items-center gap-2">
              <button type="button" onClick={saveScene} disabled={!dirty || saving}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {dirty ? 'Save scene' : 'Saved'}
              </button>
              <button type="button" onClick={takeSnapshot}
                className="px-2.5 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Snapshot</button>
              <button type="button" onClick={() => setRefOpen((v) => !v)}
                className={cn('flex items-center gap-1 px-2.5 py-1.5 text-[11px] rounded-lg',
                  refOpen ? 'bg-amber-600/30 text-amber-200' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200')}>
                <Columns2 className="w-3.5 h-3.5" /> Reference
              </button>
            </div>

            {/* Snapshots */}
            {snapshots.length > 0 && (
              <div className="border-t border-zinc-800 pt-2">
                <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Snapshots</p>
                <ul className="space-y-0.5">
                  {snapshots.map((sn) => (
                    <li key={sn.id} className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <span className="flex-1 truncate">{sn.title}</span>
                      <span className="text-zinc-600">{sn.wordCount}w</span>
                      <button type="button" onClick={() => restoreSnapshot(sn.id)}
                        className="text-amber-400 hover:underline">restore</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Comments */}
            <div className="border-t border-zinc-800 pt-2">
              <p className="text-[10px] font-semibold text-zinc-400 uppercase mb-1">Comments</p>
              <ul className="space-y-1 mb-1.5">
                {comments.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-[11px] bg-zinc-950/60 rounded px-2 py-1">
                    <span className="flex-1 text-zinc-300">{c.body}</span>
                    <button type="button"
                      onClick={() => lensRun('creative-writing', 'scene-comment-delete', { id: c.id }).then(loadSceneExtras)}
                      className="text-zinc-600 hover:text-rose-400">×</button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <input placeholder="Add an annotation" value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void addComment(); }}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-100" />
                <button type="button" onClick={addComment}
                  className="px-2.5 py-1 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">Add</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Split-screen reference pane */}
      {refOpen && (
        <aside className="border border-zinc-800 rounded-xl bg-zinc-900/70 p-3 space-y-2 lg:max-h-[640px] lg:overflow-auto">
          <div className="flex items-center gap-2">
            <BookOpen className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold text-zinc-200 flex-1">Reference</span>
            <button type="button" onClick={() => setRefOpen(false)} className="text-zinc-600 hover:text-zinc-300">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => setRefMode('scene')}
              className={cn('flex-1 text-[11px] px-2 py-1 rounded-lg',
                refMode === 'scene' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>Scene</button>
            <button type="button" onClick={() => setRefMode('note')}
              className={cn('flex-1 text-[11px] px-2 py-1 rounded-lg',
                refMode === 'note' ? 'bg-amber-600 text-white' : 'bg-zinc-800 text-zinc-300')}>Note</button>
          </div>
          {refMode === 'scene' ? (
            <>
              <select value={refSceneId} onChange={(e) => setRefSceneId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">Pick a scene to view…</option>
                {scenes.filter((sc) => sc.id !== selected).map((sc) => (
                  <option key={sc.id} value={sc.id}>{sc.title}</option>
                ))}
              </select>
              {refScene ? (
                <article className="text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed font-serif">
                  <p className="text-zinc-400 italic mb-1">{refScene.synopsis || 'No synopsis'}</p>
                  {refScene.content || <span className="text-zinc-600 italic">Empty scene.</span>}
                </article>
              ) : (
                <p className="text-[10px] text-zinc-400 italic">Select a scene to read it side-by-side while you write.</p>
              )}
            </>
          ) : (
            <>
              <select value={refNoteId} onChange={(e) => setRefNoteId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                <option value="">Pick a research note…</option>
                {refNotes.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
              </select>
              {refNote ? (
                <article className="text-[11px] text-zinc-300 whitespace-pre-wrap leading-relaxed">
                  <p className="text-[9px] uppercase text-amber-400 mb-1">{refNote.kind}</p>
                  {refNote.body || <span className="text-zinc-600 italic">No content.</span>}
                </article>
              ) : (
                <p className="text-[10px] text-zinc-400 italic">
                  {refNotes.length ? 'Select a note to view it.' : 'No research notes yet — add them in the Research tab.'}
                </p>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  );
}
