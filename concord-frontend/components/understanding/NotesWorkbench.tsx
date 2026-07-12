'use client';

// NotesWorkbench — Obsidian/RemNote-shape knowledge tool for the
// understanding lens. Covers every backlog item: full-text search,
// tagging + tag filtering, inline body editing with revision history,
// diff between revisions, manual linking + backlinks panel, and
// markdown / DTU-pack export. All data is real user input persisted
// via the understanding domain macros — no seed/demo data.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  Plus, Search, Loader2, X, Save, Trash2, Tag as TagIcon,
  Link2, Download, History, GitCompare, FileText, ChevronRight, Clock,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────

export interface NoteSrs {
  enabled: boolean;
  state: 'new' | 'learning' | 'review' | 'relearning';
  ease: number;
  interval: number;
  reps: number;
  lapses: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revisionCount: number;
  wordCount: number;
  srs: NoteSrs;
}

interface RevisionRef { index: number; at: string; title: string }

interface SearchMatch extends Note {
  score: number;
  snippet: string;
  hitIn: { title: boolean; body: boolean; tags: boolean };
}

interface TagCount { tag: string; count: number }

interface BacklinkEntry {
  linkId?: string;
  kind: 'manual' | 'wiki';
  relation: string;
  noteId: string | null;
  title: string;
  context?: string | null;
  resolved?: boolean;
}

interface BacklinksResult {
  noteId: string;
  title: string;
  backlinks: BacklinkEntry[];
  backlinkCount: number;
  outbound: BacklinkEntry[];
  outboundCount: number;
}

interface DiffLine { type: 'same' | 'add' | 'del'; text: string }
interface DiffResult {
  noteId: string;
  fromRevision: number;
  toRevision: number;
  fromAt: string | null;
  toAt: string | null;
  lines: DiffLine[];
  added: number;
  removed: number;
  unchanged: number;
}

