'use client';

/**
 * SaveItemForm — collapsible form to save any item to the saved lens.
 *
 * Lets the user bookmark content beyond social posts — DTUs, articles,
 * links, lens artifacts — directly. Submits through saved.add.
 */

import { useState } from 'react';
import { Plus, X, Clock } from 'lucide-react';
import type { SavedKind, SavedFolder } from './types';

// mm:ss or h:mm:ss -> milliseconds. Returns null for blank/invalid input so
// the caller can fail-open (field just omitted) rather than fail-closed on
// a typo — the backend still validates/rejects a genuinely bad value.
function timecodeToMs(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const parts = t.split(':').map((p) => Number(p));
  if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
  let seconds = 0;
  if (parts.length === 1) seconds = parts[0];
  else if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
  else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else return null;
  return Math.round(seconds * 1000);
}

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
  /** Controlled open state (e.g. driven by a keyboard shortcut). Falls back
   *  to internal state when omitted so existing callers are unaffected. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function SaveItemForm({ folders, onSave, open: openProp, onOpenChange }: SaveItemFormProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = onOpenChange ?? setOpenState;
  const [kind, setKind] = useState<SavedKind>('link');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [excerpt, setExcerpt] = useState('');
  const [tags, setTags] = useState('');
  const [folderId, setFolderId] = useState('');
  const [showClip, setShowClip] = useState(false);
  const [clipStart, setClipStart] = useState('');
  const [clipEnd, setClipEnd] = useState('');
  const [err, setErr] = useState('');

  function reset() {
    setKind('link'); setTitle(''); setUrl(''); setAuthor('');
    setExcerpt(''); setTags(''); setFolderId(''); setErr('');
    setShowClip(false); setClipStart(''); setClipEnd('');
  }

  function submit() {
    if (!title.trim() && !url.trim()) {
      setErr('Add a title or a URL.');
      return;
    }
    let clipStartMs: number | undefined;
    let clipEndMs: number | undefined;
    if (showClip) {
      const s = timecodeToMs(clipStart);
      const e = timecodeToMs(clipEnd);
      if (clipStart.trim() && s === null) { setErr('Clip start must look like 1:05 or 65.'); return; }
      if (clipEnd.trim() && e === null) { setErr('Clip end must look like 1:32 or 92.'); return; }
      if (s != null && e != null && e <= s) { setErr('Clip end must be after clip start.'); return; }
      clipStartMs = s ?? undefined;
      clipEndMs = e ?? undefined;
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
      clipStartMs,
      clipEndMs,
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
        <Plus className="w-4 h-4" /> Save something <kbd className="ml-1 text-[9px] px-1 py-0.5 rounded border border-amber-500/30 text-amber-300/70">N</kbd>
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-amber-500/30 bg-zinc-950/80 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-amber-200">Save an item</h3>
        <button type="button" onClick={() => { reset(); setOpen(false); }} aria-label="Close" className="text-zinc-400 hover:text-zinc-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] uppercase text-zinc-400 col-span-2 -mb-1">Kind</label>
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

      {!showClip ? (
        <button
          type="button"
          onClick={() => setShowClip(true)}
          className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-amber-300"
        >
          <Clock className="w-3 h-3" /> Add a clip timecode (optional)
        </button>
      ) : (
        <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase text-zinc-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Clip timecode
            </span>
            <button
              type="button"
              onClick={() => { setShowClip(false); setClipStart(''); setClipEnd(''); }}
              aria-label="Remove clip timecode"
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={clipStart}
              onChange={(e) => setClipStart(e.target.value)}
              placeholder="Start (m:ss)"
              aria-label="Clip start timecode"
              className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
            />
            <input
              value={clipEnd}
              onChange={(e) => setClipEnd(e.target.value)}
              placeholder="End (m:ss, optional)"
              aria-label="Clip end timecode"
              className="text-xs bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100"
            />
          </div>
          <p className="text-[10px] text-zinc-500">
            For a clip from a video/podcast/audio source. Leave end blank for a &quot;starts at&quot; marker.
          </p>
        </div>
      )}

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
