'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * SpacesPanel — Perplexity "Pages / Spaces": shareable collections of
 * saved cited answers. Wires expert_mode.space_create / space_list /
 * space_get / space_add_answer / space_remove_answer / space_share /
 * space_delete. Every answer shown is a real saved entry.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { StickyDeleteConfirm } from '@/components/common/StickyDeleteConfirm';
import {
  Library, Plus, Trash2, Loader2, Share2, X, FolderOpen, Link2, Check, Pencil,
} from 'lucide-react';

export interface SpaceSummary {
  id: string;
  name: string;
  description: string;
  answerCount: number;
  shareToken: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceAnswer {
  id: string;
  query: string;
  answer: string;
  sources: any[];
  provider: string | null;
  model: string | null;
  addedAt: number;
}

export interface SpaceFull extends SpaceSummary {
  answers: SpaceAnswer[];
}

/** Public surface so the page can push the active answer into a space. */
export interface SpacesPanelHandle {
  refresh: () => void;
}

export function SpacesPanel({
  pendingAnswer,
  onAddedPending,
  reloadKey,
}: {
  pendingAnswer: { query: string; answer: string; sources: any[]; provider?: string | null; model?: string | null } | null;
  onAddedPending: () => void;
  reloadKey: number;
}) {
  const [spaces, setSpaces] = useState<SpaceSummary[]>([]);
  const [openSpace, setOpenSpace] = useState<SpaceFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // FIX-expert-mode-002: space edit (name + description).
  const [editingSpaceId, setEditingSpaceId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editErr, setEditErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun<{ spaces: SpaceSummary[] }>('expert_mode', 'space_list', {});
    if (r.data.ok && r.data.result?.spaces) setSpaces(r.data.result.spaces);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, reloadKey]);

  const create = useCallback(async () => {
    if (!newName.trim()) { setErr('Name the space first.'); return; }
    setErr(null);
    const r = await lensRun('expert_mode', 'space_create', {
      name: newName.trim(),
      description: newDesc.trim(),
    });
    if (r.data.ok) {
      setNewName('');
      setNewDesc('');
      setCreating(false);
      await refresh();
    } else {
      setErr(r.data.error || 'Create failed.');
    }
  }, [newName, newDesc, refresh]);

  const open = useCallback(async (id: string) => {
    const r = await lensRun<{ space: SpaceFull }>('expert_mode', 'space_get', { spaceId: id });
    if (r.data.ok && r.data.result?.space) setOpenSpace(r.data.result.space);
  }, []);

  const saveSpaceEdit = useCallback(async (id: string) => {
    if (!editName.trim()) { setEditErr('Name the space first.'); return; }
    const r = await lensRun('expert_mode', 'space_update', {
      spaceId: id,
      name: editName.trim(),
      description: editDesc.trim(),
    });
    if (r.data.ok) {
      setEditingSpaceId(null);
      setEditErr(null);
      if (openSpace?.id === id) await open(id);
      await refresh();
    } else {
      setEditErr(r.data.error || 'Save failed.');
    }
  }, [editName, editDesc, refresh, open, openSpace]);

  const removeSpace = useCallback(async (id: string) => {
    await lensRun('expert_mode', 'space_delete', { spaceId: id });
    if (openSpace?.id === id) setOpenSpace(null);
    await refresh();
  }, [openSpace, refresh]);

  const removeAnswer = useCallback(async (spaceId: string, answerId: string) => {
    await lensRun('expert_mode', 'space_remove_answer', { spaceId, answerId });
    await open(spaceId);
    await refresh();
  }, [open, refresh]);

