'use client';

/**
 * Design the card: frame, palette, accent, layout, title type, a subtitle and
 * the art (one of your images, or a new upload). The preview is the real card
 * face with your choices; saving writes them to the DTU (dtus.card-design).
 */

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { CardFace } from './CardFace';
import { bd, says, type Card, type Design } from './bd';

const FRAMES = [['plain', 'Plain'], ['gilt', 'Gilt'], ['ink', 'Ink'], ['neon', 'Neon'], ['field', 'Field'], ['blueprint', 'Blueprint']] as const;
const PALETTES = [['paper', '#fbfaf7'], ['midnight', '#10142a'], ['ember', '#2a1210'], ['sea', '#e6f4f6'], ['moss', '#edf2e4'], ['rose', '#fbe9ee'], ['slate', '#2b2f3a'], ['sun', '#fff6d6']] as const;
const LAYOUTS = [['art-top', 'Art on top'], ['art-full', 'Full art'], ['text', 'Words only']] as const;
const TYPES = [['serif', 'Serif'], ['grotesk', 'Grotesk'], ['mono', 'Mono']] as const;

function csrf(): Record<string, string> {
  const m = typeof document !== 'undefined' ? document.cookie.match(/csrf_token=([^;]+)/) : null;
  return m ? { 'X-CSRF-Token': decodeURIComponent(m[1]) } : {};
}

export function Designer({ card, onSaved, onClose }: { card: Card; onSaved: () => void; onClose: () => void }) {
  const [d, setD] = useState<Design>(card.design);
  const [art, setArt] = useState<{ id: string; title: string; image: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(card.image);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void bd<{ cards: Card[] }>('shelf-browse', { scope: 'mine', shelves: ['works', 'parts'], limit: 60 }).then((r) => {
      setArt((r.result?.cards || []).filter((c) => c.image && c.id !== card.id && (c.image.includes('/api/artifact/'))).map((c) => ({ id: c.id, title: c.title, image: c.image as string })));
    });
  }, [card.id]);

  const upload = async (f: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) { setErr('Art must be PNG, JPEG or WebP.'); return; }
    if (f.size > 10 * 1024 * 1024) { setErr('Art must be under 10 MB.'); return; }
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/artifact/upload', { method: 'POST', credentials: 'include', headers: { 'Content-Type': f.type, 'X-Filename': encodeURIComponent(f.name), 'X-Title': encodeURIComponent(`Card art — ${card.title}`.slice(0, 120)), 'X-Domain': 'dtus', ...csrf() }, body: f });
      const body = (await res.json().catch(() => ({}))) as { dtuId?: string; error?: string };
      if (!res.ok || !body.dtuId) throw new Error(body.error || 'The image did not upload.');
      setD((x) => ({ ...x, coverDtuId: body.dtuId as string }));
      setPreview(URL.createObjectURL(f));
      setArt((a) => [{ id: body.dtuId as string, title: f.name, image: `/api/artifact/${body.dtuId}/thumbnail` }, ...a]);
    } catch (e) { setErr(e instanceof Error ? e.message : 'The image did not upload.'); }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    const r = await bd('card-design', { id: card.id, design: { frame: d.frame, palette: d.palette, layout: d.layout, typeface: d.typeface, accent: d.accent, subtitle: d.subtitle, ...(d.coverDtuId !== card.design.coverDtuId ? { coverDtuId: d.coverDtuId } : {}) } });
    setBusy(false);
    if (r.ok) onSaved(); else setErr(says(r));
  };

  const pick = <K extends keyof Design>(k: K, v: Design[K]) => setD((x) => ({ ...x, [k]: v }));
  return (
    <section className="bd-panel bd-rise grid gap-5 p-4 md:grid-cols-[200px_minmax(0,1fr)]" aria-label="Design the card" data-testid="bd-designer">
      <div className="w-[200px]"><CardFace card={{ ...card, image: preview }} design={d} /></div>
      <div className="space-y-4">
        <div className="flex items-center justify-between"><p className="bd-title text-[18px]">Design the card</p><button type="button" className="bd-btn !px-2.5" onClick={onClose} aria-label="Close the designer"><X className="h-4 w-4" /></button></div>
        <fieldset><legend className="bd-label mb-1.5">Frame</legend><div className="flex flex-wrap gap-1.5">{FRAMES.map(([v, l]) => <button key={v} type="button" className="bd-chip" aria-pressed={d.frame === v} onClick={() => pick('frame', v)}>{l}</button>)}</div></fieldset>
        <fieldset><legend className="bd-label mb-1.5">Card stock</legend><div className="flex flex-wrap gap-2">{PALETTES.map(([v, c]) => <button key={v} type="button" className="h-8 w-8 rounded-full border-2" style={{ background: c, borderColor: d.palette === v ? 'var(--bd-go)' : 'rgba(255,255,255,.25)' }} aria-pressed={d.palette === v} aria-label={`${v} stock`} title={v} onClick={() => pick('palette', v)} />)}</div></fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset><legend className="bd-label mb-1.5">Layout</legend><div className="flex flex-wrap gap-1.5">{LAYOUTS.map(([v, l]) => <button key={v} type="button" className="bd-chip" aria-pressed={d.layout === v} onClick={() => pick('layout', v)}>{l}</button>)}</div></fieldset>
          <fieldset><legend className="bd-label mb-1.5">Title type</legend><div className="flex flex-wrap gap-1.5">{TYPES.map(([v, l]) => <button key={v} type="button" className="bd-chip" aria-pressed={d.typeface === v} onClick={() => pick('typeface', v)}>{l}</button>)}</div></fieldset>
        </div>
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
          <label className="block"><span className="bd-label">Accent</span>
            <span className="mt-1 flex items-center gap-2"><input type="color" className="h-9 w-12 rounded" value={d.accent || '#ffd23f'} onChange={(e) => pick('accent', e.target.value)} aria-label="Accent colour" /><button type="button" className="bd-chip" onClick={() => pick('accent', null)} aria-pressed={!d.accent}>Shelf colour</button></span></label>
          <label className="block"><span className="bd-label">Subtitle</span><input className="bd-input mt-1" maxLength={80} value={d.subtitle || ''} placeholder={card.summary.slice(0, 60)} onChange={(e) => pick('subtitle', e.target.value || null)} /></label>
        </div>
        <fieldset>
          <legend className="bd-label mb-1.5">Art</legend>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} />
            <button type="button" className="bd-btn" disabled={busy} onClick={() => file.current?.click()}><ImagePlus className="h-4 w-4" /> Upload art</button>
            {d.coverDtuId && <button type="button" className="bd-chip" onClick={() => { pick('coverDtuId', null); setPreview(card.design.coverDtuId ? null : card.image); }}>No art</button>}
            {art.slice(0, 10).map((a) => (
              // eslint-disable-next-line @next/next/no-img-element
              <button key={a.id} type="button" className="h-12 w-12 overflow-hidden rounded-lg border-2" style={{ borderColor: d.coverDtuId === a.id ? 'var(--bd-go)' : 'transparent' }} aria-pressed={d.coverDtuId === a.id} aria-label={`Use ${a.title}`} onClick={() => { pick('coverDtuId', a.id); setPreview(a.image); }}><img src={a.image} alt="" className="h-full w-full object-cover" /></button>
            ))}
          </div>
        </fieldset>
        {err && <p className="bd-error" role="alert">{err}</p>}
        <button type="button" className="bd-btn bd-btn-go" disabled={busy} onClick={() => void save()} data-testid="bd-design-save">{busy ? 'Saving…' : 'Save the design'}</button>
      </div>
    </section>
  );
}
