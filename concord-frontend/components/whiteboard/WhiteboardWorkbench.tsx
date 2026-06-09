'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Square, BookOpen, ThumbsUp, Trash2, Save, Plus, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { PublishAsBlueprintDialog } from './PublishAsBlueprintDialog';

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
    <div className="fixed inset-y-0 right-0 w-[560px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-sky-500/20 shadow-2xl overflow-hidden flex flex-col">
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

  const remove = async (id: string) => {
    if (!window.confirm('Delete board?')) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-delete', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
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
      {loading ? <div className="text-center py-8 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        boards.length === 0 ? <p className="text-center text-xs text-gray-400 py-8">No boards. Create one or load a template.</p> :
        boards.map((b) => (
          <div key={b.id} className="rounded border border-white/10 bg-black/20 p-3 group flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-100">{b.title}</p>
              <p className="text-[10px] text-gray-400">{b.elementCount} elements · {new Date(b.updatedAt).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPublishingBoardId(b.id)}
                title="Publish as Concordia building blueprint"
                className="p-1 text-gray-500 hover:text-violet-300 opacity-0 group-hover:opacity-100"><Upload className="w-3 h-3" /></button>
              <button aria-label="Delete" type="button" onClick={() => remove(b.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))
      }
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
      {templates.map((t) => (
        <button key={t.id} type="button" onClick={() => apply(t.id, t.name)}
          className="w-full text-left rounded border border-white/10 bg-black/20 p-3 hover:bg-white/5">
          <p className="text-sm font-medium text-gray-100">{t.name}</p>
          <p className="text-[11px] text-gray-400">{t.elementCount} starter elements</p>
        </button>
      ))}
    </div>
  );
}

function VotingTab() {
  const [boardId, setBoardId] = useState('');
  const [elementId, setElementId] = useState('');
  const [tally, setTally] = useState<{ elementId: string; count: number }[]>([]);
  const [total, setTotal] = useState(0);

  const refresh = async () => {
    if (!boardId) return;
    try {
      const r = await lensRun({ domain: 'whiteboard', action: 'vote-tally', input: { boardId } });
      const data = (r.data as { result?: { tally?: typeof tally; total?: number } }).result;
      setTally(data?.tally || []);
      setTotal(data?.total || 0);
    } catch (e) { console.error(e); }
  };

  const vote = async () => {
    if (!boardId || !elementId) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'vote-cast', input: { boardId, elementId } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-gray-400">Cast votes on board elements. Dedupes per voter per element.</p>
      <div className="grid grid-cols-2 gap-2">
        <input type="text" value={boardId} onChange={(e) => setBoardId(e.target.value)}
          placeholder="boardId" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
        <input type="text" value={elementId} onChange={(e) => setElementId(e.target.value)}
          placeholder="elementId" className="px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={vote} disabled={!boardId || !elementId}
          className="px-3 py-1 rounded-md border border-sky-500/40 bg-sky-500/15 text-xs text-sky-100 disabled:opacity-40">
          <ThumbsUp className="w-3 h-3 inline" /> Vote
        </button>
        <button type="button" onClick={refresh} disabled={!boardId}
          className="px-3 py-1 rounded-md border border-white/10 text-xs text-gray-400 disabled:opacity-40">
          Tally
        </button>
      </div>

      {tally.length > 0 && (
        <div className="rounded border border-sky-500/20 bg-sky-500/5 p-3">
          <p className="text-[10px] uppercase text-gray-400 mb-2">{total} total votes</p>
          {tally.map((t) => (
            <div key={t.elementId} className="flex justify-between text-xs font-mono py-1 border-b border-white/5">
              <span className="text-gray-300 truncate">{t.elementId}</span>
              <span className="text-sky-300">×{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default WhiteboardWorkbench;
