'use client';

/** Export (a real full-resolution render from the server) and Release (free, or sold in CC). */
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { outputSize } from '@/lib/photos/develop';
import { downloadExport, dr, photoName, type ExportOptions, type Photo, type Release } from './dr';
import type { Edit } from './editTypes';

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal aria-label={title}>
      <button type="button" className="absolute inset-0 cursor-default bg-black/60" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div className="dr-panel dr-rise relative w-full max-w-md p-4">
        <div className="mb-3 flex items-center justify-between"><p className="dr-head">{title}</p><button type="button" className="dr-icon" onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
        {children}
      </div>
    </div>
  );
}

const SIZES = [{ v: 0, l: 'Full size' }, { v: 4096, l: '4096 px' }, { v: 2048, l: '2048 px' }, { v: 1600, l: '1600 px' }, { v: 1080, l: '1080 px' }];

export function sizeAt(photo: Photo, edit: Edit, longEdge: number) {
  const o = outputSize(photo.width || 1, photo.height || 1, edit);
  if (!longEdge || Math.max(o.width, o.height) <= longEdge) return o;
  const s = longEdge / Math.max(o.width, o.height);
  return { width: Math.round(o.width * s), height: Math.round(o.height * s) };
}

export function ExportDialog({ photo, edit, onClose, onToast, beforeExport }: { photo: Photo; edit: Edit; onClose: () => void; onToast: (s: string) => void; beforeExport: () => Promise<void> }) {
  const [o, setO] = useState<ExportOptions>({ format: 'jpeg', quality: 90, longEdge: 0, exif: true, location: false });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const size = sizeAt(photo, edit, o.longEdge);
  const hasGps = !!photo.exif.gps;
  return (
    <Shell title="Export" onClose={onClose}>
      <div className="space-y-3 text-[12.5px]" data-testid="dr-export">
        <div className="grid grid-cols-[90px,1fr] items-center gap-2">
          <span className="text-[var(--dr-muted)]">Format</span>
          <div className="flex gap-1">{(['jpeg', 'webp', 'png'] as const).map((f) => <button key={f} type="button" className="dr-btn h-7" aria-pressed={o.format === f} onClick={() => setO({ ...o, format: f })}>{f === 'jpeg' ? 'JPEG' : f.toUpperCase()}</button>)}</div>
          {o.format !== 'png' && <>
            <span className="text-[var(--dr-muted)]">Quality</span>
            <label className="flex items-center gap-2"><input type="range" min={50} max={100} value={o.quality} onChange={(e) => setO({ ...o, quality: Number(e.target.value) })} className="flex-1 accent-[var(--dr-safe)]" aria-label="Quality" /><span className="dr-mono w-8 text-right">{o.quality}</span></label>
          </>}
          <span className="text-[var(--dr-muted)]">Size</span>
          <select className="dr-input" value={o.longEdge} onChange={(e) => setO({ ...o, longEdge: Number(e.target.value) })} aria-label="Long edge">{SIZES.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
          <span className="text-[var(--dr-muted)]">Metadata</span>
          <div className="space-y-1">
            <label className="flex items-center gap-2"><input type="checkbox" checked={o.exif} onChange={(e) => setO({ ...o, exif: e.target.checked, location: e.target.checked && o.location })} /> Keep camera details</label>
            <label className={`flex items-center gap-2 ${!o.exif || !hasGps ? 'opacity-50' : ''}`}><input type="checkbox" disabled={!o.exif || !hasGps} checked={o.location} onChange={(e) => setO({ ...o, location: e.target.checked })} /> Keep location{!hasGps ? ' (none in this photo)' : ''}</label>
          </div>
        </div>
        <p className="dr-mono text-[11.5px] text-[var(--dr-ink-2)]" data-testid="dr-export-size">{size.width} × {size.height} px · rendered from the original, not the preview</p>
        {err && <p className="dr-error" role="alert">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="dr-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="dr-btn dr-btn-safe" disabled={busy} data-testid="dr-export-go" onClick={async () => {
            setBusy(true); setErr(null);
            await beforeExport();
            const r = await downloadExport(photo.id, o, `${photoName(photo)}.${o.format === 'jpeg' ? 'jpg' : o.format}`);
            setBusy(false);
            if (!r.ok) { setErr(r.error); return; }
            onToast(`Exported ${r.width} × ${r.height}, ${(r.bytes / 1048576).toFixed(1)} MB.`);
            onClose();
          }}><Download className="h-3.5 w-3.5" /> {busy ? 'Rendering…' : 'Export'}</button>
        </div>
      </div>
    </Shell>
  );
}