// Mirrors server/domains/understanding.js#cleanTags — used only to render an
// optimistic tag list the instant a save is dispatched; the server's own
// cleaning is still authoritative and is what actually lands in `note.tags`
// once the background round-trip reconciles.
function cleanTagsClient(input: string): string[] {
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const tag = raw.trim().toLowerCase().replace(/^#/, '').slice(0, 24);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, 32);
}

// ── Component ───────────────────────────────────────────────────────

export function NotesWorkbench({
  onChanged, initialNoteId,
}: {
  onChanged?: () => void;
  initialNoteId?: string | null;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<SearchMatch[] | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId ?? null);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [l, t] = await Promise.all([
        lensRun<{ notes: Note[]; count: number }>('understanding', 'list', {}),
        lensRun<{ tags: TagCount[] }>('understanding', 'tags', {}),
      ]);
      if (l.data?.ok && l.data.result) setNotes(l.data.result.notes);
      if (t.data?.ok && t.data.result) setTags(t.data.result.tags);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) { setSearchHits(null); return; }
    try {
      const r = await lensRun<{ matches: SearchMatch[]; count: number }>(
        'understanding', 'search', { query: q },
      );
      if (r.data?.ok && r.data.result) setSearchHits(r.data.result.matches);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'search failed');
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(() => { runSearch(); }, 250);
    return () => clearTimeout(t);
  }, [runSearch]);

  const visibleNotes = useMemo(() => {
    let rows = searchHits != null ? (searchHits as Note[]) : notes;
    if (tagFilter) rows = rows.filter((n) => n.tags.includes(tagFilter));
    return rows;
  }, [notes, searchHits, tagFilter]);

  async function createNote(title: string, body: string, tagStr: string) {
    setError(null);
    try {
      const r = await lensRun<{ note: Note }>('understanding', 'create', {
        title, body, tags: tagStr,
      });
      if (r.data?.ok && r.data.result) {
        await refresh();
        setSelectedId(r.data.result.note.id);
        setCreating(false);
        onChanged?.();
      } else {
        setError(r.data?.error || 'create failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed');
    }
  }

  return (
    <section className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {/* Sidebar — search, tags, note list */}
      <aside className="space-y-3">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-md px-3 py-1.5">
          <Search className="w-3.5 h-3.5 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Full-text search…"
            className="bg-transparent outline-none text-sm flex-1 placeholder:text-white/30"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-white/40 hover:text-white" aria-label="Clear search">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <button
                key={t.tag}
                onClick={() => setTagFilter(tagFilter === t.tag ? null : t.tag)}
                className={`text-[10px] inline-flex items-center gap-1 rounded px-1.5 py-0.5 border transition ${
                  tagFilter === t.tag
                    ? 'bg-violet-500/30 border-violet-500/50 text-violet-100'
                    : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                }`}
              >
                <TagIcon className="w-2.5 h-2.5" />{t.tag}
                <span className="text-white/30">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => { setCreating(true); setSelectedId(null); }}
          className="w-full px-3 py-2 text-sm bg-violet-600 hover:bg-violet-500 rounded text-white inline-flex items-center justify-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> New note
        </button>

        {error && (
          <div role="alert" className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded p-2 space-y-1.5">
            <p>{error}</p>
            <button
              onClick={() => refresh()}
              className="px-2 py-1 text-[11px] bg-rose-600 hover:bg-rose-500 rounded text-white inline-flex items-center gap-1 focus:outline-none focus:ring-2 focus:ring-rose-400"
            >
              <Loader2 className="w-3 h-3" /> Retry
            </button>
          </div>
        )}

        {loading ? (
          <div role="status" className="flex items-center gap-2 text-white/60 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            <span className="sr-only">Loading notes</span>
          </div>
        ) : visibleNotes.length === 0 ? (
          <p className="text-white/50 text-sm">
            {notes.length === 0
              ? 'No notes yet. Create one to start your knowledge base.'
              : 'No matches.'}
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto pr-1">
            {visibleNotes.map((n) => {
              const hit = searchHits?.find((h) => h.id === n.id);
              return (
                <li key={n.id}>
                  <button
                    onClick={() => { setSelectedId(n.id); setCreating(false); }}
                    className={`w-full text-left rounded-lg p-2.5 border transition ${
                      selectedId === n.id
                        ? 'bg-violet-500/20 border-violet-500/40'
                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{n.title}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-white/30 flex-shrink-0" />
                    </div>
                    {hit?.snippet ? (
                      <p className="text-[11px] text-white/50 mt-0.5 line-clamp-2">{hit.snippet}</p>
                    ) : (
                      <p className="text-[11px] text-white/40 mt-0.5">
                        {n.wordCount} words · {n.revisionCount} rev{n.revisionCount === 1 ? '' : 's'}
                      </p>
                    )}
                    {n.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {n.tags.slice(0, 4).map((t) => (
                          <span key={t} className="text-[9px] text-violet-300 bg-violet-500/10 rounded px-1">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      {/* Editor / detail pane */}
      <div className="min-w-0">
        {creating ? (
          <NoteCreateForm onCancel={() => setCreating(false)} onCreate={createNote} />
        ) : selectedId ? (
          <NoteEditor
            key={selectedId}
            noteId={selectedId}
            allNotes={notes}
            onSaved={() => { refresh(); onChanged?.(); }}
            onDeleted={() => { setSelectedId(null); refresh(); onChanged?.(); }}
            onOpenNote={(id) => setSelectedId(id)}
          />
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/40 p-8 text-center text-white/50 text-sm">
            Select a note to view, edit, link and export — or create a new one.
          </div>
        )}
      </div>
    </section>
  );
}

// ── Create form ─────────────────────────────────────────────────────

function NoteCreateForm({
  onCancel, onCreate,
}: {
  onCancel: () => void;
  onCreate: (title: string, body: string, tags: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  return (
    <div className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h3 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <Plus className="w-4 h-4" /> New note
      </h3>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm mb-2"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={10}
        placeholder="Body — use [[Note Title]] to link to other notes."
        className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm mb-2 font-mono"
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (comma or space separated)"
        className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-sm mb-3"
      />
      <div className="flex gap-2">
        <button
          onClick={() => onCreate(title.trim(), body, tags)}
          disabled={!title.trim()}
          className="px-4 py-2 text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1.5"
        >
          <Save className="w-4 h-4" /> Create
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm bg-white/5 hover:bg-white/10 border border-white/10 rounded text-white/70"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Note editor — inline edit, revisions, diff, links, backlinks, export

function NoteEditor({
  noteId, allNotes, onSaved, onDeleted, onOpenNote,
}: {
  noteId: string;
  allNotes: Note[];
  onSaved: () => void;
  onDeleted: () => void;
  onOpenNote: (id: string) => void;
}) {
  const [note, setNote] = useState<Note | null>(null);
  const [revisions, setRevisions] = useState<RevisionRef[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [backlinks, setBacklinks] = useState<BacklinksResult | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffFrom, setDiffFrom] = useState(0);
  const [diffTo, setDiffTo] = useState(0);
  const [showRevisions, setShowRevisions] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');
  const [linkRelation, setLinkRelation] = useState('relates-to');

  // Bumped on every keystroke in title/body/tags. Lets an in-flight save's
  // background reconcile detect "the user kept typing while I was saving"
  // and skip overwriting the live editor fields with the (now-stale)
  // server snapshot — it still refreshes the read-only meta (word/revision
  // count, backlinks) either way.
  const editSeqRef = useRef(0);

  const loadNote = useCallback(async (opts: { syncEditorFields?: boolean } = {}) => {
    const { syncEditorFields = true } = opts;
    setError(null);
    try {
      const [g, bl] = await Promise.all([
        lensRun<{ note: Note; revisions: RevisionRef[] }>('understanding', 'get', { id: noteId }),
        lensRun<BacklinksResult>('understanding', 'backlinks', { id: noteId }),
      ]);
      if (g.data?.ok && g.data.result) {
        const n = g.data.result.note;
        setNote(n);
        if (syncEditorFields) {
          setTitle(n.title);
          setBody(n.body);
          setTags(n.tags.join(', '));
          setDirty(false);
        }
        setRevisions(g.data.result.revisions);
        setDiffTo(Math.max(0, g.data.result.revisions.length - 1));
        setDiffFrom(Math.max(0, g.data.result.revisions.length - 2));
      } else {
        setError(g.data?.error || 'note not found');
      }
      if (bl.data?.ok && bl.data.result) setBacklinks(bl.data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    }
  }, [noteId]);

  useEffect(() => { loadNote(); }, [loadNote]);

  // Optimistic save: the perceived response is instant (sub-100ms) — the
  // "saved" state, word count, and tag chips flip the moment save() is
  // called, off the same values already on screen, not off a round-trip.
  // The real `edit` macro call still runs in the background and is what
  // actually persists the note; a failure is a visible, honest rollback
  // (dirty flips back true, the saved timestamp is retracted, the error
  // banner explains why) rather than a silently-swallowed optimistic lie.
  // If the user keeps typing while the save is in flight, the later
  // background reconcile skips overwriting title/body/tags so it can't
  // clobber newer, unsaved keystrokes — but it still refreshes revision
  // count / backlinks either way.
  async function save() {
    if (!dirty || !title.trim() || busy) return;
    setError(null);
    const seqAtSave = editSeqRef.current;
    const snapshotTitle = title.trim();
    const snapshotBody = body;
    const snapshotTags = tags;

    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString());
    setNote((n) => (n
      ? {
          ...n,
          title: snapshotTitle,
          body: snapshotBody,
          tags: cleanTagsClient(snapshotTags),
          wordCount: snapshotBody.trim() ? snapshotBody.trim().split(/\s+/).length : 0,
        }
      : n));

    try {
      const r = await lensRun<{ note: Note; changed: boolean }>('understanding', 'edit', {
        id: noteId, title: snapshotTitle, body: snapshotBody, tags: snapshotTags,
      });
      if (r.data?.ok) {
        await loadNote({ syncEditorFields: seqAtSave === editSeqRef.current });
        onSaved();
      } else {
        setError(r.data?.error || 'save failed');
        setSavedAt(null);
        setDirty(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
      setSavedAt(null);
      setDirty(true);
    }
  }

  // Toggling review is a real macro call (understanding.edit reviewEnabled),
  // not a client-only flag — reflects instantly (optimistic), reconciles
  // quietly, and rolls back honestly on failure, matching save()'s pattern.
  async function toggleReview() {
    if (!note) return;
    const nextEnabled = !note.srs.enabled;
    setNote((n) => (n ? { ...n, srs: { ...n.srs, enabled: nextEnabled } } : n));
    try {
      const r = await lensRun<{ note: Note }>('understanding', 'edit', { id: noteId, reviewEnabled: nextEnabled });
      if (!r.data?.ok) {
        setNote((n) => (n ? { ...n, srs: { ...n.srs, enabled: !nextEnabled } } : n));
        setError(r.data?.error || 'toggle review failed');
      } else if (r.data.result) {
        setNote(r.data.result.note);
      }
    } catch (e) {
      setNote((n) => (n ? { ...n, srs: { ...n.srs, enabled: !nextEnabled } } : n));
      setError(e instanceof Error ? e.message : 'toggle review failed');
    }
  }

  async function remove() {
    if (!window.confirm('Delete this note and all its links?')) return;
    setBusy(true);
    try {
      const r = await lensRun('understanding', 'remove', { id: noteId });
      if (r.data?.ok) onDeleted();
      else setError(r.data?.error || 'delete failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed');
    } finally {
      setBusy(false);
    }
  }

  async function loadDiff() {
    try {
      const r = await lensRun<DiffResult>('understanding', 'diff', {
        id: noteId, from: diffFrom, to: diffTo,
      });
      if (r.data?.ok && r.data.result) setDiff(r.data.result);
      else setError(r.data?.error || 'diff failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'diff failed');
    }
  }

  async function addLink() {
    if (!linkTarget) return;
    setBusy(true);
    try {
      const r = await lensRun('understanding', 'link', {
        from: noteId, to: linkTarget, relation: linkRelation,
      });
      if (r.data?.ok) {
        setLinkTarget('');
        await loadNote();
      } else {
        setError(r.data?.error || 'link failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'link failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeLink(linkId: string) {
    setBusy(true);
    try {
      await lensRun('understanding', 'unlink', { linkId });
      await loadNote();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unlink failed');
    } finally {
      setBusy(false);
    }
  }

  async function exportNote(format: 'markdown' | 'dtu') {
    try {
      const r = await lensRun<{ filename: string; content: unknown; format: string }>(
        'understanding', 'export', { id: noteId, format },
      );
      if (!r.data?.ok || !r.data.result) {
        setError(r.data?.error || 'export failed');
        return;
      }
      const { filename, content } = r.data.result;
      const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
      const blob = new Blob([text], {
        type: format === 'dtu' ? 'application/json' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'export failed');
    }
  }

  if (!note) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/40 p-6 text-white/50 text-sm">
        {error || 'Loading note…'}
      </div>
    );
  }

  const otherNotes = allNotes.filter((n) => n.id !== noteId);

  return (
    <div className="space-y-3">
      {/* Editor */}
      <div className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
        <input
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true); editSeqRef.current += 1; }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }}
          className="w-full bg-transparent text-lg font-semibold text-violet-200 outline-none border-b border-white/10 pb-1.5 mb-2"
        />
        <textarea
          value={body}
          onChange={(e) => { setBody(e.target.value); setDirty(true); editSeqRef.current += 1; }}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } }}
          rows={14}
          placeholder="Body — use [[Note Title]] to link other notes."
          className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm font-mono mb-2"
        />
        <input
          value={tags}
          onChange={(e) => { setTags(e.target.value); setDirty(true); editSeqRef.current += 1; }}
          placeholder="Tags (comma separated)"
          className="w-full bg-black/40 border border-white/10 rounded px-3 py-2 text-sm mb-3"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={!dirty || !title.trim()}
            title="Save (Cmd/Ctrl+S)"
            className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-white inline-flex items-center gap-1"
          >
            <Save className="w-3 h-3" />
            Save changes
            <kbd className="ml-1 text-[9px] text-white/40 border border-white/20 rounded px-1">⌘S</kbd>
          </button>
          <button
            onClick={() => exportNote('markdown')}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded text-white/70 inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" /> Markdown
          </button>
          <button
            onClick={() => exportNote('dtu')}
            className="px-3 py-1.5 text-xs bg-white/5 hover:bg-white/10 border border-white/10 rounded text-white/70 inline-flex items-center gap-1"
          >
            <FileText className="w-3 h-3" /> DTU pack
          </button>
          <button
            onClick={remove}
            disabled={busy}
            className="px-3 py-1.5 text-xs bg-rose-700/40 hover:bg-rose-700/60 border border-rose-700 rounded text-rose-200 inline-flex items-center gap-1 ml-auto"
          >
            <Trash2 className="w-3 h-3" /> Delete
          </button>
        </div>
        <p className="text-[11px] text-white/40 mt-2">
          {note.wordCount} words · {note.revisionCount} revision{note.revisionCount === 1 ? '' : 's'}
          {dirty && <span className="text-amber-300 ml-2">unsaved changes</span>}
          {savedAt && !dirty && <span className="text-emerald-300 ml-2">saved {savedAt}</span>}
        </p>
        {error && <p className="text-xs text-rose-300 mt-1">{error}</p>}

        {/* Spaced-repetition review toggle — real state, real due date */}
        <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 text-xs text-white/70 cursor-pointer">
            <input
              type="checkbox"
              checked={note.srs.enabled}
              onChange={toggleReview}
              className="accent-amber-500"
            />
            <Clock className="w-3.5 h-3.5 text-amber-300" /> In review queue
          </label>
          {note.srs.enabled && (
            <span className="text-[11px] text-white/40">
              {note.srs.reps === 0 && note.srs.lastReviewedAt == null
                ? 'not reviewed yet — due now'
                : `ease ${note.srs.ease.toFixed(2)} · ${note.srs.reps} rep${note.srs.reps === 1 ? '' : 's'} · next due ${note.srs.dueAt ? new Date(note.srs.dueAt).toLocaleDateString() : '—'}`}
            </span>
          )}
        </div>
      </div>

      {/* Manual linking */}
      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <h4 className="text-sm font-semibold text-white/80 inline-flex items-center gap-1.5 mb-2">
          <Link2 className="w-4 h-4 text-cyan-300" /> Link to another note
        </h4>
        {otherNotes.length === 0 ? (
          <p className="text-xs text-white/40">Create more notes to link them.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={linkTarget}
              onChange={(e) => setLinkTarget(e.target.value)}
              className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm flex-1 min-w-[160px]"
            >
              <option value="">Select a note…</option>
              {otherNotes.map((n) => (
                <option key={n.id} value={n.id}>{n.title}</option>
              ))}
            </select>
            <input
              value={linkRelation}
              onChange={(e) => setLinkRelation(e.target.value)}
              placeholder="relation"
              className="bg-black/60 border border-white/10 rounded px-2 py-1.5 text-sm w-32"
            />
            <button
              onClick={addLink}
              disabled={busy || !linkTarget}
              className="px-3 py-1.5 text-xs bg-cyan-500/20 border border-cyan-500/40 rounded text-cyan-200 hover:bg-cyan-500/30 disabled:opacity-50"
            >
              Link
            </button>
          </div>
        )}
      </div>

      {/* Backlinks / referenced-by */}
      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <h4 className="text-sm font-semibold text-white/80 inline-flex items-center gap-1.5 mb-2">
          <Link2 className="w-4 h-4 text-emerald-300" /> Connections
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
              Referenced by ({backlinks?.backlinkCount ?? 0})
            </p>
            {backlinks && backlinks.backlinks.length > 0 ? (
              <ul className="space-y-1">
                {backlinks.backlinks.map((b, i) => (
                  <li key={`${b.linkId || b.noteId}_${i}`} className="text-xs flex items-center gap-1.5">
                    <span className="text-[9px] uppercase text-white/40">{b.kind}</span>
                    {b.noteId ? (
                      <button onClick={() => onOpenNote(b.noteId!)} className="text-emerald-300 hover:underline truncate">
                        {b.title}
                      </button>
                    ) : <span className="text-white/50">{b.title}</span>}
                    <span className="text-white/30">· {b.relation}</span>
                    {b.linkId && (
                      <button
                        onClick={() => removeLink(b.linkId!)}
                        className="text-rose-400 hover:text-rose-200 ml-auto"
                        aria-label="Remove link"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-white/40 italic">No backlinks yet.</p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">
              Links out ({backlinks?.outboundCount ?? 0})
            </p>
            {backlinks && backlinks.outbound.length > 0 ? (
              <ul className="space-y-1">
                {backlinks.outbound.map((b, i) => (
                  <li key={`out_${b.linkId || b.title}_${i}`} className="text-xs flex items-center gap-1.5">
                    <span className="text-[9px] uppercase text-white/40">{b.kind}</span>
                    {b.noteId ? (
                      <button onClick={() => onOpenNote(b.noteId!)} className="text-cyan-300 hover:underline truncate">
                        {b.title}
                      </button>
                    ) : (
                      <span className="text-amber-300/70" title="Unresolved wiki-link">{b.title}</span>
                    )}
                    <span className="text-white/30">· {b.relation}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-white/40 italic">No outbound links.</p>
            )}
          </div>
        </div>
      </div>

      {/* Revision history + diff */}
      <div className="rounded-lg border border-white/10 bg-black/60 p-4">
        <button
          onClick={() => setShowRevisions((v) => !v)}
          className="text-sm font-semibold text-white/80 inline-flex items-center gap-1.5"
        >
          <History className="w-4 h-4 text-amber-300" /> Revision history ({revisions.length})
          <ChevronRight className={`w-3.5 h-3.5 transition ${showRevisions ? 'rotate-90' : ''}`} />
        </button>
        {showRevisions && (
          <div className="mt-3">
            {revisions.length < 2 ? (
              <p className="text-xs text-white/40 italic">Edit this note to build a revision trail.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-end gap-2 mb-3">
                  <label className="text-[10px] text-white/40 uppercase tracking-wide block">
                    From rev
                    <select
                      value={diffFrom}
                      onChange={(e) => setDiffFrom(Number(e.target.value))}
                      className="block bg-black/60 border border-white/10 rounded px-2 py-1 text-xs mt-0.5"
                    >
                      {revisions.map((r) => (
                        <option key={r.index} value={r.index}>#{r.index} · {new Date(r.at).toLocaleString()}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[10px] text-white/40 uppercase tracking-wide block">
                    To rev
                    <select
                      value={diffTo}
                      onChange={(e) => setDiffTo(Number(e.target.value))}
                      className="block bg-black/60 border border-white/10 rounded px-2 py-1 text-xs mt-0.5"
                    >
                      {revisions.map((r) => (
                        <option key={r.index} value={r.index}>#{r.index} · {new Date(r.at).toLocaleString()}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={loadDiff}
                    className="px-3 py-1.5 text-xs bg-amber-500/20 border border-amber-500/40 rounded text-amber-200 hover:bg-amber-500/30 inline-flex items-center gap-1"
                  >
                    <GitCompare className="w-3 h-3" /> Show diff
                  </button>
                </div>
                {diff && (
                  <div className="border border-white/10 rounded bg-black/40 overflow-hidden">
                    <div className="text-[10px] text-white/40 px-2 py-1 border-b border-white/10">
                      rev #{diff.fromRevision} → #{diff.toRevision} ·
                      <span className="text-emerald-300"> +{diff.added}</span>
                      <span className="text-rose-300"> -{diff.removed}</span>
                      <span className="text-white/30"> ={diff.unchanged}</span>
                    </div>
                    <pre className="text-[11px] font-mono overflow-x-auto max-h-72">
                      {diff.lines.map((l, i) => (
                        <div
                          key={i}
                          className={
                            l.type === 'add' ? 'bg-emerald-500/15 text-emerald-200 px-2'
                            : l.type === 'del' ? 'bg-rose-500/15 text-rose-200 px-2'
                            : 'text-white/60 px-2'
                          }
                        >
                          {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}{l.text || ' '}
                        </div>
                      ))}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
