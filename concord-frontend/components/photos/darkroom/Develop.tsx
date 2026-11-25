'use client';

/**
 * The Develop room: the photo large on a mid-grey surround, the live
 * histogram and every develop panel on the right, history / snapshots /
 * presets on the left, the filmstrip below. Edits render at once in the
 * preview worker and save to the server as named history steps; nothing
 * ever rewrites the original.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bandage, ChevronLeft, Circle, Copy, Crop, Download, Eye, EyeOff, Maximize, Minus, Paintbrush, Redo2, Tag, Undo2 } from 'lucide-react';
import { defaultEdit, normalizeEdit, isDefaultEdit } from '@/lib/photos/develop';
import { dr, photoName, shutter, type HistoryStep, type Photo, type PhotoDetail, type Preset, type Release } from './dr';
import { Histogram } from './controls';
import { BasicPanel, CurvePanel, DetailPanel, GeometryPanel, HslPanel, MasksPanel, RetouchPanel } from './DevelopPanels';
import { Viewer, type BrushSettings, type Tool } from './Viewer';
import { useDevelop } from './useDevelop';
import { ASPECTS, type Edit } from './editTypes';
import { ExportDialog, ReleaseDialog } from './Dialogs';
import { Stars } from './Library';

const PARTS: { id: string; label: string }[] = [
  { id: 'basic', label: 'Light & colour' }, { id: 'curve', label: 'Tone curve' }, { id: 'hsl', label: 'Colour mixer' },
  { id: 'detail', label: 'Detail' }, { id: 'effects', label: 'Effects' }, { id: 'geometry', label: 'Crop & rotation' },
  { id: 'masks', label: 'Masks' }, { id: 'spots', label: 'Retouching' },
];
const SAVE_MS = 450;

export function Develop({ photo, list, onBack, onOpen, onToast, copied, setCopied, onPhotoChanged }: {
  photo: Photo; list: Photo[]; onBack: () => void; onOpen: (p: Photo) => void; onToast: (s: string) => void;
  copied: { fromId: string; parts: string[] } | null; setCopied: (c: { fromId: string; parts: string[] } | null) => void;
  onPhotoChanged: (p: Photo) => void;
}) {
  const [detail, setDetail] = useState<PhotoDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [tool, setTool] = useState<Tool>('none');
  const [aspect, setAspect] = useState('free');
  const [maskSel, setMaskSel] = useState<number | null>(null);
  const [spotSel, setSpotSel] = useState<number | null>(null);
  const [spotMode, setSpotMode] = useState<'heal' | 'clone'>('heal');
  const [spotSize, setSpotSize] = useState(0.025);
  const [brush, setBrush] = useState<BrushSettings>({ size: 0.05, feather: 0.5, flow: 1, erase: false });
  const [showOverlay, setShowOverlay] = useState(false);
  const [overlay, setOverlay] = useState<ImageData | null>(null);
  const [clip, setClip] = useState(false);
  const [before, setBefore] = useState(false);
  const [zoom, setZoom] = useState<'fit' | '1:1'>('fit');
  const [dialog, setDialog] = useState<null | 'export' | 'release' | 'copy' | 'preset' | 'snapshot'>(null);
  const [copyParts, setCopyParts] = useState<string[]>(['basic', 'curve', 'hsl', 'detail', 'effects']);
  const [nameDraft, setNameDraft] = useState('');
  const undo = useRef<Edit[]>([]), redo = useRef<Edit[]>([]);
  const lastCommitted = useRef<Edit | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSave = useRef<{ edit: Edit; label: string } | null>(null);

  const load = useCallback(async () => {
    setDetail(null); setErr(null); setEdit(null);
    const r = await dr<PhotoDetail>('photo', { id: photo.id });
    if (!r.ok) { setErr(r.error); return; }
    const e = normalizeEdit(r.result!.edit);
    setDetail(r.result); setEdit(e); setHistory(r.result!.history);
    lastCommitted.current = e; undo.current = []; redo.current = [];
  }, [photo.id]);
  useEffect(() => { void load(); setTool('none'); setMaskSel(null); setSpotSel(null); setBefore(false); }, [load]);
  useEffect(() => { void dr<{ presets: Preset[] }>('preset-list').then((r) => r.ok && setPresets(r.result!.presets)); }, []);

  const flush = useCallback(async () => {
    const job = pendingSave.current; if (!job) return;
    pendingSave.current = null;
    setSaving('saving');
    const r = await dr<{ edit: Edit; historyId: number; edited: boolean }>('edit-save', { id: photo.id, edit: job.edit, label: job.label });
    if (!r.ok) { setSaving('error'); onToast(r.error || 'The edit did not save.'); return; }
    setSaving('saved');
    setHistory((h) => [{ id: r.result!.historyId, label: job.label, snapshot: false, at: Math.round(Date.now() / 1000) }, ...h].slice(0, 100));
    onPhotoChanged({ ...photo, edited: r.result!.edited });
  }, [photo, onToast, onPhotoChanged]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); void flush(); }, [flush]);

  /** Every change: show it now; a final one becomes an undo step and a saved history step. */
  const change = useCallback((next: Edit, final: boolean, label: string) => {
    setEdit(next);
    if (!final) return;
    if (lastCommitted.current && JSON.stringify(lastCommitted.current) === JSON.stringify(next)) return;
    if (lastCommitted.current) undo.current.push(lastCommitted.current);
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    lastCommitted.current = next;
    // A different control is a different history step: save the last one now.
    if (pendingSave.current && pendingSave.current.label.split(' ')[0] !== label.split(' ')[0]) { if (saveTimer.current) clearTimeout(saveTimer.current); void flush(); }
    pendingSave.current = { edit: next, label };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, SAVE_MS);
  }, [flush]);
  const step = (dir: 'undo' | 'redo') => {
    const from = dir === 'undo' ? undo.current : redo.current, to = dir === 'undo' ? redo.current : undo.current;
    const target = from.pop(); if (!target || !lastCommitted.current) return;
    to.push(lastCommitted.current);
    lastCommitted.current = target;
    setEdit(target);
    pendingSave.current = { edit: target, label: dir === 'undo' ? 'Undo' : 'Redo' };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { void flush(); }, SAVE_MS);
  };

  // What the viewer draws: the whole frame while cropping; geometry only for "before".
  const shown = useMemo(() => {
    if (!edit) return null;
    if (before) return { ...defaultEdit(), geometry: edit.geometry };
    if (tool === 'crop') return { ...edit, geometry: { ...edit.geometry, crop: { x: 0, y: 0, w: 1, h: 1 } } };
    return edit;
  }, [edit, before, tool]);
  const devPhoto = useMemo(() => (detail ? { id: photo.id, previewUrl: photo.previewUrl, width: photo.width } : null), [detail, photo.id, photo.previewUrl, photo.width]);
  const dev = useDevelop(devPhoto, shown);

  useEffect(() => {
    if (!showOverlay || maskSel == null || !edit) { setOverlay(null); return; }
    let live = true;
    void dev.maskOverlay(edit, maskSel).then((img) => { if (live) setOverlay(img); });
    return () => { live = false; };
  }, [showOverlay, maskSel, edit, dev.maskOverlay]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyAspect = (id: string) => {
    setAspect(id);
    const a = ASPECTS.find((x) => x.id === id);
    if (!edit || !a?.ratio) return;
    const n: Edit = JSON.parse(JSON.stringify(edit));
    const [fw, fh] = n.geometry.orient % 180 ? [photo.height || 1, photo.width || 1] : [photo.width || 1, photo.height || 1];
    const ratio = a.ratio === -1 ? fw / fh : a.ratio;
    let w = 1, h = (fw / ratio) / fh;
    if (h > 1) { h = 1; w = (fh * ratio) / fw; }
    n.geometry.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
    change(n, true, `Crop ${a.label}`);
    setTool('crop');
  };

  const idx = list.findIndex((p) => p.id === photo.id);
  const go = (d: number) => { const p = list[idx + d]; if (p) onOpen(p); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); step(e.shiftKey ? 'redo' : 'undo'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'c') { e.preventDefault(); setDialog('copy'); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { e.preventDefault(); if (copied && copied.fromId !== photo.id) void pasteHere(); return; }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); setDialog('export'); return; }
      if (mod) return;
      if (e.key === '\\') { setBefore((b) => !b); return; }
      if (e.key === 'r' || e.key === 'R') setTool((x) => (x === 'crop' ? 'none' : 'crop'));
      else if (e.key === 'q' || e.key === 'Q') setTool((x) => (x === 'spot' ? 'none' : 'spot'));
      else if (e.key === 'k' || e.key === 'K') { setMaskSel(null); setTool((x) => (x === 'brush' ? 'none' : 'brush')); }
      else if (e.key === 'M') { setMaskSel(null); setTool((x) => (x === 'radial' ? 'none' : 'radial')); }
      else if (e.key === 'm') { setMaskSel(null); setTool((x) => (x === 'linear' ? 'none' : 'linear')); }
      else if (e.key === 'j' || e.key === 'J') setClip((c) => !c);
      else if (e.key === 'o' || e.key === 'O') setShowOverlay((v) => !v);
      else if (e.key === 'z' || e.key === 'Z') setZoom((z) => (z === 'fit' ? '1:1' : 'fit'));
      else if (e.key === 'g' || e.key === 'G' || e.key === 'Escape') { if (tool !== 'none') setTool('none'); else if (e.key !== 'Escape') onBack(); }
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && edit) {
        if (tool === 'spot' && spotSel != null) { const n: Edit = JSON.parse(JSON.stringify(edit)); n.spots.splice(spotSel, 1); setSpotSel(null); change(n, true, 'Delete spot'); }
        else if (maskSel != null) { const n: Edit = JSON.parse(JSON.stringify(edit)); n.masks.splice(maskSel, 1); setMaskSel(null); change(n, true, 'Delete mask'); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pasteHere = async () => {
    if (!copied) return;
    await flush();
    const r = await dr<{ applied: number }>('settings-paste', { ids: [photo.id], fromPhotoId: copied.fromId, parts: copied.parts });
    if (!r.ok) { onToast(r.error || 'Not pasted.'); return; }
    onToast('Settings pasted.');
    await load();
  };

  const rate = async (n: number) => {
    const r = await dr<{ photos: Photo[] }>('catalog-set', { id: photo.id, rating: n });
    if (r.ok) onPhotoChanged(r.result!.photos[0]);
  };

  if (err) return <div className="p-6"><p className="dr-error" role="alert">{err}</p><button type="button" className="dr-btn mt-3" onClick={onBack}><ChevronLeft className="h-3.5 w-3.5" /> Library</button></div>;

  const ex = detail?.photo.exif;
  const status = !edit ? 'Opening the photo…' : dev.status === 'loading' ? 'Loading the preview…' : dev.status === 'error' ? dev.error || 'The preview failed.' : dev.status === 'unsupported' ? 'This browser cannot render a preview.' : 'Developing…';

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr,auto]" data-testid="dr-develop">
      <div className="grid min-h-0 grid-cols-1 lg:grid-cols-[220px,1fr,300px]">
        {/* Left: history, snapshots, presets */}
        <aside className="dr-scroll hidden min-h-0 overflow-y-auto border-r border-[var(--dr-rule)] lg:block">
          <div className="p-3">
            <button type="button" className="dr-btn mb-3" onClick={onBack} data-testid="dr-back"><ChevronLeft className="h-3.5 w-3.5" /> Library <span className="dr-kbd">G</span></button>
            <p className="dr-title text-[17px] leading-tight">{photoName(photo)}</p>
            <div className="mt-1 flex items-center justify-between"><Stars n={photo.rating} onSet={rate} size={13} /><span className="dr-mono text-[10.5px] text-[var(--dr-muted)]">{idx + 1} / {list.length || 1}</span></div>
          </div>
          <div className="border-t border-[var(--dr-rule)] p-3">
            <div className="mb-1 flex items-center justify-between"><p className="dr-head">Presets</p><button type="button" className="text-[11px] text-[var(--dr-muted)] hover:text-[var(--dr-ink)]" onClick={() => { setNameDraft(''); setDialog('preset'); }} disabled={!edit || isDefaultEdit(edit)}>+ Save look</button></div>
            {!presets.length && <p className="text-[11.5px] text-[var(--dr-muted)]">Save this photo's look to use it on others.</p>}
            <ul className="space-y-0.5" data-testid="dr-presets">
              {presets.map((p) => (
                <li key={p.id} className="group flex items-center">
                  <button type="button" className="flex-1 truncate rounded px-2 py-1 text-left text-[12.5px] text-[var(--dr-ink-2)] hover:bg-[var(--dr-panel)] hover:text-[var(--dr-ink)]" onClick={() => {
                    if (!edit) return;
                    const n: Edit = JSON.parse(JSON.stringify(edit));
                    for (const k of ['basic', 'curve', 'hsl', 'detail', 'effects'] as const) (n as unknown as Record<string, unknown>)[k] = JSON.parse(JSON.stringify(p.edit[k]));
                    change(n, true, `Preset: ${p.name}`);
                  }}>{p.name}</button>
                  <button type="button" className="hidden px-1 text-[11px] text-[var(--dr-muted)] hover:text-[var(--dr-bad)] group-hover:block" aria-label={`Delete preset ${p.name}`} onClick={async () => { const r = await dr('preset-delete', { id: p.id }); if (r.ok) setPresets((x) => x.filter((y) => y.id !== p.id)); }}>×</button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-[var(--dr-rule)] p-3">
            <div className="mb-1 flex items-center justify-between"><p className="dr-head">Snapshots</p><button type="button" className="text-[11px] text-[var(--dr-muted)] hover:text-[var(--dr-ink)]" onClick={() => { setNameDraft(''); setDialog('snapshot'); }}>+ Take</button></div>
            <ul className="space-y-0.5" data-testid="dr-snapshots">
              {history.filter((h) => h.snapshot).map((h) => <li key={h.id}><button type="button" className="w-full truncate rounded px-2 py-1 text-left text-[12.5px] text-[var(--dr-ink-2)] hover:bg-[var(--dr-panel)]" onClick={() => void revert(h)}>{h.label}</button></li>)}
              {!history.some((h) => h.snapshot) && <li className="text-[11.5px] text-[var(--dr-muted)]">Name a version to come back to it.</li>}
            </ul>
          </div>
          <div className="border-t border-[var(--dr-rule)] p-3">
            <p className="dr-head mb-1">History</p>
            <ol className="space-y-0.5" data-testid="dr-history">
              {history.filter((h) => !h.snapshot).slice(0, 40).map((h, i) => (
                <li key={h.id}><button type="button" className={`w-full truncate rounded px-2 py-0.5 text-left text-[12px] ${i === 0 ? 'text-[var(--dr-ink)]' : 'text-[var(--dr-muted)] hover:text-[var(--dr-ink-2)]'}`} onClick={() => void revert(h)} title="Go back to this step">{h.label}</button></li>
              ))}
              {!history.some((h) => !h.snapshot) && <li className="text-[11.5px] text-[var(--dr-muted)]">Every change you make is listed here.</li>}
            </ol>
          </div>
        </aside>

        {/* Centre: the photo */}
        <section className="relative flex min-h-[320px] flex-col">
          <div className="flex flex-wrap items-center gap-1 border-b border-[var(--dr-rule)] px-2 py-1.5">
            <button type="button" className="dr-icon lg:hidden" onClick={onBack} aria-label="Back to the library"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" className="dr-icon" onClick={() => step('undo')} aria-label="Undo (⌘Z)" title="Undo ⌘Z"><Undo2 className="h-4 w-4" /></button>
            <button type="button" className="dr-icon" onClick={() => step('redo')} aria-label="Redo (⇧⌘Z)" title="Redo ⇧⌘Z"><Redo2 className="h-4 w-4" /></button>
            <span className="mx-1 h-4 w-px bg-[var(--dr-rule)]" />
            <button type="button" className="dr-btn h-7" aria-pressed={before} onClick={() => setBefore((b) => !b)} data-testid="dr-before">{before ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} Before <span className="dr-kbd">\</span></button>
            <button type="button" className="dr-btn h-7" aria-pressed={zoom === '1:1'} onClick={() => setZoom((z) => (z === 'fit' ? '1:1' : 'fit'))}><Maximize className="h-3.5 w-3.5" /> {zoom === 'fit' ? 'Fit' : '1:1'} <span className="dr-kbd">Z</span></button>
            <button type="button" className="dr-btn h-7" aria-pressed={clip} onClick={() => setClip((c) => !c)}>Clipping <span className="dr-kbd">J</span></button>
            <span className="ml-auto flex items-center gap-1">
              <span className="dr-mono hidden text-[10.5px] text-[var(--dr-muted)] sm:inline" aria-live="polite" data-testid="dr-save-state">
                {saving === 'saving' ? 'saving…' : saving === 'saved' ? 'saved' : saving === 'error' ? 'not saved' : ''}{dev.rendered ? ` · ${dev.rendered.image.width}×${dev.rendered.image.height} in ${dev.rendered.ms} ms` : ''}
              </span>
              <button type="button" className="dr-btn h-7" onClick={() => setDialog('copy')} title="Copy settings ⇧⌘C"><Copy className="h-3.5 w-3.5" /> Copy</button>
              {copied && copied.fromId !== photo.id && <button type="button" className="dr-btn h-7" onClick={() => void pasteHere()} title="Paste settings ⇧⌘V">Paste</button>}
              <button type="button" className="dr-btn h-7" onClick={() => setDialog('export')} data-testid="dr-export-open" title="Export ⇧⌘E"><Download className="h-3.5 w-3.5" /> Export</button>
              <button type="button" className="dr-btn dr-btn-safe h-7" onClick={() => setDialog('release')} data-testid="dr-release-open"><Tag className="h-3.5 w-3.5" /> Release</button>
            </span>
          </div>
          <div className="relative min-h-0 flex-1">
            {edit && shown && (
              <Viewer image={dev.rendered?.image || null} edit={edit} shown={shown} srcW={photo.width || 1} srcH={photo.height || 1}
                tool={before ? 'none' : tool} cropAspect={(() => { const a = ASPECTS.find((x) => x.id === aspect); return a?.ratio ?? null; })()}
                selectedMask={maskSel} selectedSpot={spotSel} spotMode={spotMode} spotSize={spotSize} brush={brush}
                overlay={overlay} clip={clip} zoom={zoom} status={status}
                onEdit={change} onSelectMask={setMaskSel} onSelectSpot={setSpotSel}
                onSpotPlaced={async (i, spot) => {
                  setSpotSel(i);
                  if (spot.mode !== 'heal' && spot.mode !== 'clone') return;
                  const src = await dev.healSource(spot);
                  if (!src) return;
                  setEdit((cur) => {
                    if (!cur || !cur.spots[i]) return cur;
                    const n: Edit = JSON.parse(JSON.stringify(cur));
                    n.spots[i].sx = src.sx; n.spots[i].sy = src.sy;
                    lastCommitted.current = n;
                    pendingSave.current = { edit: n, label: spot.mode === 'heal' ? 'Spot heal' : 'Spot clone' };
                    if (saveTimer.current) clearTimeout(saveTimer.current);
                    saveTimer.current = setTimeout(() => { void flush(); }, SAVE_MS);
                    return n;
                  });
                }} />
            )}
            {!edit && <div className="dr-canvas-wrap flex h-full items-center justify-center"><div className="dr-skeleton h-1/2 w-1/2" role="status" aria-label="Opening the photo" /></div>}
            {before && <span className="dr-head pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-white">Before</span>}
            {dev.status === 'error' && <p className="dr-error absolute bottom-3 left-3" role="alert">{dev.error}</p>}
          </div>
        </section>

        {/* Right: histogram + panels */}
        <aside className="dr-scroll min-h-0 overflow-y-auto border-l border-[var(--dr-rule)]" data-testid="dr-panels">
          <div className="p-3">
            <Histogram hist={dev.rendered?.hist || null} clip={clip} onToggleClip={() => setClip((c) => !c)}
              exif={{ iso: ex?.iso, fNumber: ex?.fNumber, shutter: shutter(ex?.exposureTime), focal: ex?.focalLength }} />
            <div className="mt-2 grid grid-cols-5 gap-1" role="toolbar" aria-label="Tools" data-testid="dr-toolstrip">
              {([
                { t: 'crop', label: 'Crop & straighten', key: 'R', Icon: Crop },
                { t: 'spot', label: 'Spot removal', key: 'Q', Icon: Bandage },
                { t: 'radial', label: 'Radial mask', key: '⇧M', Icon: Circle },
                { t: 'linear', label: 'Linear mask', key: 'M', Icon: Minus },
                { t: 'brush', label: 'Brush mask', key: 'K', Icon: Paintbrush },
              ] as const).map(({ t, label, key, Icon }) => (
                <button key={t} type="button" className="dr-icon h-8 w-full" aria-pressed={tool === t} title={`${label} (${key})`} aria-label={label}
                  onClick={() => { if (t === 'radial' || t === 'linear' || t === 'brush') setMaskSel(null); setTool(tool === t ? 'none' : t); }} data-testid={`dr-strip-${t}`}>
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
          {edit && (
            <>
              <BasicPanel edit={edit} onChange={change} hist={dev.rendered?.hist || null} />
              <CurvePanel edit={edit} onChange={change} />
              <HslPanel edit={edit} onChange={change} />
              <DetailPanel edit={edit} onChange={change} />
              <GeometryPanel edit={edit} onChange={change} tool={tool} setTool={setTool} aspect={aspect} setAspect={applyAspect} />
              <MasksPanel edit={edit} onChange={change} tool={tool} setTool={setTool} selected={maskSel} setSelected={setMaskSel} showOverlay={showOverlay} setShowOverlay={setShowOverlay} brush={brush} setBrush={setBrush} />
              <RetouchPanel edit={edit} onChange={change} tool={tool} setTool={setTool} mode={spotMode} setMode={setSpotMode} size={spotSize} setSize={setSpotSize} selected={spotSel} setSelected={setSpotSel} />
              {detail?.releases?.length ? (
                <div className="border-t border-[var(--dr-rule)] p-3 text-[12px]">
                  <p className="dr-head mb-1">Released</p>
                  {detail.releases.map((r: Release) => <p key={r.id} className="text-[var(--dr-ink-2)]">{r.title} · {r.priceCC > 0 ? `${r.priceCC} CC` : 'free'} · {r.status}{r.buyers ? ` · ${r.buyers} sold` : ''}</p>)}
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      {/* Filmstrip */}
      <nav className="dr-scroll flex gap-1.5 overflow-x-auto border-t border-[var(--dr-rule)] bg-[var(--dr-void)] px-2 py-1.5" aria-label="Filmstrip" data-testid="dr-filmstrip">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => onOpen(p)} aria-current={p.id === photo.id ? 'true' : undefined} aria-label={photoName(p)}
            className={`dr-thumb h-[58px] w-[78px] shrink-0 ${p.id === photo.id ? '!border-[var(--dr-safe)]' : ''}`} data-rejected={p.flag === 'reject'}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.thumbUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
      </nav>

      {dialog === 'export' && edit && <ExportDialog photo={photo} edit={edit} onClose={() => setDialog(null)} onToast={onToast} beforeExport={flush} />}
      {dialog === 'release' && edit && <ReleaseDialog photo={photo} edit={edit} onClose={() => setDialog(null)} onToast={onToast} beforeRelease={flush} onReleased={async () => { const r = await dr<PhotoDetail>('photo', { id: photo.id }); if (r.ok) setDetail((d) => (d ? { ...d, releases: r.result!.releases } : d)); }} />}
      {(dialog === 'copy' || dialog === 'preset' || dialog === 'snapshot') && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal aria-label={dialog === 'copy' ? 'Copy settings' : dialog === 'preset' ? 'Save a preset' : 'Take a snapshot'} onKeyDown={(e) => { if (e.key === 'Escape') setDialog(null); }}>
          <button type="button" className="absolute inset-0 cursor-default bg-black/60" aria-label="Close" tabIndex={-1} onClick={() => setDialog(null)} />
          <form className="dr-panel dr-rise relative w-full max-w-sm p-4" onSubmit={async (e) => {
            e.preventDefault();
            if (dialog === 'copy') { setCopied({ fromId: photo.id, parts: copyParts }); onToast(`Copied ${copyParts.length} setting group${copyParts.length === 1 ? '' : 's'}: paste in the library or on another photo.`); setDialog(null); return; }
            if (!nameDraft.trim() || !edit) return;
            if (dialog === 'preset') {
              const r = await dr<{ preset: Preset }>('preset-create', { name: nameDraft.trim(), edit });
              if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
              setPresets((x) => [...x, r.result!.preset].sort((a, b) => a.name.localeCompare(b.name)));
              onToast(`Preset "${r.result!.preset.name}" saved.`);
            } else {
              await flush();
              const r = await dr<{ id: number; label: string }>('snapshot-create', { id: photo.id, name: nameDraft.trim() });
              if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
              setHistory((h) => [{ id: r.result!.id, label: r.result!.label, snapshot: true, at: Math.round(Date.now() / 1000) }, ...h]);
            }
            setDialog(null);
          }}>
            <p className="dr-head mb-3">{dialog === 'copy' ? 'Copy settings' : dialog === 'preset' ? 'Save this look as a preset' : 'Take a snapshot'}</p>
            {dialog === 'copy' ? (
              <div className="grid grid-cols-2 gap-1">
                {PARTS.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={copyParts.includes(p.id)} onChange={(e) => setCopyParts((c) => (e.target.checked ? [...c, p.id] : c.filter((x) => x !== p.id)))} />{p.label}</label>
                ))}
              </div>
            ) : (
              <>
                <input autoFocus className="dr-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder={dialog === 'preset' ? 'Preset name' : 'Snapshot name'} maxLength={60} aria-label="Name" />
                {dialog === 'preset' && <p className="mt-1 text-[11px] text-[var(--dr-muted)]">A preset keeps light, colour, curve, colour mixer, detail and effects, never the crop or retouching.</p>}
              </>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="dr-btn" onClick={() => setDialog(null)}>Cancel</button>
              <button type="submit" className="dr-btn dr-btn-safe" disabled={dialog === 'copy' ? !copyParts.length : !nameDraft.trim()}>{dialog === 'copy' ? 'Copy' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );

  async function revert(h: HistoryStep) {
    await flush();
    const r = await dr<{ edit: Edit }>('edit-revert', { id: photo.id, historyId: h.id });
    if (!r.ok) { onToast(r.error || 'Could not go back.'); return; }
    const e = normalizeEdit(r.result!.edit);
    if (lastCommitted.current) undo.current.push(lastCommitted.current);
    lastCommitted.current = e; setEdit(e);
    setHistory((x) => [{ id: Date.now(), label: `Back to: ${h.label}`, snapshot: false, at: Math.round(Date.now() / 1000) }, ...x]);
  }
}
