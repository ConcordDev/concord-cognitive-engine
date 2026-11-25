'use client';

/**
 * For Artists: put music out. Upload songs (tempo, key and loudness are
 * measured on the device when that finishes in time; the file still uploads
 * when it does not), gather them into a single, EP or album with a cover,
 * liner note, credits and a Concord Coin price, and publish. Publishing mints
 * the release DTU and lists it on the marketplace (music.release-publish).
 * Your page, sales and profile live here.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Trash2, Upload, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import { analyzeFile } from '@/lib/music/analyze';
import { fmtCC, fmtDuration, MAX_TRACK_UPLOAD_BYTES, music, trackTooLargeMessage, TYPE_LABEL, uploadCover, uploadTrackFile, type ArtistCard, type Release } from './linerApi';
import { Cover, Empty } from './parts';

interface Mine { releases: Release[]; artist: ArtistCard | null; salesGrossCC: number; creatorPoolCC: number }
interface Upload { name: string; stage: 'analysing' | 'uploading' | 'adding' | 'done' | 'error'; progress: number; note?: string }

/** How long measuring may delay an upload. Past this, the file goes up without numbers. */
export const ANALYSIS_BUDGET_MS = 8_000;

const AUDIO_EXT = /\.(wav|mp3|flac|m4a|aac|ogg|opus|aif|aiff)$/i;
const SONG_ACCEPT = 'audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.aif,.aiff';
const COVER_ACCEPT = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
const UNMEASURED = "Couldn't measure on this device. Tempo, key and loudness were left blank.";

/**
 * Measure tempo, key and loudness, but never block the upload on it.
 * decodeAudioData has no timeout of its own and can hang on iOS; a throw
 * (or a null decode) is the same outcome: upload with no measurements.
 */
async function measureForUpload(file: File): Promise<Awaited<ReturnType<typeof analyzeFile>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      analyzeFile(file).catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ANALYSIS_BUDGET_MS);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function measurementNote(analysis: Awaited<ReturnType<typeof analyzeFile>>): string {
  if (!analysis) return UNMEASURED;
  return [analysis.bpm ? `${analysis.bpm} BPM` : 'no clear tempo', analysis.key || 'no clear key', analysis.lufs != null ? `${analysis.lufs} LUFS` : null].filter(Boolean).join(' · ');
}

const GENRES = ['pop', 'hip-hop', 'r&b', 'rock', 'indie', 'electronic', 'house', 'techno', 'lo-fi', 'ambient', 'jazz', 'soul', 'folk', 'country', 'classical', 'metal', 'punk', 'reggae', 'afrobeats', 'latin', 'soundtrack', 'experimental'];

