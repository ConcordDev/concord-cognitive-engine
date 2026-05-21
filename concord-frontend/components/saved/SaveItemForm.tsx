'use client';

/**
 * SaveItemForm — collapsible form to save any item to the saved lens.
 *
 * Lets the user bookmark content beyond social posts — DTUs, articles,
 * links, lens artifacts — directly. Submits through saved.add.
 */

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { SavedKind, SavedFolder } from './types';

const KINDS: { value: SavedKind; label: string }[] = [
  { value: 'link', label: 'Link' },
  { value: 'article', label: 'Article' },
  { value: 'dtu', label: 'DTU' },
  { value: 'artifact', label: 'Lens artifact' },
  { value: 'post', label: 'Social post' },
  { value: 'other', label: 'Other' },
];

export interface SaveItemFormProps {
  folders: SavedFolder[];
  onSave: (payload: Record<string, unknown>) => void;
}

export function SaveItemForm({ folders, onSave }: SaveItemFormProps) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<SavedKind>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState('');
  const [folderId, setFolderId] = useState('');
  const [err, setErr] = useState('');

  function reset() {
    setKind('link'); setTitle(''); setUrl(''); setAuthor('');
    setExcerpt(''); setTags(''); setFolderId(''); setErr('');
  }

  function submit() {
    if (!title.trim() && !url.trim()) {
      setErr('Add a title or a URL.');
      return;
    }
    onSave({
      kind,
      title: title.trim(),
      url: url.trim() || undefined,
      author: author.trim() || undefined,
      excerpt: excerpt.trim() || undefined,
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      folderId: folderId || undefined,
      refId: url.trim() || undefined,
      sourceLens: 'saved',
    });
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-amber-500/15 text-amber-200 border border-amber-500/30 hover:bg-amber-500/25"
      >
        <Plus className="w-4 h-4" /> Save something
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-zinc-950/80 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-amber-200">Save an item</h3>
        <button type="button" onClick={() => { reset(); setOpen(false); }} aria-label="Close" className="text-zinc-500 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase text-zinc-500 col-span-2 -mb-1">Kind</label>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as SavedKind)}
          className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        >
          {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
        <select
          value={folderId}
          onChange={(e) => setFolderId(e.target.value)}
          className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        >
          <option value="">No folder</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="URL (optional)"
        className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="Author (optional)"
          className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="tags, comma, sep"
          className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
        />
      </div>
      <textarea
        value={excerpt}
        onChange={(e) => setExcerpt(e.target.value)}
        placeholder="Excerpt / why you saved it (optional)"
        rows={2}
        className="w-full text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
      />

      {err && <p className="text-xs text-rose-300">{err}</p>}

      <button
        type="button"
        onClick={submit}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
      >
        <Plus className="w-4 h-4" /> Save
      </button>
    </div>
  );
}

export default SaveItemForm;
