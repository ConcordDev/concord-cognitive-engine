'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Loader2, FileText, Calendar, Search, BookOpen, Save, Trash2, Plus, ArrowLeft,
  Network, FlaskConical, Square, History, RotateCcw,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { NoteGraphView } from './NoteGraphView';
import { AcademicSearchPanel } from './AcademicSearchPanel';
import { LiteratureReviewPanel } from './LiteratureReviewPanel';
import { NoteCanvasBoard } from './NoteCanvasBoard';

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  preview?: string;
}

export interface Template { id: string; title: string; body: string; }

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = 'notes' | 'daily' | 'search' | 'templates' | 'graph' | 'review' | 'literature' | 'canvas';

export function ResearchWorkbench({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('notes');
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[680px] max-w-[100vw] z-40 bg-[#0d1117] border-l border-fuchsia-500/20 shadow-2xl overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-fuchsia-950/40 to-transparent">
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-fuchsia-400" />
          <span className="text-sm font-semibold text-gray-200">Research Workbench</span>
        </div>
        <button type="button" onClick={onClose} className="p-1 rounded-md hover:bg-white/5 text-gray-400" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </header>

      <nav className="px-3 py-2 border-b border-white/10 flex items-center gap-1 flex-wrap">
        {([
          { id: 'notes',      label: 'Notes',      icon: FileText },
          { id: 'daily',      label: 'Daily',      icon: Calendar },
          { id: 'search',     label: 'Search',     icon: Search },
          { id: 'templates',  label: 'Templates',  icon: BookOpen },
          { id: 'graph',      label: 'Graph',      icon: Network },
          { id: 'literature', label: 'Discover',   icon: Search },
          { id: 'review',     label: 'Review',     icon: FlaskConical },
          { id: 'canvas',     label: 'Canvas',     icon: Square },
        ] as const).map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => { setTab(t.id); setActiveNoteId(null); }}
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded transition',
                active
                  ? 'bg-fuchsia-500/15 text-fuchsia-200 border border-fuchsia-500/40'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent',
              )}>
              <Icon className="w-3 h-3" /> {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        {tab === 'notes' && (activeNoteId ? <NoteEditor noteId={activeNoteId} onBack={() => setActiveNoteId(null)} onOpenNote={setActiveNoteId} /> : <NotesTab onOpen={setActiveNoteId} />)}
        {tab === 'daily' && <DailyTab />}
        {tab === 'search' && <SearchTab onOpen={(id) => { setActiveNoteId(id); setTab('notes'); }} />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'graph' && <NoteGraphView onOpenNote={(id) => { setActiveNoteId(id); setTab('notes'); }} />}
        {tab === 'literature' && <AcademicSearchPanel />}
        {tab === 'review' && <LiteratureReviewPanel />}
        {tab === 'canvas' && <NoteCanvasBoard />}
      </div>
    </div>
  );
}

function NotesTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun({ domain: 'research', action: 'notes-list', input: {} });
      setNotes(((r.data as { result?: { notes?: Note[] } }).result?.notes) || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async () => {
    try {
      await lensRun({ domain: 'research', action: 'note-create', input: draft });
      setCreating(false); setDraft({ title: '', body: '' });
      await refresh();
    } catch (e) { console.error(e); }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      await lensRun({ domain: 'research', action: 'note-delete', input: { id } });
      await refresh();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <button type="button" onClick={() => setCreating((v) => !v)}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-fuchsia-500/30 bg-fuchsia-500/10 text-xs text-fuchsia-200">
        <Plus className="w-3 h-3" /> New note
      </button>
      {creating && (
        <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-3 space-y-2">
          <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Title" maxLength={200}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <WikiLinkTextarea
            value={draft.body}
            onChange={(body) => setDraft({ ...draft, body })}
            placeholder="Body — type [[ for wikilink autocomplete"
            rows={6}
          />
          <button type="button" onClick={save} disabled={!draft.title.trim()}
            className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40">
            <Save className="w-3 h-3" /> Save
          </button>
        </div>
      )}
      {loading ? <div className="text-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div> :
        notes.length === 0 ? <p className="text-center text-xs text-gray-500 py-8">No notes yet.</p> :
        notes.map((n) => (
          <div key={n.id} className="rounded border border-white/10 bg-black/20 p-3 group hover:bg-white/5">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => onOpen(n.id)} className="flex-1 text-left min-w-0">
                <p className="text-sm font-medium text-gray-100 truncate">{n.title}</p>
                <p className="text-[11px] text-gray-500 mt-1 line-clamp-2">{n.preview}</p>
                {n.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5">
                    {n.tags.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{t}</span>)}
                  </div>
                )}
              </button>
              <button type="button" onClick={() => remove(n.id)}
                className="p-1 text-gray-600 hover:text-rose-300 opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
            </div>
          </div>
        ))
      }
    </div>
  );
}

