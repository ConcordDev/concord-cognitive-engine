'use client';

/**
 * The cutting room. Footage comes in as real uploads (the file goes up as the
 * request body; its length is read from the file). The program monitor plays
 * the chosen sequence exactly as cut. Below it: the media bin and the
 * timeline, the panels that edit what the monitor plays.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Upload } from 'lucide-react';
import { FsMediaPanel } from '@/components/film-studios/FsMediaPanel';
import { FsEditPanel } from '@/components/film-studios/FsEditPanel';
import { FilmStackFeed } from '@/components/film-studios/FilmStackFeed';
import { ProgramMonitor } from './ProgramMonitor';
import { fs, runtime, uploadFootage, type Footage } from './fo';

interface Sequence { id: string; name: string; fps?: number }

export function CuttingRoom({ projectId, onChange }: { projectId: string; onChange?: () => void }) {
  const [footage, setFootage] = useState<Footage[] | null>(null);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [seqId, setSeqId] = useState<string>('');
  const [rev, setRev] = useState(0);
  const [uploading, setUploading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [m, q] = await Promise.all([
      fs<{ media: Footage[] }>('media-list', { projectId }),
      fs<{ sequences: Sequence[] }>('sequence-list', { projectId }),
    ]);
    setFootage(m.ok ? m.result?.media || [] : []);
    const seqs = q.ok ? q.result?.sequences || [] : [];
    setSequences(seqs);
    setSeqId((cur) => (cur && seqs.some((s) => s.id === cur) ? cur : seqs[0]?.id || ''));
  }, [projectId]);
  useEffect(() => { void load(); }, [load, rev]);

  // Stable on purpose: the timeline panel reloads whenever this identity changes
  // and calls it after every load, so a fresh function each render would loop.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const bump = useCallback(() => { setRev((r) => r + 1); onChangeRef.current?.(); }, []);
  const timelineChanged = useCallback(() => { onChangeRef.current?.(); }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setMsg(null);
    let added = 0;
    for (const file of Array.from(files)) {
      setUploading(file.name);
      const name = file.name.replace(/\.[^.]+$/, '');
      const up = await uploadFootage(file, name);
      if (!up.ok) { setMsg({ kind: 'error', text: `${file.name}: ${up.error}` }); continue; }
      const reg = await fs<{ media: Footage }>('media-register', { projectId, platformMediaId: up.mediaId, name });
      if (!reg.ok) { setMsg({ kind: 'error', text: `${file.name}: ${reg.error}` }); continue; }
      added++;
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = '';
    if (added) setMsg({ kind: 'ok', text: `${added} file${added > 1 ? 's' : ''} in the bin.` });
    bump();
  };

  const uploaded = (footage || []).filter((f) => f.platformMediaId);

  return (
    <div className="space-y-5" data-testid="fo-cutting-room">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="fo-dark p-4" aria-label="Program monitor">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <span className="fo-label !text-[#9b9588]">Program</span>
            {sequences.length > 0 ? (
              <select className="fo-input !w-auto !min-h-[32px] !bg-[#1d1e21] !text-[#e9e4d6] !border-[#3a3b40]" value={seqId} onChange={(e) => setSeqId(e.target.value)} aria-label="Sequence to play">
                {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            ) : <span className="text-[13px] text-[#9a9a9a]">Make a sequence on the timeline below to play a cut.</span>}
            <button type="button" className="fo-btn ml-auto !min-h-[30px] text-[12px]" onClick={bump} data-testid="fo-monitor-refresh">Load the latest cut</button>
          </div>
          {seqId ? <ProgramMonitor key={`${seqId}:${rev}`} sequenceId={seqId} /> : <div className="fo-screen" />}
        </section>

        <aside className="fo-sheet p-4" aria-label="Footage">
          <div className="flex items-center justify-between">
            <h3 className="fo-slate text-[17px]">Footage</h3>
            <button type="button" className="fo-btn fo-btn-tape" onClick={() => fileRef.current?.click()} disabled={!!uploading} data-testid="fo-upload-footage">
              <Upload className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Upload'}
            </button>
            <input ref={fileRef} type="file" accept="video/*,audio/*,image/*" multiple hidden onChange={(e) => { void onFiles(e.target.files); }} data-testid="fo-footage-input" />
          </div>
          {uploading && <p className="mt-2 text-[12px] text-[var(--fo-muted)]" role="status">Sending {uploading}…</p>}
          {msg && <p className={`mt-2 ${msg.kind === 'ok' ? 'fo-ok' : 'fo-error'}`} role={msg.kind === 'error' ? 'alert' : 'status'}>{msg.text}</p>}
          {footage === null ? <div className="fo-skeleton mt-3 h-24" /> : uploaded.length === 0 ? (
            <p className="mt-3 text-[13px] text-[var(--fo-muted)]">No uploaded footage yet. Upload video, sound or stills; each file keeps its real length.</p>
          ) : (
            <ul className="mt-3 space-y-1.5" data-testid="fo-footage-list">
              {uploaded.map((f) => (
                <li key={f.id} className="flex items-center gap-2 rounded border border-[var(--fo-rule)] bg-[var(--fo-input)] px-2.5 py-1.5 text-[13px]">
                  <Film className="h-3.5 w-3.5 shrink-0 text-[var(--fo-muted)]" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <span className="fo-tc text-[12px] text-[var(--fo-muted)]">{f.kind === 'image' ? 'still' : f.durationSec ? runtime(f.durationSec) : '—'}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[12px] text-[var(--fo-faint)]">Put footage on a clip in the timeline (each clip&rsquo;s media picker) and the monitor plays it.</p>
        </aside>
      </div>

      <section className="fo-sheet p-4" aria-label="Timeline">
        <FsEditPanel key={`tl:${rev}`} projectId={projectId} onChange={timelineChanged} />
      </section>
      <section className="fo-sheet p-4" aria-label="Media bin">
        <FsMediaPanel key={`bin:${rev}`} projectId={projectId} />
      </section>
      <section className="fo-sheet p-4" aria-label="Craft questions">
        <h3 className="fo-slate mb-2 text-[17px]">Craft questions</h3>
        <FilmStackFeed />
      </section>
    </div>
  );
}
