'use client';

/**
 * StageCard — one expedition stage. Renders the completion toggle, the
 * per-stage journal entries (text observations), and the screenshot
 * capture strip. Every action is wired straight to the
 * expedition-journal backend domain via lensRun.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { Check, NotebookPen, Camera, X, Loader2, Trash2 } from 'lucide-react';

export interface StageView {
  id: string;
  title: string;
  objective: string;
  xp: number;
  done: boolean;
  completedAt: string | null;
}

interface JournalEntry {
  id: string;
  worldId: string;
  stageId: string | null;
  text: string;
  mood: string | null;
  createdAt: string;
}

interface PhotoMeta {
  id: string;
  worldId: string;
  stageId: string | null;
  caption: string | null;
  createdAt: string;
}

export function StageCard({
  worldId,
  stage,
  onChange,
}: {
  worldId: string;
  stage: StageView;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [marking, setMarking] = useState(false);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [photos, setPhotos] = useState<PhotoMeta[]>([]);
  const [draft, setDraft] = useState('');
  const [savingEntry, setSavingEntry] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [detailLoaded, setDetailLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async () => {
    const [e, p] = await Promise.all([
      lensRun('expedition-journal', 'entry-list', { worldId, stageId: stage.id }),
      lensRun('expedition-journal', 'photo-list', { worldId, stageId: stage.id }),
    ]);
    if (e.data?.ok && e.data.result) setEntries((e.data.result.entries as JournalEntry[]) || []);
    if (p.data?.ok && p.data.result) setPhotos((p.data.result.photos as PhotoMeta[]) || []);
    setDetailLoaded(true);
  }, [worldId, stage.id]);

  useEffect(() => {
    if (expanded && !detailLoaded) void loadDetail();
  }, [expanded, detailLoaded, loadDetail]);

  async function mark(done: boolean) {
    setMarking(true);
    const r = await lensRun('expedition-journal', 'mark-stage', { worldId, stageId: stage.id, done });
    setMarking(false);
    if (r.data?.ok) {
      const awarded = (r.data.result?.awarded as Array<{ kind: string; amount?: number }>) || [];
      const xp = awarded.find((a) => a.kind === 'xp');
      if (xp?.amount) {
        try { window.dispatchEvent(new CustomEvent('concordia:juice', { detail: { kind: 'reward', xp: xp.amount } })); } catch { /* noop */ }
      }
      onChange();
    }
  }

  async function addEntry() {
    if (!draft.trim()) return;
    setSavingEntry(true);
    const r = await lensRun('expedition-journal', 'entry-add', { worldId, stageId: stage.id, text: draft });
    setSavingEntry(false);
    if (r.data?.ok) {
      setDraft('');
      await loadDetail();
      onChange();
    }
  }

  async function deleteEntry(id: string) {
    const r = await lensRun('expedition-journal', 'entry-delete', { id });
    if (r.data?.ok) { await loadDetail(); onChange(); }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1_400_000) {
      alert('Screenshot too large — keep it under ~1.4MB.');
      e.target.value = '';
      return;
    }
    setUploading(true);
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(file);
    });
    if (dataUrl) {
      const r = await lensRun('expedition-journal', 'photo-add', {
        worldId, stageId: stage.id, dataUrl, caption: file.name,
      });
      if (r.data?.ok) { await loadDetail(); onChange(); }
      else alert(r.data?.error || 'photo upload failed');
    }
    setUploading(false);
    e.target.value = '';
  }

  async function deletePhoto(id: string) {
    const r = await lensRun('expedition-journal', 'photo-delete', { id });
    if (r.data?.ok) { await loadDetail(); onChange(); }
  }

  return (
    <div className={`rounded-lg border p-4 transition-colors ${stage.done ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-white/10 bg-white/5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-medium text-emerald-100">{stage.title}</h3>
            <span className="font-mono text-[11px] text-amber-300">+{stage.xp} XP</span>
          </div>
          <p className="mt-1 text-xs text-gray-400">{stage.objective}</p>
          {stage.completedAt && (
            <p className="mt-1 text-[10px] text-emerald-500/80">Completed {new Date(stage.completedAt).toLocaleString()}</p>
          )}
        </div>
        <button
          type="button"
          disabled={marking}
          onClick={() => mark(!stage.done)}
          className={`flex shrink-0 items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors ${
            stage.done ? 'bg-emerald-600/30 text-emerald-200 hover:bg-emerald-600/40' : 'bg-emerald-600 text-white hover:bg-emerald-500'
          }`}
        >
          {marking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {stage.done ? 'Completed' : 'Mark complete'}
        </button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-3 flex items-center gap-1 text-[11px] text-gray-400 hover:text-emerald-300"
      >
        <NotebookPen className="h-3.5 w-3.5" />
        {expanded ? 'Hide' : 'Open'} journal &amp; screenshots
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-500">Journal entry</label>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              maxLength={4000}
              placeholder="Write an observation about this stage…"
              className="w-full rounded border border-white/10 bg-[#0b0f17] p-2 text-xs text-gray-200 outline-none focus:border-emerald-500/50"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-gray-600">{draft.length}/4000</span>
              <button
                type="button"
                disabled={savingEntry || !draft.trim()}
                onClick={addEntry}
                className="rounded bg-emerald-600/30 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-600/40 disabled:opacity-40"
              >
                {savingEntry ? 'Saving…' : 'Add entry'}
              </button>
            </div>
            {entries.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {entries.map((en) => (
                  <li key={en.id} className="group flex items-start justify-between gap-2 rounded border border-white/5 bg-black/20 p-2">
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap break-words text-xs text-gray-300">{en.text}</p>
                      <p className="mt-0.5 text-[10px] text-gray-600">{new Date(en.createdAt).toLocaleString()}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteEntry(en.id)}
                      className="shrink-0 text-gray-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
                      aria-label="delete entry"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-gray-500">Screenshots</label>
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div key={p.id} className="group relative flex h-16 w-16 flex-col items-center justify-center rounded border border-white/10 bg-black/30 p-1 text-center">
                  <Camera className="h-4 w-4 text-cyan-400" />
                  <span className="mt-0.5 line-clamp-2 text-[8px] text-gray-500">{p.caption || 'photo'}</span>
                  <button
                    type="button"
                    onClick={() => deletePhoto(p.id)}
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-rose-600 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="remove photo"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-white/20 text-gray-500 hover:border-emerald-500/50 hover:text-emerald-300"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-5 w-5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFilePicked} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
