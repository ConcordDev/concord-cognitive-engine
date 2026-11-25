'use client';

/**
 * Drives the preview worker: loads a photo's preview once, then renders the
 * current edit — a small render at once while a control moves, a sharp one
 * when it settles. Only the newest request is ever drawn (a render that
 * finishes after a newer edit was asked for is dropped, never shown).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edit, Hist } from './editTypes';

export interface Rendered { image: ImageData; quality: 'fast' | 'sharp'; ms: number; hist: Hist }
type Status = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported';

const SETTLE_MS = 180;

export function useDevelop(photo: { id: string; previewUrl: string; width: number | null } | null, edit: Edit | null) {
  const worker = useRef<Worker | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const loadedKey = useRef<string | null>(null);
  const seq = useRef(0);
  const busy = useRef(false);
  const pending = useRef<{ edit: Edit; quality: 'fast' | 'sharp'; seq: number } | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiters = useRef(new Map<string, (v: unknown) => void>());

  const send = useCallback((job: { edit: Edit; quality: 'fast' | 'sharp'; seq: number }) => {
    if (!worker.current || loadedKey.current == null) { pending.current = job; return; }
    if (busy.current) { pending.current = job; return; }
    busy.current = true;
    worker.current.postMessage({ type: 'render', ...job });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') { setStatus('unsupported'); return; }
    const w = new Worker(new URL('./develop.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (ev: MessageEvent) => {
      const m = ev.data;
      if (m.type === 'loaded') { loadedKey.current = m.key; setStatus('ready'); if (pending.current) { const j = pending.current; pending.current = null; send(j); } return; }
      if (m.type === 'rendered' || m.type === 'error') {
        busy.current = false;
        if (m.type === 'rendered' && m.seq === seq.current) {
          setRendered({ image: new ImageData(new Uint8ClampedArray(m.data.buffer as ArrayBuffer), m.width, m.height), quality: m.quality, ms: m.ms, hist: m.hist });
        }
        if (m.type === 'error') setError(m.error);
        if (pending.current) { const j = pending.current; pending.current = null; send(j); }
        return;
      }
      const key = m.type === 'mask' ? `mask:${m.seq}` : m.type === 'heal-source' ? `heal:${m.id}` : null;
      if (key && waiters.current.has(key)) { waiters.current.get(key)!(m); waiters.current.delete(key); }
    };
    w.onerror = (e) => { setStatus('error'); setError(e.message || 'The preview renderer stopped.'); };
    return () => { w.terminate(); worker.current = null; };
  }, [send]);

  // Load the photo's preview into the worker.
  useEffect(() => {
    if (!photo || !worker.current) return;
    let cancelled = false;
    loadedKey.current = null;
    setRendered(null); setStatus('loading'); setError(null);
    (async () => {
      try {
        const r = await fetch(photo.previewUrl, { credentials: 'include' });
        if (!r.ok) throw new Error(r.status === 404 ? 'This photo could not be found.' : `The preview did not load (${r.status}).`);
        const blob = await r.blob();
        if (cancelled || !worker.current) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const sharpEdge = Math.min(2048, Math.round(Math.max(window.innerWidth, window.innerHeight) * dpr * 0.85));
        worker.current.postMessage({ type: 'load', key: photo.id, blob, sharpEdge, fastEdge: 720, originalWidth: photo.width || 0 });
      } catch (e) {
        if (!cancelled) { setStatus('error'); setError(e instanceof Error ? e.message : 'The preview did not load.'); }
      }
    })();
    return () => { cancelled = true; };
  }, [photo?.id, photo?.previewUrl, photo?.width]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render whenever the edit changes: fast now, sharp once it settles.
  useEffect(() => {
    if (!edit || !photo) return;
    const s = ++seq.current;
    send({ edit, quality: 'fast', seq: s });
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => { const s2 = ++seq.current; send({ edit, quality: 'sharp', seq: s2 }); }, SETTLE_MS);
    return () => { if (settle.current) clearTimeout(settle.current); };
  }, [edit, photo, send]);

  const maskOverlay = useCallback((e: Edit, index: number) => new Promise<ImageData | null>((resolve) => {
    if (!worker.current || loadedKey.current == null) return resolve(null);
    const s = Date.now() + Math.random();
    waiters.current.set(`mask:${s}`, (m) => { const x = m as { width: number; height: number; data: Uint8ClampedArray }; resolve(new ImageData(new Uint8ClampedArray(x.data.buffer as ArrayBuffer), x.width, x.height)); });
    worker.current.postMessage({ type: 'mask', seq: s, edit: e, index });
  }), []);

  const healSource = useCallback((spot: { x: number; y: number; r: number }) => new Promise<{ sx: number; sy: number } | null>((resolve) => {
    if (!worker.current || loadedKey.current == null) return resolve(null);
    const id = `${Date.now()}${Math.random()}`;
    waiters.current.set(`heal:${id}`, (m) => resolve({ sx: (m as { sx: number }).sx, sy: (m as { sy: number }).sy }));
    worker.current.postMessage({ type: 'heal-source', id, spot });
  }), []);

  return { status, error, rendered, maskOverlay, healSource };
}
