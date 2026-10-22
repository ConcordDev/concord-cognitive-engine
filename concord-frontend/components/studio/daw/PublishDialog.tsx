'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Store } from 'lucide-react';
import type { DAWProject } from '@/lib/daw/types';
import type { PcmAudio, ExportFormat } from '@/lib/daw/render';
import { exportProject, renderProject } from '@/lib/daw/render';
import { encodeMp3OffThread, mp3Blob, type Mp3Bitrate } from '@/lib/daw/mp3-encode';
import { beatFromSeconds, isConstantTempo, projectTempoPoints } from '@/lib/daw/tempo-map';
import { projectEndBeat } from '@/lib/daw/project';
import { api } from '@/lib/api/client';
import { Modal, LIBRARY_UPLOAD_MAX_BYTES, uploadMixToLibrary } from './Dialogs';

const LICENSES: Array<{ id: string; label: string }> = [
  { id: 'personal', label: 'Personal use' },
  { id: 'nonexclusive', label: 'Non-exclusive lease' },
  { id: 'exclusive', label: 'Exclusive' },
  { id: 'cc-by', label: 'CC-BY' },
];

interface StudioTerms {
  ok: boolean;
  paidSales: boolean;
  paymentPath: string;
  marketplaceFeeRate: number;
  universalFeeRate: number;
  combinedRate: number;
  exampleAmount: number;
  exampleFee: number;
  exampleNet: number;
  minPaidPrice: number;
  note: string;
  error?: string;
}

interface Listed {
  id: string;
  path: string;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

function apiError(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { error?: string } } }).response?.data;
    if (data?.error) return data.error;
  }
  return e instanceof Error ? e.message : 'Publish failed';
}

async function uploadBlob(blob: Blob, name: string, title: string, mime: string): Promise<string> {
  if (blob.size > LIBRARY_UPLOAD_MAX_BYTES) {
    throw new Error(`"${name}" is ${(blob.size / 1048576).toFixed(0)} MB, over the 95 MB upload limit.`);
  }
  const r = await api.post('/api/artifact/upload', blob, {
    headers: { 'Content-Type': mime, 'X-Filename': encodeURIComponent(name), 'X-Title': encodeURIComponent(title), 'X-Domain': 'music' },
    timeout: 300000,
  });
  const body = (r?.data || {}) as { ok?: boolean; dtuId?: string; error?: string };
  if (!body.ok || !body.dtuId) throw new Error(body.error || 'Upload failed');
  return body.dtuId;
}

