'use client';

/**
 * The Library: import, cull and organise. A grid of the photos with their
 * stars, pick/reject flags and colour labels; a filter bar for culling;
 * albums (and smart albums — a saved filter); batch rating, keywords,
 * presets and pasted settings across a selection; and the camera facts of
 * the photo in hand.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag, FolderPlus, ImagePlus, Search, Star, Trash2, Upload, Wand2, X } from 'lucide-react';
import { api } from '@/lib/api/client';
import { dr, importFile, IMPORT_TYPES, LABELS, bytes, dateOf, photoName, shutter, type Album, type Filter, type Label, type Library as Lib, type Photo, type Preset } from './dr';

const FLAG_NAMES = { pick: 'Pick', reject: 'Reject', none: 'Unflagged' };
const SORTS = [{ id: 'captured', label: 'Capture time' }, { id: 'imported', label: 'Import time' }, { id: 'rating', label: 'Rating' }, { id: 'name', label: 'Name' }];

function Stars({ n, onSet, size = 12 }: { n: number; onSet?: (n: number) => void; size?: number }) {
  return (
    <span className="inline-flex items-center gap-[1px]" aria-label={`${n} star${n === 1 ? '' : 's'}`}>
      {[1, 2, 3, 4, 5].map((k) => (
        onSet ? (
          <button key={k} type="button" onClick={(e) => { e.stopPropagation(); onSet(n === k ? 0 : k); }} aria-label={`${k} star${k === 1 ? '' : 's'}`} className="leading-none">
            <Star style={{ width: size, height: size }} className={k <= n ? 'fill-[var(--dr-star)] text-[var(--dr-star)]' : 'text-[var(--dr-faint)]'} />
          </button>
        ) : <Star key={k} style={{ width: size, height: size }} className={k <= n ? 'fill-[var(--dr-star)] text-[var(--dr-star)]' : 'text-[var(--dr-faint)]'} />
      ))}
    </span>
  );
}
export { Stars };

/** Owns its own text so typing never re-renders the grid. */
function CreateAlbumForm({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const empty = !name.trim();
  return (
    <form className="mt-1 space-y-1" onSubmit={async (e) => { e.preventDefault(); if (empty) return; setBusy(true); await onCreate(name.trim()); setName(''); setBusy(false); }}>
      <div className="flex gap-1">
        <input className="dr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="New album" aria-label="New album name" maxLength={80} />
        <button type="submit" className="dr-btn" disabled={empty || busy} aria-describedby={empty ? 'dr-album-hint' : undefined}>Create</button>
      </div>
      {empty && name.length > 0 && <p id="dr-album-hint" className="text-[11px] text-[var(--dr-muted)]">Name the album to create it.</p>}
    </form>
  );
}

/** Save the current filter as a smart album; owns its own text. */
function SmartAlbumForm({ onSave }: { onSave: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) return <button type="button" className="dr-btn mt-2 w-full justify-center text-[11.5px]" data-testid="dr-save-smart" onClick={() => setOpen(true)}><Wand2 className="h-3 w-3" /> Save as smart album</button>;
  return (
    <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; await onSave(name.trim()); setName(''); setOpen(false); }}>
      <input autoFocus className="dr-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smart album name" aria-label="Smart album name" maxLength={80} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      <button type="submit" className="dr-btn" disabled={!name.trim()}>Save</button>
    </form>
  );
}