/**
 * WikiLinkTextarea — note body editor with inline [[wikilink]] autocomplete.
 * Sources titles from research.note-titles. No fake data.
 */
function WikiLinkTextarea({
  value, onChange, placeholder, rows,
}: { value: string; onChange: (v: string) => void; placeholder: string; rows: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; title: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [linkStart, setLinkStart] = useState(-1);

  const detect = useCallback(async (text: string, caret: number) => {
    // Find an unclosed [[ before the caret.
    const before = text.slice(0, caret);
    const m = before.match(/\[\[([^[\]]*)$/);
    if (!m) { setOpen(false); return; }
    setLinkStart(caret - m[1].length - 2);
    try {
      const r = await lensRun<{ titles: { id: string; title: string }[] }>(
        'research', 'note-titles', { query: m[1] },
      );
      if (r.data?.ok && r.data.result) {
        setSuggestions(r.data.result.titles.slice(0, 8));
        setOpen((r.data.result.titles || []).length > 0);
      }
    } catch (e) { console.error(e); }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange(e.target.value);
    detect(e.target.value, e.target.selectionStart);
  };

  const pick = (title: string) => {
    if (linkStart < 0 || !ref.current) return;
    const el = ref.current;
    const caret = el.selectionStart;
    const next = `${value.slice(0, linkStart)}[[${title}]]${value.slice(caret)}`;
    onChange(next);
    setOpen(false);
    const newCaret = linkStart + title.length + 4;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCaret, newCaret);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        placeholder={placeholder}
        rows={rows}
        className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 font-mono resize-none"
      />
      {open && (
        <div className="absolute z-10 left-2 right-2 mt-0.5 max-h-40 overflow-y-auto rounded border border-fuchsia-500/40 bg-[#161b22] shadow-xl">
          {suggestions.map((sg) => (
            <button
              key={sg.id}
              type="button"
              onClick={() => pick(sg.title)}
              className="w-full text-left px-2 py-1 text-[11px] text-gray-200 hover:bg-fuchsia-500/15"
            >
              {sg.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Snapshot {
  id: string; noteId: string; title: string; label: string | null;
  createdAt: string; bodyLength: number; tags: string[];
}

function NoteEditor({ noteId, onBack, onOpenNote }: { noteId: string; onBack: () => void; onOpenNote: (id: string) => void }) {
  const [note, setNote] = useState<Note | null>(null);
  const [backlinks, setBacklinks] = useState<{ noteId: string; noteTitle: string; context: string }[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: '', body: '' });
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await lensRun({ domain: 'research', action: 'note-get', input: { id: noteId } });
      const n = ((r.data as { result?: { note?: Note } }).result?.note) || null;
      setNote(n);
      if (n) {
        setDraft({ title: n.title, body: n.body });
        const b = await lensRun({ domain: 'research', action: 'backlinks-for', input: { title: n.title } });
        setBacklinks(((b.data as { result?: { backlinks?: typeof backlinks } }).result?.backlinks) || []);
      }
    } catch (e) { console.error(e); }
  }, [noteId]);

  const loadSnapshots = useCallback(async () => {
    try {
      const r = await lensRun<{ snapshots: Snapshot[] }>('research', 'note-snapshots', { noteId });
      if (r.data?.ok && r.data.result) setSnapshots(r.data.result.snapshots || []);
    } catch (e) { console.error(e); }
  }, [noteId]);

  useEffect(() => { refresh(); loadSnapshots(); }, [refresh, loadSnapshots]);

  const save = async () => {
    try {
      // Capture a snapshot before overwriting so edits are reversible.
      await lensRun('research', 'note-snapshot', { noteId, label: 'before edit' });
      await lensRun({ domain: 'research', action: 'note-update', input: { id: noteId, ...draft } });
      setEditing(false);
      await refresh();
      await loadSnapshots();
    } catch (e) { console.error(e); }
  };

  const restore = async (snapshotId: string) => {
    if (!window.confirm('Restore this version? Current state is snapshotted first.')) return;
    try {
      await lensRun('research', 'note-restore', { noteId, snapshotId });
      await refresh();
      await loadSnapshots();
    } catch (e) { console.error(e); }
  };

  if (!note) return <div className="text-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-200">
          <ArrowLeft className="w-3 h-3" /> Back
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setShowHistory((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-xs text-gray-400 hover:text-gray-200">
            <History className="w-3 h-3" /> History ({snapshots.length})
          </button>
          <button type="button" onClick={() => editing ? save() : setEditing(true)}
            className="px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100">
            {editing ? 'Save' : 'Edit'}
          </button>
        </div>
      </div>

      {showHistory && (
        <div className="rounded border border-white/10 bg-black/20 p-2 space-y-1">
          {snapshots.length === 0 ? (
            <p className="text-[11px] text-gray-500">No snapshots yet — saving an edit creates one.</p>
          ) : snapshots.map((sn) => (
            <div key={sn.id} className="flex items-center justify-between text-[11px]">
              <span className="text-gray-400 truncate">
                {new Date(sn.createdAt).toLocaleString()}
                {sn.label ? ` · ${sn.label}` : ''} · {sn.bodyLength} chars
              </span>
              <button type="button" onClick={() => restore(sn.id)}
                className="inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200">
                <RotateCcw className="w-3 h-3" /> Restore
              </button>
            </div>
          ))}
        </div>
      )}

      {editing ? (
        <>
          <input type="text" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
          <WikiLinkTextarea
            value={draft.body}
            onChange={(body) => setDraft({ ...draft, body })}
            placeholder="Body — type [[ for wikilink autocomplete"
            rows={16}
          />
        </>
      ) : (
        <>
          <h3 className="text-lg font-semibold text-gray-100">{note.title}</h3>
          <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono">{note.body}</pre>
        </>
      )}

      {backlinks.length > 0 && (
        <div className="border-t border-white/10 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">Backlinks ({backlinks.length})</p>
          {backlinks.map((b) => (
            <button key={b.noteId} type="button" onClick={() => onOpenNote(b.noteId)}
              className="w-full text-left rounded border border-white/10 bg-black/20 p-2 mb-1 hover:bg-white/5">
              <p className="text-xs text-fuchsia-300">{b.noteTitle}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">…{b.context}…</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DailyTab() {
  const [note, setNote] = useState<Note | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'research', action: 'daily-note', input: {} });
        setNote(((r.data as { result?: { note?: Note } }).result?.note) || null);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="text-center py-8 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Loading…</div>;
  if (!note) return <p className="text-xs text-gray-500 p-4">Could not load daily note.</p>;

  return (
    <div className="p-3 space-y-2">
      <p className="text-[10px] text-gray-500">Auto-created daily note. Edit via Notes tab.</p>
      <h3 className="text-lg font-semibold text-gray-100">{note.title}</h3>
      <pre className="text-xs text-gray-200 whitespace-pre-wrap font-mono border border-white/10 rounded p-3 bg-black/20">{note.body}</pre>
    </div>
  );
}

function SearchTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string; score: number; preview: string }[]>([]);

  const search = async () => {
    if (query.trim().length < 2) return;
    try {
      const r = await lensRun({ domain: 'research', action: 'notes-search', input: { query } });
      setHits(((r.data as { result?: { hits?: typeof hits } }).result?.hits) || []);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex gap-2">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
          placeholder="Search notes"
          className="flex-1 px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100" />
        <button type="button" onClick={search}
          className="px-3 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100">Go</button>
      </div>
      {hits.map((h) => (
        <button key={h.id} type="button" onClick={() => onOpen(h.id)}
          className="w-full text-left rounded border border-white/10 bg-black/20 p-3 hover:bg-white/5">
          <p className="text-sm font-medium text-gray-100">{h.title}</p>
          <p className="text-[11px] text-gray-500 line-clamp-2">{h.preview}</p>
        </button>
      ))}
    </div>
  );
}

function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const r = await lensRun({ domain: 'research', action: 'templates-list', input: {} });
        setTemplates(((r.data as { result?: { templates?: Template[] } }).result?.templates) || []);
      } catch (e) { console.error(e); }
    })();
  }, []);

  const apply = async (id: string) => {
    try {
      const r = await lensRun({ domain: 'research', action: 'template-apply', input: { id } });
      const t = ((r.data as { result?: { template?: Template } }).result?.template);
      if (!t) return;
      await lensRun({ domain: 'research', action: 'note-create', input: { title: t.title, body: t.body } });
      alert(`Created note from ${t.title} template`);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-3 space-y-2">
      <p className="text-[11px] text-gray-500">Click a template to create a new note from it.</p>
      {templates.map((t) => (
        <button key={t.id} type="button" onClick={() => apply(t.id)}
          className="w-full text-left rounded border border-white/10 bg-black/20 p-3 hover:bg-white/5">
          <p className="text-sm font-medium text-gray-100">{t.title}</p>
          <pre className="text-[10px] text-gray-500 line-clamp-3 whitespace-pre-wrap font-mono mt-1">{t.body}</pre>
        </button>
      ))}
    </div>
  );
}

export default ResearchWorkbench;
