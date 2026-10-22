'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X, Loader2, Download, Wand2, History, Sparkles, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DAWProject, DAWTrack } from '@/lib/daw/types';
import type { PcmAudio, ExportResult, ExportFormat } from '@/lib/daw/render';
import { exportProject } from '@/lib/daw/render';
import { LOUDNESS_TARGETS } from '@/lib/daw/dsp/limiter';
import type { LoudnessReport } from '@/lib/daw/dsp/loudness';
import { autoMixAndMaster, type AutoMixResult } from '@/lib/daw/automix';
import { studioTransport } from '@/lib/daw/studio-api';
import { fromServerRecord, type VersionMeta } from '@/lib/daw/persistence';
import { newId } from '@/lib/daw/project';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { lensRun } from '@/lib/api/client';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { withContentLicense } from '@/components/dtu/ContentClassLicenseFields';
import { showToast } from '@/components/common/Toasts';

export function Modal({ title, icon, onClose, children, wide }: { title: string; icon?: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className={cn('max-h-[90vh] w-full overflow-y-auto rounded-xl border border-white/10 bg-[#16161d] p-4 text-zinc-200 shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">{icon}{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

const fmt = (v: number, unit: string) => (Number.isFinite(v) ? `${v.toFixed(1)} ${unit}` : `-∞ ${unit}`);

export function LoudnessTable({ r, label }: { r: LoudnessReport; label?: string }) {
  return (
    <div className="rounded-lg bg-black/30 p-2 text-[11px]" data-testid="studio-loudness-report">
      {label && <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums">
        <span className="text-zinc-500">Integrated</span><span>{fmt(r.integratedLufs, 'LUFS')}</span>
        <span className="text-zinc-500">True peak</span><span className={r.truePeakDbtp > -0.95 ? 'text-amber-300' : ''}>{fmt(r.truePeakDbtp, 'dBTP')}</span>
        <span className="text-zinc-500">Loudness range</span><span>{fmt(r.lra, 'LU')}</span>
        <span className="text-zinc-500">Short-term max</span><span>{fmt(r.shortTermMaxLufs, 'LUFS')}</span>
        <span className="text-zinc-500">Sample peak</span><span>{fmt(r.samplePeakDbfs, 'dBFS')}</span>
      </div>
    </div>
  );
}

// ─── Export ────────────────────────────────────────────────────────────────

export function ExportDialog({ project, getAudio, onClose }: { project: DAWProject; getAudio: () => Map<string, PcmAudio>; onClose: () => void }) {
  const projectRate = project.sampleRate || getStudioEngine().ctx.sampleRate || 48000;
  const [format, setFormat] = useState<ExportFormat>('wav');
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(24);
  const [rate, setRate] = useState<number>(projectRate >= 48000 ? 48000 : 44100);
  const [targetId, setTargetId] = useState<string>('streaming');
  const [stems, setStems] = useState(false);
  const [busy, setBusy] = useState<{ label: string; f: number } | null>(null);
  const [res, setRes] = useState<ExportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const target = LOUDNESS_TARGETS.find((t) => t.id === targetId) || null;
  const forced16 = target?.bitDepth === 16;
  const effDepth: 16 | 24 | 32 = forced16 ? 16 : format === 'flac' && bitDepth === 32 ? 24 : bitDepth;

  const run = async () => {
    setErr(null); setRes(null);
    setBusy({ label: 'Rendering', f: 0 });
    try {
      const r = await exportProject(project, getAudio(), {
        format, bitDepth: effDepth, sampleRate: rate, stems,
        target: target ? { lufs: target.lufs, ceilingDb: target.ceilingDb } : null,
        onProgress: (label, f) => setBusy({ label, f }),
      });
      setRes(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const sel = 'w-full rounded bg-black/40 px-2 py-1 text-xs text-zinc-100';
  return (
    <Modal title="Export / Publish" icon={<Download className="h-4 w-4" />} onClose={onClose} wide>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <label>Format
          <select className={sel} value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)} data-testid="studio-export-format">
            <option value="wav">WAV</option>
            <option value="flac">FLAC (lossless, smaller)</option>
          </select>
        </label>
        <label>Bit depth
          <select className={sel} value={effDepth} disabled={forced16} onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)} data-testid="studio-export-depth">
            <option value={16}>16-bit (TPDF dither)</option>
            <option value={24}>24-bit (TPDF dither)</option>
            {format === 'wav' && <option value={32}>32-bit float</option>}
          </select>
        </label>
        <label>Sample rate
          <select className={sel} value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            <option value={44100}>44.1 kHz{Math.round(projectRate) === 44100 ? ' (project)' : ''}</option>
            <option value={48000}>48 kHz{Math.round(projectRate) === 48000 ? ' (project)' : ''}</option>
          </select>
        </label>
        <label>Loudness
          <select className={sel} value={targetId} onChange={(e) => setTargetId(e.target.value)} data-testid="studio-export-target">
            <option value="none">No normalization (clip-safe only)</option>
            {LOUDNESS_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2"><input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} /> Also export stems (one file per track, same processing, no master limiter)</label>
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
        Rendered offline through the same engine as playback (32-bit float). MP3 isn&apos;t offered yet: it needs an encoder that would bloat the app. Export WAV or FLAC and convert if a site requires MP3.
      </p>
      <button onClick={() => void run()} disabled={!!busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60" data-testid="studio-export-run">
        {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy.label} {Math.round(busy.f * 100)}%</> : 'Render'}
      </button>
      {err && <div className="mt-2 rounded bg-red-500/10 p-2 text-xs text-red-300">{err}</div>}
      {res && (
        <div className="mt-3 space-y-2">
          <LoudnessTable r={res.mix.report} label={`${res.mix.name}${target ? ` · gain ${res.gainDb >= 0 ? '+' : ''}${res.gainDb.toFixed(1)} dB · limiter ${res.limiterDb.toFixed(1)} dB` : ''}`} />
          <div className="flex flex-wrap gap-2">
            <button onClick={() => download(res.mix.name, res.mix.blob)} className="flex items-center gap-1 rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"><Download className="h-3 w-3" /> Download mix</button>
            {res.stems.length > 0 && <button onClick={() => res.stems.forEach((s, i) => setTimeout(() => download(s.name, s.blob), i * 400))} className="flex items-center gap-1 rounded bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"><Download className="h-3 w-3" /> Download {res.stems.length} stems</button>}
          </div>
          {res.stems.length > 0 && (
            <ul className="max-h-32 overflow-y-auto text-[10px] text-zinc-400">
              {res.stems.map((s) => <li key={s.name} className="flex justify-between"><button className="truncate hover:text-white" onClick={() => download(s.name, s.blob)}>{s.name}</button><span className="tabular-nums">{fmt(s.report.integratedLufs, 'LUFS')} · {fmt(s.report.truePeakDbtp, 'dBTP')}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <PublishSection project={project} />
    </Modal>
  );
}

function PublishSection({ project }: { project: DAWProject }) {
  const { createDTU, publishToMarketplace } = useLensDTUs({ lens: 'studio' });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [price, setPrice] = useState('0');
  const [license, setLicense] = useState<'basic' | 'premium' | 'exclusive'>('basic');
  const [busy, setBusy] = useState(false);
  const publish = async () => {
    setBusy(true);
    try {
      const dtuRes = (await createDTU(withContentLicense({
        title: title || project.title,
        content: `Studio song: ${project.title} | ${project.bpm} BPM | Key: ${project.key} ${project.scale} | ${project.tracks.length} tracks`,
        tags: ['studio', 'audio', 'music', project.key, `${project.bpm}bpm`].filter(Boolean),
        source: 'studio',
        meta: { type: 'audio', projectId: project.id, bpm: project.bpm, key: project.key, genre: project.genre, trackCount: project.tracks.length },
      }, 'media', ['private', 'public_view', 'social_post', 'public_listen', 'marketplace_sale']))) as unknown as Record<string, unknown>;
      const dtuId = ((dtuRes?.dtu as Record<string, unknown>)?.id as string) || (dtuRes?.id as string);
      if (!dtuId) throw new Error('Could not create the song DTU');
      await publishToMarketplace({ dtuId, price: parseFloat(price) || 0, description: `${project.title} — ${project.bpm} BPM, ${project.key}`, license });
      showToast('success', `"${title || project.title}" is live on the marketplace`);
      setOpen(false);
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Publish failed');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 border-t border-white/10 pt-3">
      {!open ? (
        <button onClick={() => setOpen(true)} className="text-xs text-violet-300 hover:text-violet-200">Publish to Concord marketplace…</button>
      ) : (
        <div className="space-y-2 text-xs">
          <div className="text-[11px] font-medium">Publish</div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded bg-black/40 px-2 py-1" placeholder="Title" />
          <div className="flex gap-2">
            <input value={price} onChange={(e) => setPrice(e.target.value)} className="w-24 rounded bg-black/40 px-2 py-1" placeholder="Price" inputMode="decimal" />
            <select value={license} onChange={(e) => setLicense(e.target.value as typeof license)} className="flex-1 rounded bg-black/40 px-2 py-1">
              <option value="basic">Basic license</option><option value="premium">Premium</option><option value="exclusive">Exclusive</option>
            </select>
          </div>
          <button onClick={() => void publish()} disabled={busy} className="rounded bg-violet-600 px-3 py-1.5 text-white disabled:opacity-60">{busy ? 'Publishing…' : 'Publish'}</button>
        </div>
      )}
    </div>
  );
}

// ─── Auto Mix + Master ─────────────────────────────────────────────────────

export function AutoMixDialog({ project, getAudio, onApply, onRevert, onClose }: {
  project: DAWProject;
  getAudio: () => Map<string, PcmAudio>;
  onApply: (p: DAWProject) => void;
  onRevert: () => void;
  onClose: () => void;
}) {
  const [targetId, setTargetId] = useState('streaming');
  const [busy, setBusy] = useState<{ label: string; f: number } | null>(null);
  const [res, setRes] = useState<(AutoMixResult & { original: DAWProject }) | null>(null);
  const [ab, setAb] = useState<'after' | 'before'>('after');
  const [err, setErr] = useState<string | null>(null);
  const target = LOUDNESS_TARGETS.find((t) => t.id === targetId)!;

  const projectRef = useRef(project);
  projectRef.current = project;
  // Leaving the dialog always returns the engine to the real project.
  useEffect(() => () => { getStudioEngine().setProject(projectRef.current); }, []);

  const run = async () => {
    setErr(null); setBusy({ label: 'Measuring', f: 0 });
    try {
      const original = project;
      const r = await autoMixAndMaster(project, getAudio(), { lufs: target.lufs, ceilingDb: target.ceilingDb }, (label, f) => setBusy({ label, f }));
      onApply(r.project);
      setRes({ ...r, original });
      setAb('after');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = (which: 'before' | 'after') => {
    if (!res) return;
    setAb(which);
    const eng = getStudioEngine();
    if (which === 'before') {
      const o = res.original;
      eng.setProject({ ...o, masterBus: { ...o.masterBus, volume: o.masterBus.volume + res.matchDb } });
    } else {
      eng.setProject(project);
    }
  };
  return (
    <Modal title="Auto Mix + Master" icon={<Wand2 className="h-4 w-4 text-violet-300" />} onClose={onClose} wide>
      {!res && (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">One click: gain-stages every track to about -18 dBFS RMS, cleans each track by type (high-pass on non-bass, vocal EQ + compression, kick→bass ducking), pans wide parts, glues the bus and masters to a loudness target with a true-peak limiter. Everything stays editable and one Undo puts it back.</p>
          <label className="mt-3 block text-xs">Target
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1 w-full rounded bg-black/40 px-2 py-1">
              {LOUDNESS_TARGETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <button onClick={() => void run()} disabled={!!busy || !project.tracks.some((t) => t.clips.length)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-2 text-sm font-medium text-white disabled:opacity-60" data-testid="studio-automix-run">
            {busy ? <><Loader2 className="h-4 w-4 animate-spin" /> {busy.label} {Math.round(busy.f * 100)}%</> : 'Mix + master my song'}
          </button>
          {!project.tracks.some((t) => t.clips.length) && <p className="mt-1 text-[10px] text-zinc-500">Add some clips first.</p>}
        </>
      )}
      {err && <div className="mt-2 rounded bg-red-500/10 p-2 text-xs text-red-300">{err}</div>}
      {res && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Compare (level-matched):</span>
            {(['before', 'after'] as const).map((w) => (
              <button key={w} onClick={() => toggle(w)} className={cn('rounded px-3 py-1 text-xs', ab === w ? 'bg-violet-600 text-white' : 'bg-white/10 text-zinc-300')} data-testid={`studio-ab-${w}`}>{w === 'before' ? 'A · Before' : 'B · After'}</button>
            ))}
            <button onClick={() => void getStudioEngine().play(0)} className="ml-auto rounded bg-white/10 px-2 py-1 text-xs">▶ Play</button>
            <button onClick={() => getStudioEngine().stop()} className="rounded bg-white/10 px-2 py-1 text-xs">■</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <LoudnessTable r={res.before} label="Before" />
            <LoudnessTable r={res.after} label="After" />
          </div>
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-zinc-400">{res.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          <div className="flex gap-2">
            <button onClick={() => { toggle('after'); onClose(); }} className="flex items-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-xs text-white"><Check className="h-3 w-3" /> Keep</button>
            <button onClick={() => { getStudioEngine().setProject(res.original); onRevert(); onClose(); }} className="flex items-center gap-1 rounded bg-white/10 px-3 py-1.5 text-xs"><RotateCcw className="h-3 w-3" /> Revert</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Versions ──────────────────────────────────────────────────────────────

export function VersionsDialog({ project, saveNow, onRestored, onClose }: { project: DAWProject; saveNow: () => Promise<void>; onRestored: (p: DAWProject, rev: number) => void; onClose: () => void }) {
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const saved = !project.id.startsWith('local_');
  const refresh = async () => { if (saved) setList(await studioTransport.versions(project.id).catch(() => [])); else setList([]); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void refresh(); }, [project.id]);
  const snap = async () => {
    setBusy(true);
    try { await saveNow(); await studioTransport.snapshot(project.id, label || `Snapshot ${new Date().toLocaleString()}`); setLabel(''); await refresh(); showToast('success', 'Snapshot saved'); }
    catch (e) { showToast('error', e instanceof Error ? e.message : 'Snapshot failed'); }
    finally { setBusy(false); }
  };
  const restore = async (v: VersionMeta) => {
    setBusy(true);
    try {
      await saveNow();
      const rec = await studioTransport.restore(project.id, v.id);
      if (!rec) throw new Error('Version not found');
      onRestored(fromServerRecord(rec), rec.rev || 0);
      showToast('success', `Restored "${v.label}". Your previous state was kept as a version.`);
      onClose();
    } catch (e) { showToast('error', e instanceof Error ? e.message : 'Restore failed'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Versions" icon={<History className="h-4 w-4" />} onClose={onClose}>
      {!saved ? <p className="text-xs text-zinc-400">Saving your song for the first time… versions appear once it&apos;s saved.</p> : (
        <>
          <div className="flex gap-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name this version (optional)" className="flex-1 rounded bg-black/40 px-2 py-1 text-xs" />
            <button onClick={() => void snap()} disabled={busy} className="rounded bg-violet-600 px-3 py-1 text-xs text-white disabled:opacity-60" data-testid="studio-snapshot">Save version</button>
          </div>
          <p className="mt-1 text-[10px] text-zinc-500">Automatic versions are kept every 10 minutes of work and before every restore (last 20).</p>
          <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {list === null && <li className="text-xs text-zinc-500">Loading…</li>}
            {list?.length === 0 && <li className="text-xs text-zinc-500">No versions yet.</li>}
            {list?.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded bg-white/[0.03] px-2 py-1.5 text-xs">
                <span><span className="text-zinc-200">{v.label}</span><span className="block text-[10px] text-zinc-500">{new Date(v.at).toLocaleString()} · rev {v.rev}</span></span>
                <button onClick={() => void restore(v)} disabled={busy} className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20">Restore</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

// ─── Ask Producer ──────────────────────────────────────────────────────────

const GENRES = ['lofi', 'pop', 'hiphop', 'edm', 'rock', 'jazz', 'ambient'];

export function AskProducerDialog({ project, onAddTracks, onClose }: { project: DAWProject; onAddTracks: (tracks: DAWTrack[], presets: DAWProject['synthPresets']) => void; onClose: () => void }) {
  const [genre, setGenre] = useState(project.genre && GENRES.includes(project.genre) ? project.genre : 'lofi');
  const [bars, setBars] = useState(8);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    let tmpId: string | null = null;
    try {
      const r = await lensRun<{ project: { id: string } }>('studio', 'compose', { genre, title: `${project.title} idea`, key: project.key, scale: project.scale === 'major' ? 'major' : 'minor', bpm: project.bpm, bars });
      tmpId = r.data.result?.project?.id || null;
      if (!r.data.ok || !tmpId) throw new Error(r.data.error || 'The producer could not write an idea');
      const rec = await studioTransport.get(tmpId);
      if (!rec) throw new Error('Idea not found');
      const idea = fromServerRecord(rec);
      const tracks = idea.tracks.filter((t) => t.type !== 'master' && t.clips.length).map((t) => {
        const id = newId('trk');
        return { ...t, id, name: `${t.name} (idea)`, armed: false, clips: t.clips.map((c) => ({ ...c, id: newId('clip'), trackId: id })) };
      });
      onAddTracks(tracks, idea.synthPresets || {});
      showToast('success', `Added ${tracks.length} idea tracks`);
      onClose();
    } catch (e) {
      showToast('error', e instanceof Error ? e.message : 'Ask Producer failed');
    } finally {
      if (tmpId) void lensRun('studio', 'project-delete', { id: tmpId }).catch(() => null);
      setBusy(false);
    }
  };
  return (
    <Modal title="Ask Producer" icon={<Sparkles className="h-4 w-4 text-amber-300" />} onClose={onClose}>
      <p className="text-xs text-zinc-400">Get a starting idea (chords, bass, melody, drums) in {project.key} {project.scale} at {project.bpm} BPM, added as new tracks you can edit or delete.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <label>Style<select value={genre} onChange={(e) => setGenre(e.target.value)} className="mt-1 w-full rounded bg-black/40 px-2 py-1">{GENRES.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        <label>Length<select value={bars} onChange={(e) => setBars(Number(e.target.value))} className="mt-1 w-full rounded bg-black/40 px-2 py-1">{[4, 8, 16].map((b) => <option key={b} value={b}>{b} bars</option>)}</select></label>
      </div>
      <button onClick={() => void go()} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500/80 py-2 text-sm font-medium text-black disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Write an idea</button>
    </Modal>
  );
}
