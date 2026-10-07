'use client';

/**
 * Photos — the frame.
 *
 * One list: GET /api/photos/mine.
 * One action: Import a file, POST /api/photos/save, then the same GET
 * must contain the new id before the caption is shown.
 * Share and delete stay, and only after the route returns a real status
 * and the follow-up list agrees.
 *
 * The world feed and friends visibility are other routes. They are not
 * on this screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { useUIStore } from '@/store/ui';
import { PhotoLightboxModal } from '@/components/photos/PhotoLightboxModal';

interface Frame {
  id: string;
  caption: string | null;
  dtu_id: string | null;
}

type Phase = 'loading' | 'ready' | 'error';

function readAsPngDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable in this browser.');
        ctx.drawImage(img, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not an image the browser can read.'));
    };
    img.src = url;
  });
}

function framesFrom(data: unknown): Frame[] {
  const rows = (data as { photos?: unknown } | null)?.photos;
  if (!Array.isArray(rows)) return [];
  const out: Frame[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) continue;
    const caption = (row as { caption?: unknown }).caption;
    const dtu = (row as { dtu_id?: unknown }).dtu_id;
    out.push({
      id,
      caption: typeof caption === 'string' ? caption : null,
      dtu_id: typeof dtu === 'string' && dtu ? dtu : null,
    });
  }
  return out;
}

async function readJson(response: Response): Promise<{ ok?: boolean; error?: string; id?: string; dtuId?: string; photos?: unknown }> {
  return response.json().catch(() => ({}));
}

export default function PhotosLensPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const fileRef = useRef<HTMLInputElement>(null);
  const addToast = useUIStore((s) => s.addToast);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [importing, setImporting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const pull = useCallback(async () => {
    const response = await fetch('/api/photos/mine', { credentials: 'include' });
    const body = await readJson(response);
    if (!response.ok || body.ok === false) {
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return framesFrom(body);
  }, []);

  const applyPull = useCallback((rows: Frame[]) => {
    setFrames(rows);
    setPhase('ready');
    setLoadError('');
  }, []);

  const failPull = useCallback((err: unknown) => {
    setPhase('error');
    setLoadError(err instanceof Error ? err.message : 'Could not load your frames.');
  }, []);

  useEffect(() => {
    let cancelled = false;
    pull()
      .then((rows) => { if (!cancelled) applyPull(rows); })
      .catch((err) => { if (!cancelled) failPull(err); });
    return () => { cancelled = true; };
  }, [pull, applyPull, failPull]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    setActionError('');
    pull().then(applyPull).catch(failPull);
  }, [pull, applyPull, failPull]);

  const onFiles = useCallback(async (files: FileList | null) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    setImporting(true);
    setActionError('');
    try {
      for (const file of list) {
        try {
          const dataUrl = await readAsPngDataUrl(file);
          const caption = file.name.replace(/\.[^.]+$/, '');
          const response = await fetch('/api/photos/save', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, caption, visibility: 'private' }),
          });
          const body = await readJson(response);
          if (!response.ok || !body.ok || !body.id) {
            throw new Error(body.error === 'blob_too_large'
              ? 'Over the 5 MB limit once converted to PNG.'
              : (body.error || `HTTP ${response.status}`));
          }
          const rows = await pull();
          if (!rows.some((row) => row.id === body.id)) {
            throw new Error('Saved, but the frame did not read it back.');
          }
          applyPull(rows);
        } catch (e) {
          const message = e instanceof Error ? e.message : 'import failed';
          setActionError(`${file.name}: ${message}`);
          addToast({ type: 'error', message: `${file.name}: ${message}` });
        }
      }
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [addToast, applyPull, pull]);

  const share = useCallback(async (id: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/photos/${id}/share`, { method: 'POST', credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || !body.ok || !body.dtuId) {
        throw new Error(body.error || `HTTP ${response.status}`);
      }
      const rows = await pull();
      const row = rows.find((item) => item.id === id);
      if (row?.dtu_id !== body.dtuId) {
        throw new Error('Shared, but the frame did not read the DTU back.');
      }
      applyPull(rows);
      addToast({ type: 'success', message: 'Photo shared — DTU minted', duration: 2500 });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not share photo';
      setActionError(message);
      addToast({ type: 'error', message });
    }
  }, [addToast, applyPull, pull]);

  const remove = useCallback(async (id: string) => {
    setActionError('');
    try {
      const response = await fetch(`/api/photos/${id}/delete`, { method: 'POST', credentials: 'include' });
      const body = await readJson(response);
      if (!response.ok || !body.ok) throw new Error(body.error || `HTTP ${response.status}`);
      const rows = await pull();
      if (rows.some((row) => row.id === id)) throw new Error('Delete did not leave the frame.');
      applyPull(rows);
      addToast({ type: 'success', message: 'Photo deleted', duration: 2500 });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete photo';
      setActionError(message);
      addToast({ type: 'error', message });
    }
  }, [addToast, applyPull, pull]);

  useLensCommand(
    [{ id: 'photos-import', keys: 'i', description: 'Import', category: 'actions', action: () => fileRef.current?.click() }],
    { lensId: 'photos' },
  );

  return (
    <LensShell lensId="photos" asMain={false}>
      <div data-lens-theme="photos" className="relative min-h-full bg-black px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">Photos</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The frame{who ? `, ${who}` : ''}
        </h1>

        <section
          aria-label="Frame"
          className="flex min-h-[22rem] flex-col items-center justify-center rounded-2xl border border-white/10 bg-zinc-950 px-6 py-16"
        >
          {phase === 'loading' && (
            <p data-testid="photos-loading" role="status" aria-busy="true" className="text-[14px] text-zinc-500">
              Opening the frame.
            </p>
          )}
          {phase === 'error' && (
            <div data-testid="photos-error" role="alert" className="text-center">
              <p className="text-[14px] text-zinc-300">{loadError}</p>
              <button type="button" onClick={load} className="mt-4 text-[14px] text-zinc-100 underline">
                Retry
              </button>
            </div>
          )}
          {phase === 'ready' && frames.length === 0 && (
            <p data-testid="photos-empty" className="text-[14px] text-zinc-500">No frame yet.</p>
          )}
          {phase === 'ready' && frames.length > 0 && (
            <ul data-testid="photos-list" className="w-full max-w-xl self-stretch">
              {frames.map((frame) => (
                <li key={frame.id} className="border-b border-white/10 py-4">
                  <button
                    type="button"
                    onClick={() => setLightboxId(frame.id)}
                    aria-label={`View photo ${frame.caption || 'Untitled'}`}
                    className="block w-full text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/photos/${frame.id}/image`}
                      alt={frame.caption || 'Untitled photo'}
                      className="mb-2 max-h-48 w-full rounded-lg object-contain"
                    />
                    <span className="text-[16px] text-zinc-100">{frame.caption || 'Untitled'}</span>
                  </button>
                  {frame.dtu_id ? (
                    <p className="mt-1 text-[12px] text-zinc-500">DTU minted · royalty active</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void share(frame.id)}
                      aria-label={`Share photo ${frame.caption || 'Untitled'}`}
                      className="mt-2 text-[13px] text-zinc-300 underline"
                    >
                      Share
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void remove(frame.id)}
                    aria-label={`Delete photo ${frame.caption || 'Untitled'}`}
                    className="ml-4 mt-2 text-[13px] text-zinc-500 underline"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
          {actionError ? <p role="alert" className="mt-4 text-[14px] text-zinc-300">{actionError}</p> : null}
        </section>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Import photos"
          onChange={(event) => void onFiles(event.target.files)}
        />

        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={importing || phase !== 'ready'}
          title="Import (I)"
          className="fixed bottom-8 right-8 z-30 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black disabled:opacity-60"
        >
          {importing ? 'Importing…' : 'Import'}
        </button>
      </div>
      <PhotoLightboxModal photoId={lightboxId} onClose={() => setLightboxId(null)} />
    </LensShell>
  );
}