  const share = useCallback(async (spaceId: string) => {
    const r = await lensRun<{ shareUrl: string }>('expert_mode', 'space_share', { spaceId });
    if (r.data.ok && r.data.result?.shareUrl) {
      try {
        await navigator.clipboard.writeText(window.location.origin + r.data.result.shareUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch { /* clipboard unavailable — token still minted */ }
      await open(spaceId);
      await refresh();
    }
  }, [open, refresh]);

  const addPendingTo = useCallback(async (spaceId: string) => {
    if (!pendingAnswer) return;
    const r = await lensRun('expert_mode', 'space_add_answer', {
      spaceId,
      query: pendingAnswer.query,
      answer: pendingAnswer.answer,
      sources: pendingAnswer.sources,
      provider: pendingAnswer.provider,
      model: pendingAnswer.model,
    });
    if (r.data.ok) {
      await refresh();
      if (openSpace?.id === spaceId) await open(spaceId);
      onAddedPending();
    }
  }, [pendingAnswer, refresh, open, openSpace, onAddedPending]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Library className="w-4 h-4 text-violet-400" />
        <h2 className="text-sm font-semibold text-zinc-200">Spaces</h2>
        {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />}
        <button
          type="button"
          onClick={() => setCreating((c) => !c)}
          className="ml-auto inline-flex min-h-11 items-center gap-1 px-2 py-1 rounded text-[11px] bg-violet-600 hover:bg-violet-500 text-violet-50 font-medium"
        >
          <Plus className="w-3.5 h-3.5" /> {creating ? 'Cancel' : 'New'}
        </button>
      </div>

      {creating && (
        <div className="space-y-2 mb-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Space name"
            className="w-full px-2.5 py-1.5 rounded bg-zinc-950 text-zinc-100 text-[12px] ring-1 ring-zinc-800 focus:ring-violet-500 focus:outline-none"
          />
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-2.5 py-1.5 rounded bg-zinc-950 text-zinc-100 text-[12px] ring-1 ring-zinc-800 focus:ring-violet-500 focus:outline-none"
          />
          {err && <p className="text-[11px] text-red-400">{err}</p>}
          <button
            type="button"
            onClick={create}
            className="px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-violet-50 text-[12px] font-medium"
          >
            Create space
          </button>
        </div>
      )}

      {pendingAnswer && spaces.length > 0 && (
        <div className="mb-3 rounded border border-violet-500/30 bg-violet-500/5 p-2">
          <p className="text-[10px] uppercase tracking-wider text-violet-300 font-semibold mb-1">
            Save current answer into…
          </p>
          <div className="flex flex-wrap gap-1">
            {spaces.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => addPendingTo(s.id)}
                className="px-2 py-0.5 rounded text-[11px] bg-violet-600/40 hover:bg-violet-600 text-violet-100 font-medium"
              >
                + {s.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {spaces.length === 0 ? (
        <p className="text-[11px] text-zinc-400">
          No spaces yet. Create one to collect cited answers.
        </p>
      ) : (
        <ul className="space-y-1">
          {spaces.map((s) => (
            <li
              key={s.id}
              className="px-2 py-1.5 rounded border border-zinc-800 bg-zinc-950/50 text-[11px]"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => open(s.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className="text-zinc-200 font-medium">{s.name}</span>
                  <span className="text-zinc-400 ml-1.5">
                    {s.answerCount} answer{s.answerCount === 1 ? '' : 's'}
                  </span>
                  {s.shareToken && <Link2 className="inline w-3 h-3 ml-1 text-violet-400" />}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingSpaceId(editingSpaceId === s.id ? null : s.id); setEditName(s.name); setEditDesc(s.description || ''); setEditErr(null); }}
                  aria-label={`Edit space ${s.name}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-violet-400"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => share(s.id)}
                  title="Share space"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-violet-400"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
                </button>
                <StickyDeleteConfirm
                  onConfirm={() => removeSpace(s.id)}
                  armLabel={<Trash2 className="w-3.5 h-3.5" />}
                  confirmLabel={`Delete space "${s.name}"?`}
                  armAriaLabel="Delete space"
                  confirmAriaLabel={`Confirm delete space ${s.name}`}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-red-400"
                />
              </div>
              {editingSpaceId === s.id && (
                <div className="mt-2 space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    aria-label="Space name"
                    maxLength={120}
                    className="w-full px-2 py-1 rounded bg-zinc-950 text-zinc-100 text-[11px] ring-1 ring-zinc-800 focus:ring-violet-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    aria-label="Space description"
                    placeholder="Description (optional)"
                    maxLength={400}
                    className="w-full px-2 py-1 rounded bg-zinc-950 text-zinc-100 text-[11px] ring-1 ring-zinc-800 focus:ring-violet-500 focus:outline-none"
                  />
                  {editErr && <p className="text-[11px] text-red-400">{editErr}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => saveSpaceEdit(s.id)} disabled={!editName.trim()} className="px-2 py-1 rounded bg-violet-600 hover:bg-violet-500 text-violet-50 text-[11px] font-medium disabled:opacity-50">Save</button>
                    <button type="button" onClick={() => setEditingSpaceId(null)} className="px-1.5 text-[11px] text-zinc-400">Cancel</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {openSpace && (
        <div className="mt-3 rounded border border-violet-500/30 bg-zinc-950/60 p-2.5">
          <div className="flex items-center gap-2 mb-2">
            <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[12px] font-semibold text-violet-200">{openSpace.name}</span>
            <button aria-label="Close"
              type="button"
              onClick={() => setOpenSpace(null)}
              className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-zinc-300"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {openSpace.description && (
            <p className="text-[11px] text-zinc-400 mb-2">{openSpace.description}</p>
          )}
          {openSpace.answers.length === 0 ? (
            <p className="text-[11px] text-zinc-400">No answers saved here yet.</p>
          ) : (
            <ul className="space-y-2">
              {openSpace.answers.map((a) => (
                <li key={a.id} className="rounded bg-zinc-900/70 ring-1 ring-zinc-800 p-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-semibold text-violet-300 flex-1 min-w-0 truncate">
                      {a.query}
                    </span>
                    <button aria-label="Remove answer"
                      type="button"
                      onClick={() => removeAnswer(openSpace.id, a.id)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center text-zinc-400 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-zinc-400 line-clamp-3 whitespace-pre-wrap">
                    {a.answer}
                  </p>
                  <p className="mt-1 text-[10px] text-zinc-400">
                    {a.sources.length} source{a.sources.length === 1 ? '' : 's'}
                    {a.model ? ` · ${a.model}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