export function PublishDialog({ project, getAudio, onClose }: { project: DAWProject; getAudio: () => Map<string, PcmAudio>; onClose: () => void }) {
  const [terms, setTerms] = useState<StudioTerms | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [title, setTitle] = useState(project.title || '');
  const [artist, setArtist] = useState('');
  const [genre, setGenre] = useState('');
  const [bpm, setBpm] = useState(String(Math.round(project.bpm)));
  const [musicalKey, setMusicalKey] = useState([project.key, project.scale].filter(Boolean).join(' '));
  const [license, setLicense] = useState('personal');
  const [pricing, setPricing] = useState<'free' | 'paid'>('free');
  const [price, setPrice] = useState('1.00');
  const [previewSec, setPreviewSec] = useState(30);
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [bitrate, setBitrate] = useState<Mp3Bitrate>(320);
  const [cover, setCover] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [listed, setListed] = useState<Listed | null>(null);
  const [unlisted, setUnlisted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    api.get('/api/economy/marketplace/studio-terms').then((r) => {
      if (!live) return;
      const body = r.data as StudioTerms;
      if (!body?.ok || typeof body.combinedRate !== 'number') setTermsError('Marketplace terms did not include a fee rate, so publishing is disabled.');
      else setTerms(body);
    }).catch((e) => { if (live) setTermsError(apiError(e)); });
    return () => { live = false; };
  }, []);

  const cancel = () => abortRef.current?.abort();

  const publish = async () => {
    if (!terms) return;
    setErr(null);
    const amount = pricing === 'free' ? 0 : Math.round(Number(price) * 100) / 100;
    if (!title.trim() || !artist.trim()) { setErr('Title and artist are required.'); return; }
    if (pricing === 'paid') {
      if (!terms.paidSales) { setErr('Paid listings are not available.'); return; }
      if (!Number.isFinite(amount) || amount < terms.minPaidPrice) { setErr(`Paid price must be at least ${terms.minPaidPrice} Concord coins.`); return; }
    }
    const songEnd = projectEndBeat(project);
    if (songEnd <= 0) { setErr('The arrangement is empty, so there is no master to publish.'); return; }
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const map = projectTempoPoints(project);
      const sr = format === 'mp3' ? 44100 : (project.sampleRate || 48000);
      const sampleRate = sr === 44100 || sr === 48000 ? sr : 48000;
      setBusy('Rendering master');
      const master = await exportProject(project, getAudio(), {
        format,
        bitDepth: 24,
        sampleRate: format === 'mp3' ? sampleRate : (project.sampleRate || 48000),
        bitrate,
        stems: false,
        target: { lufs: -14, ceilingDb: -1 },
        tags: format === 'mp3' ? { title: title.trim(), artist: artist.trim(), bpm: Number(bpm) || project.bpm, key: musicalKey || undefined } : undefined,
        signal: ctl.signal,
        onProgress: (label) => setBusy(label),
      });
      const seconds = Math.min(30, Math.max(5, previewSec));
      const endBeat = Math.min(songEnd, Math.max(0.25, beatFromSeconds(map, seconds)));
      setBusy('Rendering preview');
      const previewPcm = await renderProject(project, getAudio(), { sampleRate, endBeat, signal: ctl.signal });
      setBusy('Encoding preview');
      const previewBytes = await encodeMp3OffThread({
        channels: previewPcm.channels,
        sampleRate: previewPcm.sampleRate,
        bitrate: 128,
        tags: { title: `${title.trim()} (preview)`, artist: artist.trim(), bpm: Number(bpm) || project.bpm, key: musicalKey || undefined },
        signal: ctl.signal,
      });
      const previewBlob = mp3Blob(previewBytes);
      setBusy('Uploading master');
      const masterId = await uploadMixToLibrary(master.mix, title.trim(), project);
      setBusy('Uploading preview');
      const previewId = await uploadBlob(previewBlob, `${title.trim()}-preview.mp3`, `${title.trim()} preview`, 'audio/mpeg');
      let coverId: string | undefined;
      if (cover) {
        if (!cover.type.startsWith('image/')) throw new Error('Cover art must be an image file.');
        setBusy('Uploading cover');
        coverId = await uploadBlob(cover, cover.name, `${title.trim()} cover`, cover.type);
      }
      setBusy('Publishing listing');
      const res = await api.post('/api/economy/marketplace/studio-publish', {
        title: title.trim(),
        artist: artist.trim(),
        genre: genre.trim(),
        license,
        price: amount,
        bpm: Number(bpm) || project.bpm,
        key: musicalKey.trim(),
        masterArtifactId: masterId,
        previewArtifactId: previewId,
        coverArtifactId: coverId,
        tempoChanges: !isConstantTempo(map),
      });
      const body = res.data as { ok?: boolean; path?: string; listing?: { id: string }; error?: string };
      if (!body.ok || !body.listing?.id || !body.path) throw new Error(body.error || 'Publish failed');
      setListed({ id: body.listing.id, path: body.path });
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') setErr('Publish cancelled. Nothing was listed.');
      else setErr(apiError(e));
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const unlist = async () => {
    if (!listed) return;
    setErr(null);
    setBusy('Unlisting');
    try {
      const res = await api.post(`/api/economy/marketplace/listings/${encodeURIComponent(listed.id)}/delist`);
      const body = res.data as { ok?: boolean; error?: string };
      if (!body.ok) throw new Error(body.error || 'Unlist failed');
      setUnlisted(true);
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setBusy(null);
    }
  };

  const sel = 'mt-1 w-full rounded bg-black/40 px-2 py-1 text-xs text-zinc-100';
  const disabled = !terms || !!busy || !!listed;
  return (
    <Modal title="Publish" icon={<Store className="h-4 w-4" />} onClose={onClose} wide>
      {termsError && <div className="rounded bg-red-500/10 p-2 text-xs text-red-300" data-testid="studio-publish-terms-error">{termsError} Publishing stays off until the fee terms load.</div>}
      {terms && (
        <p className="text-[10px] leading-relaxed text-zinc-400" data-testid="studio-publish-terms">
          {terms.note} Marketplace {pct(terms.marketplaceFeeRate)} + universal {pct(terms.universalFeeRate)} = {pct(terms.combinedRate)} combined.
          On {terms.exampleAmount} coins the fee is {terms.exampleFee} and the seller receives {terms.exampleNet}.
          {terms.paidSales ? ' Paid listings debit the buyer’s Concord balance.' : ' Paid listings are disabled.'}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <label>Title<input className={sel} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Listing title" /></label>
        <label>Artist<input className={sel} value={artist} onChange={(e) => setArtist(e.target.value)} aria-label="Listing artist" /></label>
        <label>Genre<input className={sel} value={genre} onChange={(e) => setGenre(e.target.value)} aria-label="Genre" /></label>
        <label>License
          <select className={sel} value={license} onChange={(e) => setLicense(e.target.value)} aria-label="License">
            {LICENSES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label>BPM<input className={sel} value={bpm} onChange={(e) => setBpm(e.target.value)} aria-label="Listing BPM" /></label>
        <label>Key<input className={sel} value={musicalKey} onChange={(e) => setMusicalKey(e.target.value)} aria-label="Listing key" /></label>
        <label>Master
          <select className={sel} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} aria-label="Master format">
            <option value="wav">WAV 24-bit</option>
            <option value="flac">FLAC 24-bit</option>
            <option value="mp3">MP3</option>
          </select>
        </label>
        {format === 'mp3' ? (
          <label>MP3 bitrate
            <select className={sel} value={bitrate} onChange={(e) => setBitrate(Number(e.target.value) as Mp3Bitrate)} aria-label="MP3 bitrate">
              {[128, 192, 256, 320].map((b) => <option key={b} value={b}>{b} kbps CBR</option>)}
            </select>
          </label>
        ) : <label>Preview length
          <input className={sel} type="number" min={5} max={30} value={previewSec} onChange={(e) => setPreviewSec(Number(e.target.value) || 30)} aria-label="Preview seconds" />
        </label>}
        <label className="col-span-2">Price
          <span className="mt-1 flex items-center gap-2">
            <select className="rounded bg-black/40 px-2 py-1" value={pricing} onChange={(e) => setPricing(e.target.value as 'free' | 'paid')} aria-label="Price kind" disabled={!terms?.paidSales && pricing === 'free'}>
              <option value="free">Free</option>
              <option value="paid" disabled={!terms?.paidSales}>Concord coins</option>
            </select>
            {pricing === 'paid' && <input className="w-24 rounded bg-black/40 px-2 py-1" type="number" min={terms?.minPaidPrice || 0.01} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="Price in Concord coins" />}
          </span>
        </label>
        <label className="col-span-2">Cover art (optional)
          <input className={sel} type="file" accept="image/*" onChange={(e) => setCover(e.target.files?.[0] || null)} aria-label="Cover art" />
        </label>
        {format === 'mp3' && (
          <label className="col-span-2">Preview length (seconds)
            <input className={sel} type="number" min={5} max={30} value={previewSec} onChange={(e) => setPreviewSec(Number(e.target.value) || 30)} aria-label="Preview seconds" />
          </label>
        )}
      </div>
      <p className="mt-2 text-[10px] text-zinc-500">The preview is the opening of the arrangement, at most 30 seconds, encoded as 128 kbps MP3. The master uses the tempo map. Audio clips are not time-stretched.</p>
      <div className="mt-3 flex gap-2">
        <button onClick={() => void publish()} disabled={disabled} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm text-white disabled:opacity-50" data-testid="studio-publish-run">
          {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy}</> : 'Publish listing'}
        </button>
        {busy && <button onClick={cancel} className="rounded-lg bg-white/10 px-3 text-xs" data-testid="studio-publish-cancel">Cancel</button>}
      </div>
      {err && <div className="mt-2 rounded bg-red-500/10 p-2 text-xs text-red-300">{err}</div>}
      {listed && (
        <div className="mt-3 rounded bg-emerald-500/10 p-2 text-xs text-emerald-200" data-testid="studio-publish-done">
          {unlisted ? 'This listing is unlisted. The preview is no longer public.' : (
            <>
              Listed. <a className="underline" href={listed.path}>{listed.path}</a>
              <button onClick={() => void unlist()} disabled={!!busy} className="ml-3 rounded bg-white/10 px-2 py-1 text-zinc-100" data-testid="studio-publish-unlist">Unlist</button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
