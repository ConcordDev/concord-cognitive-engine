'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Square, BookOpen, ThumbsUp, Trash2, Save, Plus, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui';
import { PublishAsBlueprintDialog } from './PublishAsBlueprintDialog';
import { commitDeletedBoard } from './boardOwner';

export interface Template {
  id: string;
  name: string;
  elementCount: number;
}

export interface Board {
  id: string;
  title: string;
  elementCount?: number;
  createdAt: string;
  updatedAt: string;
  origin?: string;
  deletedAt?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'boards' | 'templates' | 'voting';

export function WhiteboardWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('boards');

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[560px] max-w-[100vw] z-40 bg-lattice-deep border-l border-sky-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-sky-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <Square className="w-4 h-4 text-sky-400" />
          <span className="text-sm font-semibold text-gray-200">Whiteboard Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1">
        {([
          { id: 'boards',    label: 'Boards',    icon: Square },
          { id: 'templates', label: 'Templates', icon: BookOpen },
          { id: 'voting',    label: 'Voting',    icon: ThumbsUp },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-sky-500/15 text-sky-200 border border-sky-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'boards' && <BoardsTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'voting' && <VotingTab />}
      </div>
    </div>
  );
}

function BoardsTab() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [publishingBoardId, setPublishingBoardId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string; isCanvas: boolean } | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [trashBoards, setTrashBoards] = useState<Board[]>([]);
  const [confirmForeverId, setConfirmForeverId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'board-list', input: {} });
      setBoards(((r.data as { result?: { boards?: Board[] } }).result?.boards) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-save', input: { title, scene: { elements: [], appState: {} } } });
      setCreating(false); setTitle('');
      await refresh();
    } catch (e) { console.error(e); }
  };

  const loadTrash = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'boards-trash-list', input: {} });
      setTrashBoards(((r.data as { result?: { boards?: Board[] } }).result?.boards) || []);
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => { void loadTrash(); }, [loadTrash]);

  // S2: two-step inline confirm (the native confirm() never surfaces in
  // embedded browsers), soft delete now, hard commit after the Undo
  // window lapses.
  const remove = async (b: Board) => {
    if (confirmDeleteId !== b.id) { setConfirmDeleteId(b.id); return; }
    setConfirmDeleteId(null);
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-delete', input: { id: b.id } });
      setBoards((prev) => prev.filter((x) => x.id !== b.id));
      void loadTrash();
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      const pending = { id: b.id, title: b.title, isCanvas: b.origin === 'canvas' };
      setPendingDelete(pending);
      deleteTimerRef.current = setTimeout(() => {
        setPendingDelete(null);
        void commitDeletedBoard(pending.id, pending.isCanvas).then(() => { void loadTrash(); });
      }, 12000);
    } catch (e) { console.error(e); }
  };

  const undoDelete = async () => {
    if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    const pending = pendingDelete;
    setPendingDelete(null);
    if (!pending) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-restore', input: { id: pending.id } });
    } catch (e) { console.error(e); }
    await refresh();
    void loadTrash();
  };

  const restoreFromTrash = async (id: string) => {
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-restore', input: { id } });
    } catch (e) { console.error(e); }
    await refresh();
    void loadTrash();
  };

  const deleteForever = async (b: Board) => {
    if (confirmForeverId !== b.id) { setConfirmForeverId(b.id); return; }
    setConfirmForeverId(null);
    await commitDeletedBoard(b.id, b.origin === 'canvas');
    void loadTrash();
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-sky-500/30 bg-sky-500/10 text-xs text-sky-200">
        <Plus className="w-3 h-3" /> New board
      </button>
      {creating && (
        <div className="rounded border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Board title" maxLength={80}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <button type="button" onClick={save} disabled={!title.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Create
          </button>
        </div>
      )}
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton variant="block" height={54} />
          <Skeleton variant="block" height={54} />
          <Skeleton variant="block" height={54} />
        </div>
      ) :
        boards.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No boards. Create one or load a template.</p> :
        boards.map((b) => (
          <div key={b.id} className="rounded border border-white/10 bg-black/20 p-3 group flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-100">{b.title}</p>
              <p className="text-[10px] text-gray-400 tabular-nums">{b.elementCount} elements · {new Date(b.updatedAt).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPublishingBoardId(b.id)}
                title="Publish as Concordia building blueprint"
                className="p-1 text-gray-500 hover:text-violet-300 opacity-0 group-hover:opacity-100"><Upload className="w-3 h-3" /></button>
              {confirmDeleteId === b.id ? (
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => { void remove(b); }} className="px-1.5 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/10 rounded">Delete?</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="px-1.5 py-0.5 text-[11px] text-gray-400 hover:bg-white/[0.05] rounded">Cancel</button>
                </span>
              ) : (
                <button aria-label="Delete" type="button" onClick={() => setConfirmDeleteId(b.id)}
                  className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
              )}
            </div>
          </div>
        ))
      }
      {pendingDelete && (
        <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-zinc-900 px-3 py-2" role="status">
          <span className="text-xs text-zinc-300">Board “{pendingDelete.title}” deleted.</span>
          <button type="button" onClick={() => { void undoDelete(); }} className="text-xs font-medium text-teal-300 hover:text-teal-200">Undo</button>
        </div>
      )}
      <div className="pt-1">
        <button type="button" onClick={() => { const next = !showTrash; setShowTrash(next); if (next) void loadTrash(); }} className="text-[11px] text-zinc-500 hover:text-zinc-300">
          {showTrash ? '▾' : '▸'} Trash{trashBoards.length > 0 ? ` (${trashBoards.length})` : ''}
        </button>
        {showTrash && (
          <div className="mt-1 space-y-1">
            {trashBoards.length === 0 ? (
              <p className="py-1 text-[11px] text-zinc-500">Trash is empty.</p>
            ) : trashBoards.map((b) => (
              <div key={b.id} className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-black/20 px-2.5 py-1.5">
                <span className="min-w-0">
                  <span className="block truncate text-xs text-zinc-300">{b.title}</span>
                  <span className="block text-[10px] tabular-nums text-zinc-500">{b.elementCount ?? 0} elements</span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => { void restoreFromTrash(b.id); }} className="rounded px-1.5 py-0.5 text-[11px] text-teal-300 hover:bg-white/[0.05]">Restore</button>
                  {confirmForeverId === b.id ? (
                    <>
                      <button type="button" onClick={() => { void deleteForever(b); }} className="rounded px-1.5 py-0.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/10">Delete forever</button>
                      <button type="button" onClick={() => setConfirmForeverId(null)} className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-white/[0.05]">Cancel</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmForeverId(b.id)} className="rounded px-1.5 py-0.5 text-[11px] text-rose-300/80 hover:bg-white/[0.05]">Delete forever</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      {publishingBoardId && (
        <PublishAsBlueprintDialog
          boardId={publishingBoardId}
          onClose={() => setPublishingBoardId(null)}
        />
      )}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'whiteboard', action: 'templates-list', input: {} });
        setTemplates(((r.data as { result?: { templates?: Template[] } }).result?.templates) || []);
      } catch (e) { console.error(e); }
    })();
  }, []);

  const apply = async (id: string, name: string) => {
    try {
      const t = await lensRun({ domain: 'whiteboard', action: 'template-load', input: { id } });
      const template = ((t.data as { result?: { template?: { elements: unknown[] } } }).result?.template);
      if (!template) return;
      await lensRun({
        domain: 'whiteboard', action: 'board-save',
        input: { title: name, scene: { elements: template.elements, appState: {} } },
      });
      alert(`Created "${name}" board from template`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <p className="text-[11px] text-gray-400">Click a template to create a new board.</p>
      {templates.length === 0 ? (
        <p className="text-center text-xs text-gray-400 py-8">No templates available.</p>
      ) : templates.map((t) => (
        <button key={t.id} type="button" onClick={() => apply(t.id, t.name)}
          className="w-full text-left rounded border border-white/10 bg-black/20 p-3 hover:bg-white/5">
          <p className="text-sm font-medium text-gray-100">{t.name}</p>
          <p className="text-[11px] text-gray-400 tabular-nums">{t.elementCount} starter elements</p>
        </button>
      ))}
    </div>
  );
}

function VotingTab() {
  // S8: pickers fed by real boards/elements replace the raw id text
  // fields — you can only vote on something that exists (and the
  // server now enforces the same rule).
  const [boards, setBoards] = useState<Board[]>([]);
  const [boardId, setBoardId] = useState('');
  const [elements, setElements] = useState<Array<{ id: string; label: string }>>([]);
  const [elementId, setElementId] = useState('');
  const [tally, setTally] = useState<{ elementId: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'whiteboard', action: 'board-list', input: {} });
        const list = ((r.data as { result?: { boards?: Board[] } }).result?.boards || []) as Board[];
        setBoards(list);
        if (list.length > 0) setBoardId((prev) => prev || list[0].id);
      } catch (e) { console.error(e); }
    })();
  }, []);

  const refresh = useCallback(async (forBoard: string, els: Array<{ id: string; label: string }>) => {
    if (!forBoard) return;
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'vote-tally', input: { boardId: forBoard } });
      const data = (r.data as { result?: { tally?: typeof tally; total?: number } }).result;
      setTally(data?.tally || []);
      setTotal(data?.total || 0);
      void els;
    } catch (e) { console.error(e); }
  }, []);

  useEffect(() => {
    if (!boardId) { setElements([]); setElementId(''); setTally([]); setTotal(0); return; }
    (async () => {
      try {
        const r = await lensRun({ domain: 'whiteboard', action: 'board-load', input: { id: boardId } });
        const raw = ((r.data as { result?: { board?: { scene?: { elements?: Array<{ id?: string; kind?: string; type?: string; text?: string }> } } } }).result?.board?.scene?.elements || []);
        const els = raw.filter((el) => el && el.id).map((el) => ({
          id: String(el.id),
          label: (el.text && el.text.trim()) ? el.text.trim().slice(0, 48) : `${el.kind || el.type || 'element'} · ${String(el.id).slice(0, 8)}`,
        }));
        setElements(els);
        setElementId((prev) => (els.some((e) => e.id === prev) ? prev : (els[0]?.id || '')));
        await refresh(boardId, els);
      } catch (e) { console.error(e); }
    })();
  }, [boardId, refresh]);

  const vote = async () => {
    if (!boardId || !elementId) return;
    setNote(null);
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'vote-cast', input: { boardId, elementId } });
      if ((r.data as { ok?: boolean })?.ok === false) {
        setNote(String((r.data as { error?: string }).error || 'Vote failed.'));
        return;
      }
      await refresh(boardId, elements);
    } catch (e) { console.error(e); }
  };

  const labelFor = (id: string) => elements.find((e) => e.id === id)?.label || id;

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Cast votes on board elements. Dedupes per voter per element.</p>
      {boards.length === 0 ? (
        <p className="text-[11px] text-gray-500">No boards yet — create one and it will appear here.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <select value={boardId} onChange={(e) => setBoardId(e.target.value)} aria-label="Board"
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100">
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.title} ({b.elementCount ?? 0})</option>
              ))}
            </select>
            <select value={elementId} onChange={(e) => setElementId(e.target.value)} aria-label="Element" disabled={elements.length === 0}
              className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 disabled:opacity-40">
              {elements.length === 0 && <option value="">No elements on this board</option>}
              {elements.map((el) => (
                <option key={el.id} value={el.id}>{el.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 items-center">
            <button type="button" onClick={vote} disabled={!boardId || !elementId}
              className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
              <ThumbsUp className="w-3 h-3 inline" /> Vote
            </button>
            <button type="button" onClick={() => void refresh(boardId, elements)} disabled={!boardId}
              className="px-3 py-1 rounded-md border border-white/10 text-xs text-gray-400 disabled:opacity-40">
              Tally
            </button>
            {note && <span className="text-[11px] text-rose-300" role="status">{note}</span>}
          </div>
        </>
      )}

      {tally.length > 0 && (
        <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3">
          <p className="text-[10px] uppercase text-gray-400 mb-2 tabular-nums">{total} total votes</p>
          {tally.map((row) => (
            <div key={row.elementId} className="flex justify-between text-xs py-1 border-b border-white/5">
              <span className="text-gray-300 truncate">{labelFor(row.elementId)}</span>
              <span className="text-sky-300 tabular-nums">×{row.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export default WhiteboardWorkbench;