export function ReleaseDialog({ photo, edit, onClose, onToast, beforeRelease, onReleased }: {
  photo: Photo; edit: Edit; onClose: () => void; onToast: (s: string) => void; beforeRelease: () => Promise<void>; onReleased: (r: Release) => void;
}) {
  const [title, setTitle] = useState(photoName(photo));
  const [description, setDescription] = useState('');
  const [sell, setSell] = useState(true);
  const [price, setPrice] = useState('5');
  const [longEdge, setLongEdge] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Release | null>(null);
  const size = sizeAt(photo, edit, longEdge);
  const p = Number(price);
  const priceOk = !sell || (Number.isFinite(p) && p >= 0.5 && p <= 1000 && Math.round(p * 100) / 100 === p);
  return (
    <Shell title="Release this photo" onClose={onClose}>
      {done ? (
        <div className="space-y-3 text-[12.5px]" data-testid="dr-released">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={done.proofUrl} alt={`Proof of ${done.title}`} className="max-h-56 w-full rounded object-contain" />
          <p><span className="dr-title text-[16px] italic">{done.title}</span> is out: {done.priceCC > 0 ? `${done.priceCC} CC for the ${done.width} × ${done.height} file; everyone else sees a watermarked proof.` : `free to download at ${done.width} × ${done.height}.`}</p>
          <p className="text-[var(--dr-muted)]">The edit is frozen as it is now: keep editing without changing what people get.</p>
          <div className="flex justify-end"><button type="button" className="dr-btn dr-btn-safe" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form className="space-y-2 text-[12.5px]" onSubmit={async (e) => {
          e.preventDefault();
          if (!title.trim() || !priceOk) return;
          setBusy(true); setErr(null);
          await beforeRelease();
          const r = await dr<{ release: Release }>('release-create', { photoId: photo.id, title: title.trim(), description, priceCC: sell ? p : 0, longEdge });
          setBusy(false);
          if (!r.ok) { setErr(r.error); return; }
          setDone(r.result!.release); onReleased(r.result!.release); onToast('Released.');
        }} data-testid="dr-release">
          <label className="block text-[var(--dr-muted)]">Title<input className="dr-input mt-0.5" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required /></label>
          <label className="block text-[var(--dr-muted)]">About it<textarea className="dr-input mt-0.5 h-16 py-1" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} placeholder="Where, when, what you saw" /></label>
          <div className="flex gap-1">
            <button type="button" className="dr-btn" aria-pressed={sell} onClick={() => setSell(true)}>Sell</button>
            <button type="button" className="dr-btn" aria-pressed={!sell} onClick={() => setSell(false)}>Give it away</button>
          </div>
          {sell && <label className="flex items-center gap-2 text-[var(--dr-muted)]">Price <input className="dr-input dr-mono w-24" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price in Concord Coin" /> CC <span className="text-[11px]">(0.5 to 1000; you receive 95%)</span></label>}
          {sell && !priceOk && <p className="text-[11.5px] text-[var(--dr-warn)]">A price is from 0.5 to 1000 CC, in cents.</p>}
          <label className="flex items-center gap-2 text-[var(--dr-muted)]">File size
            <select className="dr-input w-auto" value={longEdge} onChange={(e) => setLongEdge(Number(e.target.value))}>{SIZES.filter((s) => s.v === 0 || s.v >= 1080).map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}</select>
            <span className="dr-mono text-[11.5px] text-[var(--dr-ink-2)]">{size.width} × {size.height}</span>
          </label>
          <p className="text-[11px] text-[var(--dr-muted)]">{sell ? 'Everyone sees a watermarked proof up to 1200 px; buyers download the full file and keep it, even if you withdraw it later.' : 'Anyone can download the file.'} Location is never included.</p>
          {err && <p className="dr-error" role="alert">{err}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="dr-btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="dr-btn dr-btn-safe" disabled={busy || !title.trim() || !priceOk} data-testid="dr-release-go">{busy ? 'Releasing…' : sell ? `Release for ${priceOk ? p : '—'} CC` : 'Release free'}</button>
          </div>
        </form>
      )}
    </Shell>
  );
}
