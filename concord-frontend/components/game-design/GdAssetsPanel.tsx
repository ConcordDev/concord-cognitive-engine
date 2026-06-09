'use client';

/**
 * GdAssetsPanel — asset import pipeline. Imports user-supplied sprites,
 * tilesets, audio and textures from a pasted data URL or http(s) URL.
 * No content is fetched or generated server-side — the user provides
 * the source. Sprite-sheet assets carry frame dimensions used by the
 * animation timeline.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Plus, Trash2, Image as ImageIcon, Music, Grid3x3, Box, Upload } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Asset {
  id: string; name: string; kind: string; src: string; sourceType: string;
  width: number; height: number; frameW: number; frameH: number;
  tags: string[]; bytes: number;
}

const KINDS = ['sprite', 'tileset', 'audio', 'texture', 'font', 'other'];
const KIND_ICON: Record<string, typeof ImageIcon> = {
  sprite: ImageIcon, tileset: Grid3x3, audio: Music, texture: Box, font: Box, other: Box,
};
const MAX_BYTES = 4_000_000;

function fmtBytes(n: number) {
  if (n <= 0) return 'linked';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function GdAssetsPanel({ gameId, onChange }: { gameId: string; onChange: () => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [byKind, setByKind] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'sprite', src: '', frameW: '', frameH: '', tags: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('game-design', 'asset-list', { gameId });
    setAssets(r.data?.result?.assets || []);
    setByKind(r.data?.result?.byKind || {});
    setLoading(false);
    onChange();
  }, [gameId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onFile = useCallback((file: File) => {
    if (file.size > MAX_BYTES) { setError('File exceeds the 4MB embed limit.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new window.Image();
      const baseName = file.name.replace(/\.[^.]+$/, '');
      const isImg = file.type.startsWith('image/');
      const kind = file.type.startsWith('audio/') ? 'audio' : 'sprite';
      img.onload = () => {
        setForm((f) => ({
          ...f, name: f.name.trim() || baseName, kind,
          src: dataUrl,
        }));
        setError(null);
        // Stash dimensions for import.
        pendingDims.current = { width: img.width, height: img.height };
      };
      img.onerror = () => {
        setForm((f) => ({ ...f, name: f.name.trim() || baseName, kind, src: dataUrl }));
        pendingDims.current = { width: 0, height: 0 };
      };
      if (isImg) img.src = dataUrl;
      else { setForm((f) => ({ ...f, name: f.name.trim() || baseName, kind, src: dataUrl })); pendingDims.current = { width: 0, height: 0 }; }
    };
    reader.readAsDataURL(file);
  }, []);

  const pendingDims = useRef<{ width: number; height: number }>({ width: 0, height: 0 });

  const importAsset = async () => {
    if (!form.name.trim()) { setError('Asset name is required.'); return; }
    if (!form.src.trim()) { setError('Paste a data URL / http URL or pick a file.'); return; }
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const r = await lensRun('game-design', 'asset-import', {
      gameId, name: form.name.trim(), kind: form.kind, src: form.src.trim(),
      width: pendingDims.current.width, height: pendingDims.current.height,
      frameW: Number(form.frameW) || 0, frameH: Number(form.frameH) || 0, tags,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Import failed'); return; }
    setForm({ name: '', kind: 'sprite', src: '', frameW: '', frameH: '', tags: '' });
    pendingDims.current = { width: 0, height: 0 };
    setError(null);
    await refresh();
  };

  const delAsset = async (id: string) => {
    await lensRun('game-design', 'asset-delete', { id });
    await refresh();
  };

  const setFrame = async (a: Asset, frameW: number, frameH: number) => {
    await lensRun('game-design', 'asset-update', { id: a.id, frameW, frameH });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input placeholder="Asset name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="frame W (sheet)" inputMode="numeric" value={form.frameW}
            onChange={(e) => setForm({ ...form, frameW: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="frame H (sheet)" inputMode="numeric" value={form.frameH}
            onChange={(e) => setForm({ ...form, frameH: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <input placeholder="Paste a data URL or http(s) URL" value={form.src}
          onChange={(e) => { setForm({ ...form, src: e.target.value }); pendingDims.current = { width: 0, height: 0 }; }}
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <div className="flex items-center gap-2">
          <input placeholder="tags (comma-separated)" value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input ref={fileRef} type="file" accept="image/*,audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
            <Upload className="w-3.5 h-3.5" /> File
          </button>
          <button type="button" onClick={importAsset}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-lime-600 hover:bg-lime-500 text-white rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Import
          </button>
        </div>
        {form.src.startsWith('data:image/') && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={form.src} alt="import preview" className="max-h-24 rounded border border-zinc-700" />
        )}
      </section>

      {Object.keys(byKind).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(byKind).map(([k, n]) => (
            <span key={k} className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 capitalize">{k}: {n}</span>
          ))}
        </div>
      )}

      {assets.length === 0 ? (
        <p className="text-[11px] text-zinc-400 italic py-6 text-center">No assets imported yet.</p>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {assets.map((a) => {
            const Icon = KIND_ICON[a.kind] || Box;
            return (
              <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex gap-3">
                <div className="w-16 h-16 shrink-0 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden">
                  {a.src.startsWith('data:image/') || (a.kind === 'sprite' || a.kind === 'tileset' || a.kind === 'texture') && /^https?:\/\//i.test(a.src) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.src} alt={a.name} className="max-w-full max-h-full object-contain" />
                  ) : (
                    <Icon className="w-6 h-6 text-zinc-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100 truncate">{a.name}</span>
                    <span className="text-[10px] uppercase text-lime-400">{a.kind}</span>
                    <div className="flex-1" />
                    <button aria-label="Delete" type="button" onClick={() => delAsset(a.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-400">
                    {a.width > 0 ? `${a.width}×${a.height}` : a.sourceType} · {fmtBytes(a.bytes)}
                  </p>
                  {(a.kind === 'sprite' || a.kind === 'tileset') && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400">frame</span>
                      <input type="number" min={0} value={a.frameW || ''} placeholder="W"
                        onChange={(e) => setFrame(a, Number(e.target.value) || 0, a.frameH)}
                        className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                      <input type="number" min={0} value={a.frameH || ''} placeholder="H"
                        onChange={(e) => setFrame(a, a.frameW, Number(e.target.value) || 0)}
                        className="w-14 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                      {a.frameW > 0 && a.frameH > 0 && a.width > 0 && (
                        <span className="text-[10px] text-zinc-400">
                          {Math.floor(a.width / a.frameW) * Math.max(1, Math.floor(a.height / a.frameH))} frames
                        </span>
                      )}
                    </div>
                  )}
                  {a.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {a.tags.map((t) => <span key={t} className="text-[9px] px-1.5 rounded bg-zinc-800 text-zinc-400">{t}</span>)}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
