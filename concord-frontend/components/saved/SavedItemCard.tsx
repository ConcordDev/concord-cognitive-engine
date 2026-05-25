'use client';

/**
 * SavedItemCard — one saved item row.
 *
 * Renders a cross-lens saved thing (post / dtu / article / artifact /
 * link). Inline controls: change folder, edit tags + note, flip
 * read-later / archive state, remove. Every mutation calls a real
 * saved.* macro through the parent's handlers.
 */

import { useState } from 'react';
import {
  FileText, Link2, Box, Newspaper, MessageSquare, Bookmark,
  Trash2, FolderInput, Tag, Check, Archive, BookOpen, ExternalLink,
} from 'lucide-react';
import type { SavedItem, SavedFolder, SavedKind, SavedState } from './types';

const KIND_ICON: Record<SavedKind, typeof FileText> = {
  post: MessageSquare,
  dtu: Box,
  article: Newspaper,
  artifact: FileText,
  link: Link2,
  other: Bookmark,
};

const STATE_LABEL: Record<SavedState, string> = {
  unread: 'Read later',
  read: 'Read',
  archived: 'Archived',
};

export interface SavedItemCardProps {
  item: SavedItem;
  folders: SavedFolder[];
  onRemove: (id: string) => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
}

export function SavedItemCard({ item, folders, onRemove, onUpdate }: SavedItemCardProps) {
  const [editing, setEditing] = useState(false);
  const [tagDraft, setTagDraft] = useState(item.tags.join(', '));
  const [noteDraft, setNoteDraft] = useState(item.note);

  const Icon = KIND_ICON[item.kind] ?? Bookmark;
  const folder = folders.find((f) => f.id === item.folderId) ?? null;

  function saveEdits() {
    const tags = tagDraft.split(',').map((t) => t.trim()).filter(Boolean);
    onUpdate(item.id, { tags, note: noteDraft });
    setEditing(false);
  }

  function cycleState() {
    const next: SavedState =
      item.state === 'unread' ? 'read'
      : item.state === 'read' ? 'archived'
      : 'unread';
    onUpdate(item.id, { state: next });
  }

  return (
    <article
      className={`rounded-lg border p-3 space-y-2 ${
        item.state === 'archived'
          ? 'border-zinc-800 bg-zinc-950/40 opacity-70'
          : 'border-zinc-800 bg-zinc-950/60'
      }`}
    >
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 text-amber-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-zinc-100 break-words">{item.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800 uppercase">
              {item.kind}
            </span>
            {item.mediaType && item.mediaType !== 'text' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-300 border border-indigo-500/30">
                {item.mediaType}
              </span>
            )}
          </div>
          <div className="text-[11px] text-zinc-400 mt-0.5 flex items-center gap-2 flex-wrap">
            {item.author && <span>by {item.author}</span>}
            <span>saved {new Date(item.savedAt).toLocaleDateString()}</span>
            {item.sourceLens && <span className="text-zinc-600">via {item.sourceLens}</span>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRemove(item.id)}
          aria-label="Remove from saved"
          className="text-zinc-400 hover:text-rose-300 shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {item.excerpt && (
        <p className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-3">{item.excerpt}</p>
      )}

      {item.url && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:underline break-all"
        >
          <ExternalLink className="w-3 h-3 shrink-0" /> {item.url}
        </a>
      )}

      {!editing && item.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.tags.map((t) => (
            <li
              key={t}
              className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/30"
            >
              #{t}
            </li>
          ))}
        </ul>
      )}

      {!editing && item.note && (
        <p className="text-[11px] text-zinc-400 italic border-l-2 border-zinc-700 pl-2">{item.note}</p>
      )}

      {editing && (
        <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/50 p-2">
          <label className="block text-[10px] text-zinc-400 uppercase">Tags (comma-separated)</label>
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            placeholder="research, todo, important"
            className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
          />
          <label className="block text-[10px] text-zinc-400 uppercase">Note</label>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={2}
            placeholder="Why you saved this…"
            className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveEdits}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
            >
              <Check className="w-3 h-3" /> Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        <button
          type="button"
          onClick={cycleState}
          className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-amber-500/40"
        >
          {item.state === 'archived' ? <Archive className="w-3 h-3" /> : <BookOpen className="w-3 h-3" />}
          {STATE_LABEL[item.state]}
        </button>

        {!editing && (
          <button
            type="button"
            onClick={() => { setTagDraft(item.tags.join(', ')); setNoteDraft(item.note); setEditing(true); }}
            className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:border-amber-500/40"
          >
            <Tag className="w-3 h-3" /> Tags / note
          </button>
        )}

        <div className="inline-flex items-center gap-1 text-[11px]">
          <FolderInput className="w-3 h-3 text-zinc-400" />
          <select
            value={item.folderId ?? ''}
            onChange={(e) => onUpdate(item.id, { folderId: e.target.value || null })}
            aria-label="Move to folder"
            className="bg-zinc-950 border border-zinc-700 rounded px-1.5 py-1 text-zinc-300"
          >
            <option value="">{folder ? 'No folder' : 'No folder'}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>
    </article>
  );
}

export default SavedItemCard;
