'use client';

/**
 * Photography — rolls of real uploaded photos.
 *
 * Import a roll opens a name + file picker. The file uploads to
 * /api/media/upload-raw (the real binary-body transport the platform
 * already uses for music/video — the base64 JSON path truncates past
 * ~7.5KB and can't carry a real photo), then shoot-create attaches the
 * resulting mediaId as the roll's first frame. A roll (and each frame)
 * is shown only after shoot-list contains it back. Additional photos
 * add onto an existing roll via shoot-add-frame; Delete removes a roll
 * and its frames (shoot-delete); the × on a frame removes just that
 * frame (shoot-remove-frame). Legacy frames created before real upload
 * existed (typed filename only, no mediaId) still render as a filename
 * row, never a broken image. Date, location, and client stay off this
 * screen; the catalog is other macros, not this one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { api, lensRun } from '@/lib/api/client';
import { rawPhotoUploadQuery, describePhotoUploadError } from '@/lib/photography/upload';

interface Frame {
  id: string;
  filename: string;
  mediaId: string | null;
}

interface Roll {
  id: string;
  name: string;
  frames: Frame[];
}

type Phase = 'loading' | 'ready' | 'error';

function framesFrom(rows: unknown): Frame[] {
  if (!Array.isArray(rows)) return [];
  const out: Frame[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const filename = (row as { filename?: string }).filename;
    if (typeof id !== 'string' || !id) continue;
    if (typeof filename !== 'string' || !filename.trim()) continue;
    const mediaId = (row as { mediaId?: unknown }).mediaId;
    out.push({ id, filename: filename.trim(), mediaId: typeof mediaId === 'string' && mediaId ? mediaId : null });
  }
  return out;
}

function rollsFrom(rows: unknown): Roll[] {
  if (!Array.isArray(rows)) return [];
  const out: Roll[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: string }).id;
    const name = (row as { name?: string }).name;
    if (typeof id !== 'string' || !id) continue;
    if (typeof name !== 'string' || !name.trim()) continue;
    out.push({
      id,
      name: name.trim(),
      frames: framesFrom((row as { frames?: unknown }).frames),
    });
  }
  return out;
}

function sameFrames(frames: Frame[], mediaIds: string[]): boolean {
  if (frames.length !== mediaIds.length) return false;
  return frames.every((frame, index) => frame.mediaId === mediaIds[index]);
}

function isWarming(message: string): boolean {
  return /service_overloaded|event_loop_lag|status code 503/i.test(message);
}

// shoot-list is a small read. A 503 here is the admission gate refusing
// PROTECTED calls while boot lag is over 900ms, not a failed roll query.
// Retry on that gate only. Any other error surfaces immediately.
async function readRolls(): Promise<Roll[]> {
  let last = 'Could not read the roll.';
  for (let attempt = 0; attempt < 8; attempt++) {
    const list = await lensRun<{ shoots?: unknown }>('photography', 'shoot-list', {});
    if (list.data?.ok) return rollsFrom(list.data.result?.shoots);
    last = list.data?.error || last;
    if (!isWarming(last) || attempt === 7) throw new Error(last);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(last);
}

/** Uploads one image file and returns its real media id. */
async function uploadPhoto(file: File): Promise<string> {
  const title = file.name.replace(/\.[^.]+$/, '') || 'Untitled';
  const resp = await api.post(
    `/api/media/upload-raw?${rawPhotoUploadQuery({ title, filename: file.name })}`,
    file,
    { headers: { 'Content-Type': file.type || 'application/octet-stream' }, timeout: 0, maxBodyLength: Infinity },
  );
  const mediaId = resp.data?.mediaDTU?.id || resp.data?.id || resp.data?.media?.id;
  if (typeof mediaId !== 'string' || !mediaId) throw new Error('Upload did not return a media id.');
  return mediaId;
}