/** Caption, alt text and keywords for one photo; owns its own text. */
function CaptionEditForm({ photo, onSave }: { photo: Photo; onSave: (patch: { caption: string; altText: string; tags: string[] }) => Promise<void> }) {
  const [caption, setCaption] = useState(photo.caption || '');
  const [alt, setAlt] = useState(photo.altText || '');
  const [tags, setTags] = useState(photo.tags.join(', '));
  const [saved, setSaved] = useState(false);
  useEffect(() => { setCaption(photo.caption || ''); setAlt(photo.altText || ''); setTags(photo.tags.join(', ')); }, [photo.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = caption !== (photo.caption || '') || alt !== (photo.altText || '') || tags !== photo.tags.join(', ');
  return (
    <form className="space-y-1.5" onSubmit={async (e) => { e.preventDefault(); await onSave({ caption, altText: alt, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }); setSaved(true); setTimeout(() => setSaved(false), 1500); }}>
      <label className="block text-[11.5px] text-[var(--dr-muted)]">Title<input className="dr-input mt-0.5" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={280} /></label>
      <label className="block text-[11.5px] text-[var(--dr-muted)]">Alt text<textarea className="dr-input mt-0.5 h-14 py-1" value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={300} placeholder="What's in the photo, for screen readers" /></label>
      <label className="block text-[11.5px] text-[var(--dr-muted)]">Keywords<input className="dr-input mt-0.5" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="harbour, dawn, film" /></label>
      <button type="submit" className="dr-btn" disabled={!dirty}>{saved ? 'Saved' : 'Save'}</button>
    </form>
  );
}

export function Library({ onDevelop, onChanged, onToast, selectedId, setSelectedId, copied, refreshKey }: {
  onDevelop: (photo: Photo, list: Photo[]) => void; onChanged: (list: Photo[]) => void; onToast: (s: string) => void;
  selectedId: string | null; setSelectedId: (id: string | null) => void; copied: { fromId: string; parts: string[] } | null; refreshKey: number;
}) {
  const [lib, setLib] = useState<Lib | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({});
  const [sort, setSort] = useState('captured');
  const [albums, setAlbums] = useState<Album[]>([]);
  const [album, setAlbum] = useState<Album | null>(null);
  const [albumPhotos, setAlbumPhotos] = useState<Photo[] | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [imports, setImports] = useState<{ total: number; done: number; errors: string[] } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [kw, setKw] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const anchor = useRef<string | null>(null);

  const load = useCallback(async () => {
    const r = await dr<Lib>('library', { filter, sort });
    if (!r.ok) { setErr(r.error); return; }
    setErr(null); setLib(r.result);
  }, [filter, sort]);
  const loadAlbums = useCallback(async () => { const r = await dr<{ albums: Album[] }>('album-index'); if (r.ok) setAlbums(r.result!.albums); }, []);
  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => { void loadAlbums(); void dr<{ presets: Preset[] }>('preset-list').then((r) => r.ok && setPresets(r.result!.presets)); }, [loadAlbums, refreshKey]);
  useEffect(() => {
    if (!album) { setAlbumPhotos(null); return; }
    void dr<{ photos: Photo[] }>('album-open', { albumId: album.id }).then((r) => setAlbumPhotos(r.ok ? r.result!.photos : []));
  }, [album, lib]);

  const photos = useMemo(() => albumPhotos ?? lib?.photos ?? [], [albumPhotos, lib]);
  useEffect(() => { onChanged(photos); }, [photos, onChanged]);
  const selected = photos.find((p) => p.id === selectedId) || null;
  const targets = sel.size ? [...sel] : selectedId ? [selectedId] : [];

  const patchLocal = (list: Photo[]) => setLib((l) => (l ? { ...l, photos: l.photos.map((p) => list.find((x) => x.id === p.id) || p) } : l));
  const catalog = useCallback(async (patch: Record<string, unknown>, ids = targets) => {
    if (!ids.length) return;
    // Optimistic: show it now, settle with the server's answer.
    let before: Photo[] = [];
    setLib((l) => { before = (l?.photos || []).filter((p) => ids.includes(p.id)); return l ? { ...l, photos: l.photos.map((p) => (ids.includes(p.id) ? { ...p, ...(patch as Partial<Photo>) } : p)) } : l; });
    const r = await dr<{ photos: Photo[] }>('catalog-set', { ids, ...patch });
    // A refusal puts those photos back exactly as they were, visibly.
    if (!r.ok) { patchLocal(before); onToast(r.error || 'That did not save.'); return; }
    patchLocal(r.result!.photos);
    if (albumPhotos) setAlbumPhotos((a) => a && a.map((p) => r.result!.photos.find((x) => x.id === p.id) || p));
  }, [targets, albumPhotos, onToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const doImport = async (files: File[]) => {
    const list = files.filter((f) => f.size > 0);
    if (!list.length) return;
    setImports({ total: list.length, done: 0, errors: [] });
    let last: Photo | null = null;
    for (const f of list) {
      const r = await importFile(f);
      setImports((s) => s && { ...s, done: s.done + 1, errors: r.ok ? s.errors : [...s.errors, r.error] });
      if (r.ok) last = r.photo;
    }
    await load();
    if (last) setSelectedId(last.id);
    onToast(`Imported ${list.length} photo${list.length === 1 ? '' : 's'}.`);
  };

  const click = (p: Photo, e: React.MouseEvent) => {
    setSelectedId(p.id);
    if (e.shiftKey && anchor.current) {
      const a = photos.findIndex((x) => x.id === anchor.current), b = photos.findIndex((x) => x.id === p.id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSel(new Set(photos.slice(lo, hi + 1).map((x) => x.id)));
      return;
    }
    if (e.metaKey || e.ctrlKey) { setSel((s) => { const n = new Set(s); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; }); anchor.current = p.id; return; }
    setSel(new Set()); anchor.current = p.id;
  };

  // Culling keys (only when focus isn't in a text field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const i = photos.findIndex((p) => p.id === selectedId);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const j = Math.max(0, Math.min(photos.length - 1, (i < 0 ? 0 : i) + (e.key === 'ArrowRight' ? 1 : -1)));
        if (photos[j]) { setSelectedId(photos[j].id); anchor.current = photos[j].id; e.preventDefault(); }
        return;
      }
      if (!targets.length) return;
      if (/^[0-5]$/.test(e.key) && !e.metaKey && !e.ctrlKey) { void catalog({ rating: Number(e.key) }); e.preventDefault(); }
      else if (/^[6-9]$/.test(e.key)) { const lab = (['red', 'yellow', 'green', 'blue'] as Label[])[Number(e.key) - 6]; void catalog({ label: selected?.label === lab ? null : lab }); }
      else if (e.key === 'p' || e.key === 'P') void catalog({ flag: 'pick' });
      else if (e.key === 'x' || e.key === 'X') void catalog({ flag: 'reject' });
      else if (e.key === 'u' || e.key === 'U') void catalog({ flag: 'none' });
      else if (e.key === 'Enter' && selected) onDevelop(selected, photos);
      else if (e.key === 'Escape') setSel(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos, selectedId, targets, catalog, selected, onDevelop, setSelectedId]);

  const facets = lib?.facets;
  const keywords = facets ? Object.entries(facets.keywords).sort((a, b) => b[1] - a[1]).slice(0, 40) : [];
  const cameras = facets ? Object.keys(facets.cameras).sort() : [];
  const setF = (patch: Partial<Filter>) => { setAlbum(null); setFilter((f) => { const n = { ...f, ...patch }; for (const k of Object.keys(n) as (keyof Filter)[]) if (n[k] === undefined || n[k] === '') delete n[k]; return n; }); };

  return (
    <div className={`grid h-full min-h-0 grid-cols-1 md:grid-cols-[208px,1fr] lg:grid-cols-[208px,1fr,268px] ${dragOver ? 'dr-drop' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); void doImport([...e.dataTransfer.files]); }}
      data-testid="dr-library">
      {/* Left: catalog + albums */}
      <aside className="dr-scroll hidden min-h-0 overflow-y-auto border-r border-[var(--dr-rule)] p-3 md:block">
        <button type="button" className="dr-btn dr-btn-safe mb-3 w-full justify-center" onClick={() => fileInput.current?.click()} data-testid="dr-import"><Upload className="h-3.5 w-3.5" /> Import photos</button>
        <input ref={fileInput} type="file" accept={IMPORT_TYPES} multiple hidden onChange={(e) => { void doImport([...(e.target.files || [])]); e.target.value = ''; }} data-testid="dr-import-input" />
        <p className="dr-head mb-1">Catalog</p>
        <ul className="mb-3 space-y-0.5 text-[12.5px]">
          {[
            { label: 'All photographs', n: facets?.total, f: {} },
            { label: 'Picks', n: facets?.picks, f: { flag: 'pick' as const } },
            { label: 'Rejects', n: facets?.rejects, f: { flag: 'reject' as const } },
            { label: 'From Concordia', n: facets?.concordia, f: { source: 'concordia' as const } },
          ].map((c) => (
            <li key={c.label}><button type="button" className={`flex w-full justify-between rounded px-2 py-1 transition-colors ${!album && JSON.stringify(filter) === JSON.stringify(c.f) ? 'bg-[var(--dr-panel-2)] text-white' : 'text-[var(--dr-ink-2)] hover:bg-[var(--dr-panel)]'}`} onClick={() => { setAlbum(null); setFilter(c.f); }}>
              <span>{c.label}</span><span className="dr-mono text-[11px] text-[var(--dr-muted)]">{c.n ?? '—'}</span>
            </button></li>
          ))}
        </ul>
        <p className="dr-head mb-1">Albums</p>
        <ul className="space-y-0.5 text-[12.5px]" data-testid="dr-albums">
          {albums.map((a) => (
            <li key={a.id}><button type="button" className={`flex w-full justify-between rounded px-2 py-1 transition-colors ${album?.id === a.id ? 'bg-[var(--dr-panel-2)] text-white' : 'text-[var(--dr-ink-2)] hover:bg-[var(--dr-panel)]'}`} onClick={() => setAlbum(album?.id === a.id ? null : a)}>
              <span className="truncate">{a.smart && <Wand2 className="mr-1 inline h-3 w-3 text-[var(--dr-muted)]" aria-label="smart album" />}{a.name}</span><span className="dr-mono text-[11px] text-[var(--dr-muted)]">{a.count}</span>
            </button></li>
          ))}
          {!albums.length && <li className="px-2 text-[11.5px] text-[var(--dr-muted)]">No albums yet.</li>}
        </ul>
        <CreateAlbumForm onCreate={async (name) => {
          const r = await api.post('/api/photos/albums', { name }, { validateStatus: () => true });
          if (!r.data?.ok) { onToast(r.data?.error || 'The album was not created.'); return; }
          await loadAlbums();
        }} />
        {Object.keys(filter).length > 0 && !album && (
          <SmartAlbumForm onSave={async (name) => {
            const r = await dr('album-smart-create', { name, rule: filter });
            if (!r.ok) { onToast(r.error || 'Not saved.'); return; }
            await loadAlbums(); onToast(`Smart album "${name}" saved: it fills itself from this filter.`);
          }} />
        )}
      </aside>

      {/* Centre: filter bar, grid, batch bar */}
      <section className="flex min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--dr-rule)] px-3 py-2" data-testid="dr-filterbar">
          <button type="button" className="dr-btn dr-btn-safe md:hidden" onClick={() => fileInput.current?.click()}><Upload className="h-3.5 w-3.5" /> Import</button>
          <label className="relative min-w-[140px] flex-1 sm:max-w-[220px]">
            <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-[var(--dr-muted)]" />
            <input className="dr-input pl-7" placeholder="Search titles, keywords" value={filter.text || ''} onChange={(e) => setF({ text: e.target.value || undefined })} aria-label="Search photos" data-testid="dr-search" />
          </label>
          <span className="flex items-center gap-1 text-[11.5px] text-[var(--dr-muted)]">Rating ≥ <Stars n={filter.minRating || 0} onSet={(n) => setF({ minRating: n || undefined })} /></span>
          <select className="dr-input w-auto" value={filter.flag || ''} onChange={(e) => setF({ flag: (e.target.value || undefined) as Filter['flag'] })} aria-label="Flag filter">
            <option value="">Any flag</option><option value="pick">Picks</option><option value="reject">Rejects</option><option value="unflagged">Unflagged</option>
          </select>
          <span className="flex items-center gap-1" role="group" aria-label="Colour label filter">
            {LABELS.map((l) => <button key={l} type="button" aria-pressed={filter.label === l} aria-label={`${l} label`} onClick={() => setF({ label: filter.label === l ? undefined : l })} className={`h-3.5 w-3.5 rounded-sm ${filter.label === l ? 'ring-2 ring-white' : ''}`} style={{ background: `var(--dr-${l})` }} />)}
          </span>
          {keywords.length > 0 && <select className="dr-input w-auto" value={filter.keyword || ''} onChange={(e) => setF({ keyword: e.target.value || undefined })} aria-label="Keyword filter"><option value="">Any keyword</option>{keywords.map(([k, n]) => <option key={k} value={k}>{k} ({n})</option>)}</select>}
          {cameras.length > 1 && <select className="dr-input w-auto" value={filter.camera || ''} onChange={(e) => setF({ camera: e.target.value || undefined })} aria-label="Camera filter"><option value="">Any camera</option>{cameras.map((c) => <option key={c} value={c}>{c}</option>)}</select>}
          <button type="button" className="dr-btn h-7 text-[11.5px]" aria-pressed={filter.edited === true} onClick={() => setF({ edited: filter.edited ? undefined : true })}>Edited</button>
          <select className="dr-input ml-auto w-auto" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort photos">{SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </div>
        {err && <p className="dr-error m-3" role="alert">{err}</p>}
        {imports && imports.done < imports.total && (
          <div className="mx-3 mt-2 text-[12px] text-[var(--dr-ink-2)]" role="status">Importing {imports.done + 1} of {imports.total}…
            <div className="mt-1 h-1 rounded bg-[var(--dr-rule)]"><div className="h-1 rounded bg-[var(--dr-safe)]" style={{ width: `${(imports.done / imports.total) * 100}%` }} /></div></div>
        )}
        {imports?.errors.length ? (
          <div className="dr-error mx-3 mt-2" role="alert"><button type="button" className="float-right" aria-label="Dismiss" onClick={() => setImports(null)}><X className="h-3.5 w-3.5" /></button>{imports.errors.map((e) => <p key={e}>{e}</p>)}</div>
        ) : null}
        <div className="dr-scroll min-h-0 flex-1 overflow-y-auto p-3">
          {!lib && !err && <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">{Array.from({ length: 12 }, (_, i) => <div key={i} className="dr-skeleton aspect-[4/3]" />)}</div>}
          {lib && photos.length === 0 && (
            <div className="mx-auto mt-16 max-w-sm text-center" data-testid="dr-empty">
              <ImagePlus className="mx-auto h-10 w-10 text-[var(--dr-faint)]" />
              <p className="dr-title mt-3 text-[20px] italic text-[var(--dr-ink)]">{facets?.total ? 'Nothing matches that filter.' : 'The darkroom is empty.'}</p>
              <p className="mt-1 text-[12.5px] text-[var(--dr-muted)]">{facets?.total ? 'Clear a filter to see more.' : 'Import JPEG, PNG, WebP, TIFF or AVIF photos, or drop them here. Your originals are kept exactly as they are.'}</p>
              {!facets?.total && <button type="button" className="dr-btn dr-btn-safe mx-auto mt-4" onClick={() => fileInput.current?.click()}><Upload className="h-3.5 w-3.5" /> Import photos</button>}
            </div>
          )}
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2" role="listbox" aria-label="Photos" aria-multiselectable data-testid="dr-grid">
            {photos.map((p) => (
              <li key={p.id} role="option" aria-selected={p.id === selectedId || sel.has(p.id)}>
                <button type="button" className="dr-thumb w-full text-left" aria-selected={p.id === selectedId || sel.has(p.id)} data-rejected={p.flag === 'reject'}
                  onClick={(e) => click(p, e)} onDoubleClick={() => onDevelop(p, photos)} aria-label={`${photoName(p)}, ${p.rating} stars${p.flag !== 'none' ? `, ${FLAG_NAMES[p.flag]}` : ''}`} data-testid="dr-thumb">
                  <div className="flex aspect-[4/3] items-center justify-center bg-[var(--dr-well)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumbUrl} alt={p.altText || photoName(p)} loading="lazy" className="max-h-full max-w-full object-contain" />
                  </div>
                  <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                    <Stars n={p.rating} size={10} />
                    <span className="flex items-center gap-1">
                      {p.edited && <span className="dr-mono text-[9.5px] text-[var(--dr-muted)]" title="Edited">±</span>}
                      {p.source === 'concordia' && <span className="text-[9.5px] text-[var(--dr-muted)]" title="From Concordia">C</span>}
                      {p.flag === 'pick' && <Flag className="h-3 w-3 fill-white text-white" aria-label="Pick" />}
                      {p.flag === 'reject' && <X className="h-3 w-3 text-[var(--dr-reject)]" aria-label="Reject" />}
                      {p.label && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--dr-${p.label})` }} aria-label={`${p.label} label`} />}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--dr-rule)] bg-[var(--dr-panel)] px-3 py-2" data-testid="dr-batch">
            <span className="dr-mono text-[11.5px] text-[var(--dr-ink-2)]">{targets.length} selected</span>
            <Stars n={targets.length === 1 ? selected?.rating || 0 : 0} onSet={(n) => void catalog({ rating: n })} />
            <button type="button" className="dr-btn h-7" onClick={() => void catalog({ flag: 'pick' })}>Pick <span className="dr-kbd">P</span></button>
            <button type="button" className="dr-btn h-7" onClick={() => void catalog({ flag: 'reject' })}>Reject <span className="dr-kbd">X</span></button>
            {LABELS.map((l) => <button key={l} type="button" aria-label={`Label ${l}`} onClick={() => void catalog({ label: l })} className="h-4 w-4 rounded-sm" style={{ background: `var(--dr-${l})` }} />)}
            <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (!kw.trim()) return; void catalog({ addTags: kw.split(',') }); setKw(''); }}>
              <input className="dr-input h-7 w-32" placeholder="Add keyword" value={kw} onChange={(e) => setKw(e.target.value)} aria-label="Add keyword to selection" />
            </form>
            {presets.length > 0 && (
              <select className="dr-input h-7 w-auto" value="" aria-label="Apply a preset to the selection" onChange={async (e) => {
                const id = e.target.value; if (!id) return;
                const r = await dr<{ applied: number }>('preset-apply', { ids: targets, presetId: id });
                onToast(r.ok ? `Preset applied to ${r.result!.applied} photo${r.result!.applied === 1 ? '' : 's'}.` : r.error || 'Not applied.');
                void load();
              }}><option value="">Apply preset…</option>{presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            )}
            {copied && <button type="button" className="dr-btn h-7" onClick={async () => {
              const r = await dr<{ applied: number }>('settings-paste', { ids: targets.filter((t) => t !== copied.fromId), fromPhotoId: copied.fromId, parts: copied.parts });
              onToast(r.ok ? `Settings pasted onto ${r.result!.applied} photo${r.result!.applied === 1 ? '' : 's'}.` : r.error || 'Not pasted.');
              void load();
            }}>Paste settings</button>}
            {albums.some((a) => !a.smart) && (
              <select className="dr-input h-7 w-auto" value="" aria-label="Add the selection to an album" onChange={async (e) => {
                const id = e.target.value; if (!id) return;
                for (const pid of targets) await api.post(`/api/photos/albums/${id}/items`, { photoId: pid, add: true }, { validateStatus: () => true });
                await loadAlbums(); onToast('Added to the album.');
              }}><option value="">Add to album…</option>{albums.filter((a) => !a.smart).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            )}
            {album && !album.smart && <button type="button" className="dr-btn h-7" onClick={async () => {
              for (const pid of targets) await api.post(`/api/photos/albums/${album.id}/items`, { photoId: pid, add: false }, { validateStatus: () => true });
              setAlbum({ ...album }); await loadAlbums();
            }}><FolderPlus className="h-3.5 w-3.5" /> Remove from album</button>}
            <span className="ml-auto" />
            {!confirmDelete ? (
              <button type="button" className="dr-icon" aria-label="Delete selected photos" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></button>
            ) : (
              <span className="flex items-center gap-1 text-[12px]">Delete {targets.length}? Originals go too.
                <button type="button" className="dr-btn h-7 border-[var(--dr-bad)] text-[var(--dr-bad)]" data-testid="dr-delete-confirm" onClick={async () => {
                  const msgs: string[] = [];
                  for (const id of targets) {
                    const r = await api.post(`/api/photos/${id}/delete`, {}, { validateStatus: () => true });
                    if (!r.data?.ok) msgs.push(r.data?.error === 'release_live' ? 'A released photo must be withdrawn before it can be deleted.' : r.data?.error === 'release_owned' ? 'Someone bought a photo you chose, so it stays to keep their copy.' : r.data?.error || 'not deleted');
                  }
                  setConfirmDelete(false); setSel(new Set()); setSelectedId(null); await load();
                  onToast(msgs.length ? [...new Set(msgs)].join(' ') : 'Deleted.');
                }}>Delete</button>
                <button type="button" className="dr-btn h-7" onClick={() => setConfirmDelete(false)}>Keep</button>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Right: the photo in hand */}
      <aside className="dr-scroll hidden min-h-0 overflow-y-auto border-l border-[var(--dr-rule)] p-3 lg:block" data-testid="dr-info">
        {!selected && <p className="text-[12px] text-[var(--dr-muted)]">Select a photo to see its details. Double-click (or press Enter) to develop it.</p>}
        {selected && (
          <div className="space-y-3">
            <div>
              <p className="dr-title text-[18px] leading-tight">{photoName(selected)}</p>
              <p className="mt-0.5 text-[11.5px] text-[var(--dr-muted)]">{dateOf(selected)}{selected.source === 'concordia' ? ' · from Concordia' : ''}</p>
            </div>
            <button type="button" className="dr-btn dr-btn-safe w-full justify-center" onClick={() => onDevelop(selected, photos)} data-testid="dr-open-develop">Develop <span className="dr-kbd">D</span></button>
            <div className="flex items-center justify-between">
              <Stars n={selected.rating} onSet={(n) => void catalog({ rating: n }, [selected.id])} size={14} />
              <span className="flex gap-1">
                <button type="button" className="dr-icon" aria-pressed={selected.flag === 'pick'} aria-label="Pick" onClick={() => void catalog({ flag: selected.flag === 'pick' ? 'none' : 'pick' }, [selected.id])}><Flag className="h-3.5 w-3.5" /></button>
                <button type="button" className="dr-icon" aria-pressed={selected.flag === 'reject'} aria-label="Reject" onClick={() => void catalog({ flag: selected.flag === 'reject' ? 'none' : 'reject' }, [selected.id])}><X className="h-3.5 w-3.5" /></button>
              </span>
            </div>
            <dl className="dr-mono grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[11.5px]" data-testid="dr-exif">
              <dt className="text-[var(--dr-muted)]">Camera</dt><dd>{selected.camera || '—'}</dd>
              <dt className="text-[var(--dr-muted)]">Lens</dt><dd>{selected.lens || '—'}</dd>
              <dt className="text-[var(--dr-muted)]">Exposure</dt><dd>{[shutter(selected.exif.exposureTime), selected.exif.fNumber ? `ƒ/${selected.exif.fNumber}` : null, selected.exif.iso ? `ISO ${selected.exif.iso}` : null].filter(Boolean).join(' · ') || '—'}</dd>
              <dt className="text-[var(--dr-muted)]">Focal</dt><dd>{selected.exif.focalLength ? `${selected.exif.focalLength} mm` : '—'}</dd>
              <dt className="text-[var(--dr-muted)]">Size</dt><dd>{selected.width && selected.height ? `${selected.width} × ${selected.height}` : '—'} · {bytes(selected.sizeBytes)}</dd>
              <dt className="text-[var(--dr-muted)]">File</dt><dd className="truncate">{selected.filename || '—'}{selected.mime ? ` · ${selected.mime.replace('image/', '').toUpperCase().replace('JPEG', 'JPEG')}` : ''}</dd>
              {selected.exif.gps && <><dt className="text-[var(--dr-muted)]">Place</dt><dd>{selected.exif.gps.lat.toFixed(4)}, {selected.exif.gps.lon.toFixed(4)}</dd></>}
            </dl>
            <CaptionEditForm photo={selected} onSave={async (patch) => { await catalog({ caption: patch.caption, altText: patch.altText, tags: patch.tags }, [selected.id]); }} />
          </div>
        )}
      </aside>
    </div>
  );
}