export function ForArtists({ onRelease, onArtist, focusId, onFocus }: {
  onRelease: (id: string) => void;
  onArtist: (a: ArtistCard) => void;
  focusId: string | null;
  onFocus: (id: string | null) => void;
}) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<Release['type']>('single');

  const load = useCallback(async () => {
    const r = await music<Mine>('release-list-mine');
    if (!r.ok || !r.result) { setError(r.error || 'Could not load your releases.'); return; }
    setError(null);
    setMine(r.result);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const title = newTitle.trim();
    if (!title) return;
    const r = await music<{ release: Release }>('release-create', { title, type: newType });
    if (!r.ok || !r.result) { showToast('error', r.error || 'Could not start the release.'); return; }
    setNewTitle('');
    setMine((m) => (m ? { ...m, releases: [r.result!.release, ...m.releases] } : m));
    onFocus(r.result.release.id);
  };

  const replace = (rel: Release) => setMine((m) => (m ? { ...m, releases: m.releases.map((x) => (x.id === rel.id ? rel : x)) } : m));
  const focused = mine?.releases.find((r) => r.id === focusId) || null;

  if (error) return <div className="p-6"><Empty title="For Artists is not loading">{error}</Empty></div>;

  return (
    <div className="px-4 pb-16 pt-8 sm:px-8" data-testid="ln-for-artists">
      <p className="ln-eyebrow">For artists</p>
      <div className="mb-8 mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 className="ln-serif text-4xl">Put your music out</h1>
        {mine?.artist && (
          <button type="button" onClick={() => onArtist(mine.artist!)} className="ln-btn ln-btn-quiet h-9 px-4 text-sm"><ExternalLink className="h-4 w-4" /> Your artist page</button>
        )}
      </div>

      {mine && (
        <div className="mb-8 grid gap-3 sm:grid-cols-3" data-testid="ln-earnings">
          <Stat label="Releases out" value={String(mine.releases.filter((r) => r.status === 'published').length)} />
          <Stat label="Sales" value={fmtCC(mine.salesGrossCC)} />
          <Stat label="Your 95% creator pool" value={fmtCC(mine.creatorPoolCC)} hint="Paid to your wallet the moment each sale settles. Remixes share it with the artists they came from." />
        </div>
      )}

      <div className="grid gap-8 xl:grid-cols-[20rem_minmax(0,1fr)]">
        <aside>
          <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="ln-card mb-4 space-y-2 p-3">
            <p className="text-sm font-semibold">New release</p>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} maxLength={120} placeholder="Title" aria-label="New release title" className="ln-input h-9 w-full px-3 text-sm" data-testid="ln-new-title" />
            <div className="flex gap-1.5" role="group" aria-label="Release type">
              {(['single', 'ep', 'album'] as const).map((t) => <button key={t} type="button" onClick={() => setNewType(t)} aria-pressed={newType === t} className="ln-chip flex-1 py-1 text-xs">{TYPE_LABEL[t]}</button>)}
            </div>
            <button type="submit" disabled={!newTitle.trim()} className="ln-btn ln-btn-primary h-9 w-full text-sm" data-testid="ln-create"><Plus className="h-4 w-4" /> Start</button>
          </form>
          {!mine ? <p className="text-sm text-[color:var(--ln-muted)]" role="status">Loading your releases…</p> : mine.releases.length ? (
            <ul className="space-y-1">
              {mine.releases.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onFocus(r.id)} aria-current={focusId === r.id ? 'page' : undefined} className="ln-nav-item flex w-full items-center gap-3 p-2 text-left">
                    <Cover url={r.coverUrl} title={r.title} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.title}</span>
                      <span className="block truncate text-xs text-[color:var(--ln-muted)]">{TYPE_LABEL[r.type]} · {r.tracks.length} song{r.tracks.length === 1 ? '' : 's'}</span>
                    </span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', r.status === 'published' ? 'bg-[var(--ln-go-soft)] text-[color:var(--ln-go)]' : 'bg-[var(--ln-paper-2)] text-[color:var(--ln-muted)]')}>{r.status === 'published' ? `Out · ${r.sales ?? 0} sold` : 'Draft'}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing yet">Start a release above, then drop your songs in.</Empty>}
          <ProfileCard />
        </aside>
        <section>
          {focused ? (
            <Editor key={focused.id} release={focused} onChange={replace} onView={() => onRelease(focused.id)} onDeleted={() => { setMine((m) => (m ? { ...m, releases: m.releases.filter((x) => x.id !== focused.id) } : m)); onFocus(null); }} onPublished={() => void load()} />
          ) : (
            <Empty title="Pick a release to edit">Or start a new one. Drafts are private until you publish.</Empty>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ln-card p-4" title={hint}>
      <p className="ln-eyebrow">{label}</p>
      <p className="ln-mono mt-1 text-2xl">{value}</p>
    </div>
  );
}

function Editor({ release, onChange, onView, onDeleted, onPublished }: {
  release: Release;
  onChange: (r: Release) => void;
  onView: () => void;
  onDeleted: () => void;
  onPublished: () => void;
}) {
  const r = release;
  const out = r.status === 'published';
  const [form, setForm] = useState({
    title: r.title, genre: r.genre || '', note: r.note, priceCC: String(r.priceCC), streaming: r.streaming, previewSec: String(r.previewSec), releaseDate: r.releaseDate,
  });
  const [credits, setCredits] = useState(r.credits.length ? r.credits : [{ role: '', name: '' }]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const cover = useRef<HTMLInputElement>(null);
  const dirty = form.title !== r.title || form.genre !== (r.genre || '') || form.note !== r.note || Number(form.priceCC) !== r.priceCC
    || form.streaming !== r.streaming || Number(form.previewSec) !== r.previewSec || form.releaseDate !== r.releaseDate
    || JSON.stringify(credits.filter((c) => c.role.trim() && c.name.trim())) !== JSON.stringify(r.credits);

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const r2 = await music<{ release: Release }>('release-update', {
      id: r.id,
      title: form.title,
      genre: form.genre,
      note: form.note,
      priceCC: Number(form.priceCC),
      streaming: form.streaming,
      previewSec: Number(form.previewSec),
      releaseDate: form.releaseDate,
      credits: credits.filter((c) => c.role.trim() && c.name.trim()),
    });
    setSaving(false);
    if (!r2.ok || !r2.result) { showToast('error', r2.error || 'Not saved.'); return false; }
    onChange(r2.result.release);
    showToast('success', 'Saved.');
    return true;
  };

  const addFiles = async (list: FileList | null) => {
    const picked = Array.from(list || []).filter((f) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (!picked.length) { showToast('warning', 'Choose audio files (WAV, MP3, FLAC, M4A, AAC, OGG, Opus or AIFF).'); return; }
    for (const file of picked) {
      const name = file.name;
      const set = (u: Partial<Upload>) => setUploads((all) => all.map((x) => (x.name === name ? { ...x, ...u } : x)));
      if (file.size > MAX_TRACK_UPLOAD_BYTES) {
        setUploads((all) => [...all.filter((x) => x.name !== name), { name, stage: 'error', progress: 0, note: trackTooLargeMessage(name) }]);
        continue;
      }
      setUploads((all) => [...all.filter((x) => x.name !== name), { name, stage: 'analysing', progress: 0 }]);
      const analysis = await measureForUpload(file);
      set({ stage: 'uploading', note: measurementNote(analysis) });
      const title = name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || 'Untitled';
      const up = await uploadTrackFile(file, title, analysis?.durationSec || 0, (f) => set({ progress: f }));
      if (!up.ok || !up.result) { set({ stage: 'error', note: up.error }); continue; }
      set({ stage: 'adding', progress: 1 });
      const added = await music<{ release: Release }>('release-add-track', {
        id: r.id, mediaId: up.result.mediaId, title,
        bpm: analysis?.bpm ?? undefined, key: analysis?.key ?? undefined, lufs: analysis?.lufs ?? undefined,
      });
      if (!added.ok || !added.result) { set({ stage: 'error', note: added.error }); continue; }
      onChange(added.result.release);
      set({ stage: 'done' });
    }
  };

  const setCover = async (f: File | undefined) => {
    if (!f) return;
    const up = await uploadCover(f, r.title);
    if (!up.ok || !up.result) { showToast('error', up.error || 'Cover not uploaded.'); return; }
    const u = await music<{ release: Release }>('release-update', { id: r.id, coverDtuId: up.result.dtuId });
    if (!u.ok || !u.result) { showToast('error', u.error || 'Cover not saved.'); return; }
    onChange(u.result.release);
  };

  const move = async (i: number, d: -1 | 1) => {
    const order = r.tracks.map((t) => t.mediaId);
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    const u = await music<{ release: Release }>('release-reorder', { id: r.id, order });
    if (u.ok && u.result) onChange(u.result.release); else showToast('error', u.error || 'Not reordered.');
  };

  const remove = async (mediaId: string) => {
    const u = await music<{ release: Release }>('release-remove-track', { id: r.id, mediaId });
    if (u.ok && u.result) onChange(u.result.release); else showToast('error', u.error || 'Not removed.');
  };

  const publish = async () => {
    if (dirty && !(await save())) return;
    setPublishing(true);
    const p = await music<{ release: Release }>('release-publish', { id: r.id });
    setPublishing(false);
    if (!p.ok || !p.result) { showToast('error', p.error || 'Not published.'); return; }
    onChange(p.result.release);
    onPublished();
    showToast('success', `${p.result.release.title} is out. It is on your artist page and in New on Concord.`);
  };

  const del = async () => {
    const d = await music('release-delete', { id: r.id });
    if (!d.ok) { showToast('error', d.error || 'Not deleted.'); return; }
    onDeleted();
  };

  const checks: Array<[boolean, string]> = [[!!form.title.trim(), 'A title'], [r.tracks.length > 0, 'At least one song'], [r.type !== 'single' || r.tracks.length <= 3, 'A single holds up to 3 songs']];
  const ready = checks.every(([ok]) => ok);
  const price = Number(form.priceCC);

  return (
    <div className="ln-card ln-rise p-4 sm:p-6" data-testid="ln-editor">
      <div className="flex flex-col gap-5 sm:flex-row">
        <div className="flex flex-col items-start gap-2">
          <Cover url={r.coverUrl} title={form.title || r.title} size="lg" />
          {/* sr-only, not hidden: iOS Safari ignores a programmatic click on a display:none file input. The label opens the picker. */}
          <label className="ln-btn ln-btn-quiet ln-file-label h-8 cursor-pointer px-3 text-xs">
            <ImagePlus className="h-3.5 w-3.5" /> {r.coverUrl ? 'Change cover' : 'Add cover'}
            <input ref={cover} type="file" accept={COVER_ACCEPT} className="sr-only" aria-label="Cover image" data-testid="ln-cover-file" onChange={(e) => { void setCover(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ln-eyebrow">{TYPE_LABEL[r.type]}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold', out ? 'bg-[var(--ln-go-soft)] text-[color:var(--ln-go)]' : 'bg-[var(--ln-paper-2)] text-[color:var(--ln-muted)]')}>{out ? 'Out now' : 'Draft · only you can see it'}</span>
            {out && <button type="button" onClick={onView} className="ln-link ml-auto text-sm font-semibold text-[color:var(--ln-accent)]">View release</button>}
          </div>
          <Field label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} className="ln-input h-10 w-full px-3 text-lg font-semibold" data-testid="ln-edit-title" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Genre">
              <select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })} className="ln-input h-9 w-full px-2 text-sm">
                <option value="">None</option>
                {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="Release date"><input type="date" value={form.releaseDate} onChange={(e) => setForm({ ...form, releaseDate: e.target.value })} className="ln-input h-9 w-full px-2 text-sm" /></Field>
          </div>
        </div>
      </div>

      <h3 className="ln-eyebrow mb-2 mt-6">Songs</h3>
      {r.tracks.length > 0 && (
        <ol className="mb-3 divide-y ln-divide" data-testid="ln-edit-tracks">
          {r.tracks.map((t, i) => (
            <li key={t.mediaId} className="flex items-center gap-2 py-2">
              <span className="ln-mono w-5 text-right text-sm text-[color:var(--ln-muted)]">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{t.title}</span>
                <span className="ln-mono block truncate text-[11px] text-[color:var(--ln-muted)]">{[t.bpm ? `${t.bpm} BPM` : 'tempo unknown', t.key || 'key unknown', t.lufs != null ? `${t.lufs} LUFS` : 'loudness unknown'].join(' · ')}</span>
              </span>
              <span className="ln-mono text-xs text-[color:var(--ln-muted)]">{fmtDuration(t.durationSec)}</span>
              {!out && (
                <>
                  <button type="button" onClick={() => void move(i, -1)} disabled={i === 0} className="rounded p-1 text-[color:var(--ln-muted)] disabled:opacity-30" aria-label={`Move ${t.title} up`}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void move(i, 1)} disabled={i === r.tracks.length - 1} className="rounded p-1 text-[color:var(--ln-muted)] disabled:opacity-30" aria-label={`Move ${t.title} down`}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void remove(t.mediaId)} className="rounded p-1 text-[color:var(--ln-muted)] hover:text-[color:var(--ln-accent)]" aria-label={`Remove ${t.title}`}><X className="h-4 w-4" /></button>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {!out ? (
        <div
          className="rounded-xl border-2 border-dashed ln-rule p-5 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }}
        >
          <Upload className="mx-auto h-6 w-6 text-[color:var(--ln-muted)]" aria-hidden />
          <p className="mt-1 text-sm">
            Drop songs here, or{' '}
            {/* sr-only, not hidden: iOS Safari ignores a programmatic click on a display:none file input. The label opens the picker. */}
            <label className="ln-link ln-file-label cursor-pointer font-semibold text-[color:var(--ln-accent)]">
              choose files
              <input ref={files} type="file" accept={SONG_ACCEPT} multiple className="sr-only" aria-label="Song files" onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} data-testid="ln-song-files" />
            </label>
          </p>
          <p className="text-xs text-[color:var(--ln-muted)]">Tempo, key and loudness are measured on your device when it can. If measuring does not finish, the song still uploads and those numbers stay blank.</p>
        </div>
      ) : <p className="text-xs text-[color:var(--ln-muted)]">The songs on a release are fixed once it is out, because people bought exactly these.</p>}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.name} className="text-xs">
              <div className="flex items-center gap-2">
                {u.stage !== 'done' && u.stage !== 'error' && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                <span className="truncate font-medium">{u.name}</span>
                <span className={cn('ml-auto', u.stage === 'error' ? 'text-[color:var(--ln-accent)]' : 'text-[color:var(--ln-muted)]')}>
                  {u.stage === 'analysing' ? 'Measuring…' : u.stage === 'uploading' ? `Uploading ${Math.round(u.progress * 100)}%` : u.stage === 'adding' ? 'Adding…' : u.stage === 'done' ? 'Added' : 'Failed'}
                </span>
              </div>
              {u.note && <p className={cn('ln-mono mt-0.5', u.stage === 'error' ? 'text-[color:var(--ln-accent)]' : 'text-[color:var(--ln-muted)]')}>{u.note}</p>}
            </li>
          ))}
        </ul>
      )}

      <h3 className="ln-eyebrow mb-2 mt-6">Liner note</h3>
      <textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={4000} rows={5} placeholder="Where it was made, who it is for, what you want people to hear." aria-label="Liner note" className="ln-input w-full p-3 text-sm leading-relaxed" data-testid="ln-edit-note" />

      <h3 className="ln-eyebrow mb-2 mt-6">Credits</h3>
      <div className="space-y-1.5">
        {credits.map((c, i) => (
          <div key={i} className="flex gap-2">
            <input value={c.role} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} maxLength={40} placeholder="Role (Producer, Vocals…)" aria-label={`Credit ${i + 1} role`} className="ln-input h-8 w-40 px-2 text-sm" />
            <input value={c.name} onChange={(e) => setCredits(credits.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={80} placeholder="Name" aria-label={`Credit ${i + 1} name`} className="ln-input h-8 min-w-0 flex-1 px-2 text-sm" />
            <button type="button" onClick={() => setCredits(credits.length > 1 ? credits.filter((_, j) => j !== i) : [{ role: '', name: '' }])} className="rounded p-1 text-[color:var(--ln-muted)]" aria-label={`Remove credit ${i + 1}`}><X className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => setCredits([...credits, { role: '', name: '' }])} className="ln-link text-sm font-semibold">+ Add a credit</button>
      </div>

      <h3 className="ln-eyebrow mb-2 mt-6">Price and streaming</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Price (Concord Coin)"><input type="number" min={0} max={1000} step={0.5} value={form.priceCC} onChange={(e) => setForm({ ...form, priceCC: e.target.value })} className="ln-input ln-mono h-9 w-full px-2 text-sm" data-testid="ln-edit-price" /></Field>
        <Field label="Listeners hear">
          <select value={form.streaming} onChange={(e) => setForm({ ...form, streaming: e.target.value as Release['streaming'] })} className="ln-input h-9 w-full px-2 text-sm" data-testid="ln-edit-streaming">
            <option value="full">Every song in full, free</option>
            <option value="preview">A preview until they buy</option>
          </select>
        </Field>
        {form.streaming === 'preview' && (
          <Field label="Preview length (seconds)"><input type="number" min={15} max={90} value={form.previewSec} onChange={(e) => setForm({ ...form, previewSec: e.target.value })} className="ln-input ln-mono h-9 w-full px-2 text-sm" /></Field>
        )}
      </div>
      <p className="mt-2 text-xs text-[color:var(--ln-muted)]">
        {price > 0 ? `Each sale of ${fmtCC(price)}: ${fmtCC(Math.round(price * 0.95 * 100) / 100)} to your creator pool (shared with the artists you remix), ${fmtCC(Math.round(price * 0.05 * 100) / 100)} platform.` : 'Free: anyone can stream it; nobody pays.'}
        {form.streaming === 'preview' && price === 0 ? ' Previews only apply to priced releases.' : ''}
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t ln-rule pt-4">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className="ln-btn ln-btn-quiet h-10 px-5 text-sm" data-testid="ln-save">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save</button>
        {!out && (
          <button type="button" onClick={() => void publish()} disabled={!ready || publishing} className="ln-btn ln-btn-primary h-10 px-6 text-sm" data-testid="ln-publish">
            {publishing && <Loader2 className="h-4 w-4 animate-spin" />} Publish {TYPE_LABEL[r.type]}
          </button>
        )}
        {!out && (
          <ul className="flex flex-wrap gap-3 text-xs">
            {checks.map(([ok, label]) => <li key={label} className={ok ? 'text-[color:var(--ln-go)]' : 'text-[color:var(--ln-muted)]'}>{ok ? '✓' : '○'} {label}</li>)}
          </ul>
        )}
        {!out && (confirmDelete ? (
          <span className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => void del()} className="ln-btn ln-btn-primary h-9 px-4 text-xs">Delete draft</button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="ln-btn ln-btn-quiet h-9 px-3 text-xs">Keep</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmDelete(true)} className="ml-auto rounded p-2 text-[color:var(--ln-muted)] hover:text-[color:var(--ln-accent)]" aria-label="Delete this draft"><Trash2 className="h-4 w-4" /></button>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-[color:var(--ln-muted)]">{label}</span>
      {children}
    </label>
  );
}

/** Your public bio and links (music.artist-profile-get / -set). */
function ProfileCard() {
  const [bio, setBio] = useState('');
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    void music<{ profile: { bio: string; links: Array<{ label: string; url: string }> } }>('artist-profile-get').then((r) => {
      if (r.ok && r.result) { setBio(r.result.profile.bio || ''); setLinks(r.result.profile.links || []); }
      setLoaded(true);
    });
  }, []);
  const save = async () => {
    const bad = links.find((l) => l.url && !/^https?:\/\//i.test(l.url));
    if (bad) { showToast('warning', `Links must start with https:// (${bad.label || bad.url}).`); return; }
    setSaving(true);
    const r = await music('artist-profile-set', { bio, links: links.filter((l) => l.label.trim() && l.url.trim()) });
    setSaving(false);
    showToast(r.ok ? 'success' : 'error', r.ok ? 'Profile saved.' : r.error || 'Not saved.');
  };
  if (!loaded) return null;
  return (
    <div className="ln-card mt-6 space-y-2 p-3" data-testid="ln-profile">
      <p className="text-sm font-semibold">Your artist profile</p>
      <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={1000} rows={4} placeholder="A few lines about you and your music." aria-label="Artist bio" className="ln-input w-full p-2 text-sm" />
      {links.map((l, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={l.label} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={40} placeholder="Label" aria-label={`Link ${i + 1} label`} className="ln-input h-8 w-24 px-2 text-xs" />
          <input value={l.url} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} maxLength={300} placeholder="https://" aria-label={`Link ${i + 1} address`} className="ln-input h-8 min-w-0 flex-1 px-2 text-xs" />
          <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className="p-1 text-[color:var(--ln-muted)]" aria-label={`Remove link ${i + 1}`}><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      {links.length < 8 && <button type="button" onClick={() => setLinks([...links, { label: '', url: '' }])} className="ln-link block text-xs font-semibold">+ Add a link</button>}
      <button type="button" onClick={() => void save()} disabled={saving} className="ln-btn ln-btn-quiet h-8 w-full text-xs">{saving && <Loader2 className="h-3 w-3 animate-spin" />} Save profile</button>
    </div>
  );
}