export default function PhotographyPage() {
  useLensNav('photography');
  const [phase, setPhase] = useState<Phase>('loading');
  const [rolls, setRolls] = useState<Roll[]>([]);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [composing, setComposing] = useState(false);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const addFileInput = useRef<HTMLInputElement | null>(null);

  const pull = useCallback(async () => readRolls(), []);

  useEffect(() => {
    let cancelled = false;
    pull().then((rows) => {
      if (cancelled) return;
      setRolls(rows);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the roll.');
    });
    return () => { cancelled = true; };
  }, [pull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then((rows) => {
      setRolls(rows);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the roll.');
    });
  }, [pull]);

  const importRoll = useCallback(async () => {
    if (busy || phase !== 'ready') return;
    if (!composing) {
      setComposing(true);
      setActionError('');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setActionError('A name is required.');
      return;
    }
    if (!file) {
      setActionError('A photo is required.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const mediaId = await uploadPhoto(file);
      const created = await lensRun<{ shoot?: { id?: string; name?: string } }>(
        'photography',
        'shoot-create',
        { name: trimmed, frames: [{ mediaId }] },
      );
      const id = created.data?.result?.shoot?.id;
      if (!created.data?.ok || !id) {
        throw new Error(created.data?.error || 'Could not import that roll.');
      }
      const rows = await readRolls();
      const row = rows.find((item) => item.id === id);
      if (!row || row.name !== trimmed || !sameFrames(row.frames, [mediaId])) {
        throw new Error('Imported, but the roll did not read it back.');
      }
      setRolls(rows);
      setName('');
      setFile(null);
      setComposing(false);
    } catch (err) {
      setActionError(describePhotoUploadError(err));
    } finally {
      setBusy(false);
    }
  }, [busy, composing, file, name, phase]);

  const addFrame = useCallback(async (rollId: string, picked: File) => {
    setBusy(true);
    setActionError('');
    try {
      const mediaId = await uploadPhoto(picked);
      const added = await lensRun('photography', 'shoot-add-frame', { rollId, mediaId });
      if (!added.data?.ok) throw new Error(added.data?.error || 'Could not add that photo.');
      const rows = await readRolls();
      const row = rows.find((item) => item.id === rollId);
      if (!row || !row.frames.some((f) => f.mediaId === mediaId)) {
        throw new Error('Added, but the roll did not read it back.');
      }
      setRolls(rows);
    } catch (err) {
      setActionError(describePhotoUploadError(err));
    } finally {
      setBusy(false);
      setAddingTo(null);
    }
  }, []);

  const deleteRoll = useCallback(async (rollId: string) => {
    setBusy(true);
    setActionError('');
    try {
      const deleted = await lensRun('photography', 'shoot-delete', { rollId });
      if (!deleted.data?.ok) throw new Error(deleted.data?.error || 'Could not delete that roll.');
      const rows = await readRolls();
      if (rows.some((row) => row.id === rollId)) {
        throw new Error('Deleted, but the roll still lists.');
      }
      setRolls(rows);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not delete that roll.');
    } finally {
      setBusy(false);
      setConfirmDeleteId(null);
    }
  }, []);

  const removeFrame = useCallback(async (rollId: string, frameId: string) => {
    setBusy(true);
    setActionError('');
    try {
      const removed = await lensRun('photography', 'shoot-remove-frame', { rollId, frameId });
      if (!removed.data?.ok) throw new Error(removed.data?.error || 'Could not remove that photo.');
      const rows = await readRolls();
      setRolls(rows);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not remove that photo.');
    } finally {
      setBusy(false);
    }
  }, []);

  useLensCommand(
    [{ id: 'photography-import', keys: 'n', description: 'Import a roll', category: 'actions', action: () => { void importRoll(); } }],
    { lensId: 'photography' },
  );

  const empty = phase === 'ready' && rolls.length === 0 && !composing;

  return (
    <LensShell lensId="photography" asMain={false}>
      <div data-lens-theme="photography" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <div className="mb-5 mt-1 flex items-center justify-between gap-4">
          <h1 className="font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">Photography</h1>
          <DTUExportButton domain="photography" data={{}} compact />
        </div>

        <section
          aria-label="Roll"
          className="min-h-[22rem] rounded-2xl border border-white/10 bg-zinc-950 px-6 py-5"
        >
          {phase === 'loading' && (
            <p data-testid="ph-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the roll.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="ph-error" role="alert">
              <p className="text-[14px] text-zinc-300">{loadError || 'Could not load the roll.'}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {empty && (
            <div data-testid="ph-empty" className="flex min-h-[20rem] items-center justify-center">
              <p className="text-[14px] text-zinc-500">No roll loaded.</p>
            </div>
          )}
          {phase === 'ready' && rolls.length > 0 && (
            <ul data-testid="ph-rolls" className="space-y-8">
              {rolls.map((roll) => (
                <li key={roll.id}>
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="font-vault text-[1.5rem] leading-8 text-zinc-100">{roll.name}</h2>
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer text-[13px] text-zinc-400 underline hover:text-zinc-200">
                        {addingTo === roll.id && busy ? 'Adding…' : 'Add photo'}
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          disabled={busy}
                          onChange={(event) => {
                            const picked = event.target.files?.[0];
                            event.target.value = '';
                            if (picked) { setAddingTo(roll.id); void addFrame(roll.id, picked); }
                          }}
                        />
                      </label>
                      {confirmDeleteId === roll.id ? (
                        <button
                          type="button"
                          onClick={() => void deleteRoll(roll.id)}
                          disabled={busy}
                          className="text-[13px] text-red-400 underline"
                        >
                          Confirm delete?
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(roll.id)}
                          disabled={busy}
                          className="text-[13px] text-zinc-500 underline hover:text-zinc-300"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {roll.frames.length > 0 && (
                    <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-6">
                      {roll.frames.map((frame) => (
                        <li key={frame.id} data-testid="ph-frame" className="group relative">
                          {frame.mediaId ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/media/${frame.mediaId}/stream`}
                              alt={frame.filename}
                              className="aspect-square w-full rounded-md border border-white/10 object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex aspect-square w-full items-center justify-center rounded-md border border-white/10 bg-zinc-900 px-2 text-center font-mono text-[11px] text-zinc-400">
                              {frame.filename}
                            </div>
                          )}
                          <button
                            type="button"
                            onClick={() => void removeFrame(roll.id, frame.id)}
                            disabled={busy}
                            className="absolute right-1 top-1 hidden h-5 w-5 rounded-full bg-black/70 text-[11px] text-zinc-200 group-hover:block"
                            aria-label={`Remove ${frame.filename}`}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {phase === 'ready' && composing && (
            <div className="mt-4 space-y-4">
              <label className="block text-[14px] text-zinc-400">
                Name
                <input
                  data-testid="ph-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="mt-1 w-full border-b border-white/15 bg-transparent pb-2 font-vault text-[1.25rem] text-zinc-100 outline-none"
                  autoFocus
                />
              </label>
              <label className="block text-[14px] text-zinc-400">
                Photo
                <input
                  data-testid="ph-file"
                  type="file"
                  accept="image/*"
                  ref={addFileInput}
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                  className="mt-1 block w-full text-[14px] text-zinc-300"
                />
              </label>
              {file ? <p className="text-[13px] text-zinc-500">{file.name}</p> : null}
            </div>
          )}
        </section>

        {actionError ? (
          <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p>
        ) : null}

        <button
          type="button"
          onClick={() => { void importRoll(); }}
          disabled={phase !== 'ready' || busy}
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {busy ? 'Working…' : 'Import a roll'}
        </button>
      </div>
    </LensShell>
  );
}
