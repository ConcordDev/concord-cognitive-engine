'use client';

import { useState, useEffect, useCallback } from 'react';
import { BookOpen, Plus, Trash2, Save, Paperclip, ArrowLeft } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { RunButton } from '@/components/science/ScienceWorkbench';

interface Attachment { kind: string; ref: string; label: string }
interface NotebookEntry {
  id: string;
  experimentId: string | null;
  title: string;
  body: string;
  attachments: Attachment[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

const ATTACH_KINDS = ['link', 'image', 'dataset', 'chart', 'file'];

/**
 * Electronic lab-notebook entries — rich body text + embedded attachment
 * references (datasets, charts, images, links). Persists server-side.
 */
export function ScienceNotebook() {
  const [entries, setEntries] = useState<NotebookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<NotebookEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [experimentId, setExperimentId] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ entries: NotebookEntry[] }>('science', 'notebook-list', {});
    if (r.data?.ok && r.data.result) setEntries(r.data.result.entries || []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const startNew = () => {
    setCreating(true);
    setEditing(null);
    setTitle(''); setBody(''); setTags(''); setExperimentId('');
    setAttachments([]);
    setMsg(null);
  };

  const openEntry = (e: NotebookEntry) => {
    setEditing(e);
    setCreating(false);
    setTitle(e.title);
    setBody(e.body);
    setTags(e.tags.join(', '));
    setExperimentId(e.experimentId || '');
    setAttachments(e.attachments || []);
    setMsg(null);
  };

  const close = () => { setEditing(null); setCreating(false); setMsg(null); };

  const save = async () => {
    if (!title.trim()) { setMsg('Title required'); return; }
    setBusy(true); setMsg(null);
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      attachments,
    };
    if (experimentId.trim()) payload.experimentId = experimentId.trim();
    const r = editing
      ? await lensRun('science', 'notebook-update', { id: editing.id, ...payload })
      : await lensRun('science', 'notebook-add', payload);
    if (r.data?.ok) { close(); await refresh(); }
    else setMsg(r.data?.error || 'Save failed');
    setBusy(false);
  };

  const del = async (id: string) => {
    setBusy(true);
    const r = await lensRun('science', 'notebook-delete', { id });
    if (r.data?.ok) await refresh();
    else setMsg(r.data?.error || 'Delete failed');
    setBusy(false);
  };

  if (creating || editing) {
    return (
      <div className="p-3 space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={close}
            className="p-1 rounded hover:bg-white/5 text-gray-400" aria-label="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-sm font-semibold text-gray-200">
            {editing ? 'Edit Entry' : 'New Entry'}
          </span>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Entry title"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="Observations, procedure notes, results… (Markdown supported)"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100 resize-none"
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, comma separated"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />
        <input
          value={experimentId}
          onChange={(e) => setExperimentId(e.target.value)}
          placeholder="Linked experiment ID (optional)"
          className="w-full px-2 py-1.5 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
        />

        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
            <Paperclip className="w-3 h-3" /> Embedded Attachments
          </p>
          {attachments.map((a, i) => (
            <div key={i} className="flex gap-1">
              <select
                value={a.kind}
                onChange={(e) => setAttachments((al) =>
                  al.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))}
                className="px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100"
              >
                {ATTACH_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input
                value={a.label}
                onChange={(e) => setAttachments((al) =>
                  al.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                placeholder="label"
                className="w-28 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100"
              />
              <input
                value={a.ref}
                onChange={(e) => setAttachments((al) =>
                  al.map((x, j) => (j === i ? { ...x, ref: e.target.value } : x)))}
                placeholder="reference / URL / id"
                className="flex-1 px-1.5 py-1 text-[11px] bg-black/40 border border-white/10 rounded text-gray-100"
              />
              <button
                type="button"
                onClick={() => setAttachments((al) => al.filter((_, j) => j !== i))}
                className="text-gray-600 hover:text-red-400" aria-label="Remove attachment"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setAttachments((al) => [...al, { kind: 'link', ref: '', label: '' }])}
            className="text-[11px] text-teal-400 hover:text-teal-200"
          >
            + Add attachment
          </button>
        </div>

        <RunButton onClick={save} busy={busy}>
          <Save className="w-3 h-3" /> Save Entry
        </RunButton>
        {msg && <p className="text-xs text-gray-400">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-1.5">
          <BookOpen className="w-4 h-4 text-teal-400" /> Lab Notebook
        </h3>
        <RunButton onClick={startNew} busy={false}>
          <Plus className="w-3 h-3" /> New Entry
        </RunButton>
      </div>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-xs text-gray-400">No notebook entries yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="rounded border border-white/10 bg-black/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" onClick={() => openEntry(e)} className="text-left flex-1 min-w-0">
                  <span className="block text-xs text-gray-100 font-medium truncate">{e.title}</span>
                  <span className="block text-[11px] text-gray-400 line-clamp-2 mt-0.5">{e.body}</span>
                </button>
                <button
                  type="button"
                  onClick={() => del(e.id)}
                  className="p-1 rounded hover:bg-red-500/10 text-gray-400 hover:text-red-400"
                  aria-label="Delete entry"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {e.tags.map((t) => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300">
                    {t}
                  </span>
                ))}
                {e.attachments.length > 0 && (
                  <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                    <Paperclip className="w-2.5 h-2.5" /> {e.attachments.length}
                  </span>
                )}
                <span className="text-[10px] text-gray-400 ml-auto">
                  {new Date(e.createdAt).toLocaleDateString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ScienceNotebook;
