'use client';

/**
 * Tune vocal: one tap puts Pitch Correct on the vocal in the song's key
 * (detecting the key from the take when the song has none), then measures the
 * take before and after through the same core the export renders with.
 * The cents shown are measured, not estimated.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import type { DAWProject, DAWTrack } from '@/lib/daw/types';
import { tuneVocal, tunedReport, type PcmAudio, type PitchReport, type TuneStyle } from '@/lib/daw/tune-vocal';

type Report = { before: PitchReport | null; after: PitchReport | null };

function fmt(r: PitchReport | null): string {
  if (!r) return '—';
  if (!r.singleVoice) return 'more than one voice';
  if (!r.notes) return 'no notes found';
  return `${r.meanCents.toFixed(0)}¢`;
}

export function TuneVocal({ project, track, getAudio, onProject }: {
  project: DAWProject;
  track: DAWTrack | null;
  getAudio: () => Map<string, PcmAudio>;
  onProject: (next: DAWProject) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [landed, setLanded] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const fx = track?.effectChain.find((e) => e.type === 'pitchCorrect') ?? null;
  const style: TuneStyle | null = fx ? (Number(fx.params.retuneMs) === 0 && Number(fx.params.humanize) === 0 ? 'hard' : 'natural') : null;

  // The Editor keys this card by track, so a new track starts with a clean report.
  useEffect(() => () => abort.current?.abort(), []);

  const measure = async (p: DAWProject, id: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    try {
      const r = await tunedReport(p, id, getAudio(), { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      setReport(r);
      setLanded((n) => n + 1);
    } catch (e) {
      if (!ctl.signal.aborted) showToast('error', e instanceof Error ? e.message : 'Could not measure the take.');
    } finally {
      if (!ctl.signal.aborted) setBusy(false);
    }
  };

  const tune = (s: TuneStyle) => {
    if (!track) return;
    const r = tuneVocal(project, track.id, getAudio(), s);
    if (!r.ok) { showToast('warning', r.reason); return; }
    onProject(r.project);
    const keyText = r.keySource === 'chromatic'
      ? 'No clear key in the take, so it snaps to the nearest semitone.'
      : r.keySource === 'detected'
        ? `Detected ${r.key} ${r.scale} from your take and set it as the song key.`
        : `In the song key, ${r.key} ${r.scale}.`;
    setNote(`${s === 'hard' ? 'Hard tune' : 'Natural tune'} · ${r.range} range. ${keyText}`);
    void measure(r.project, track.id);
  };

  const isVocal = track?.type === 'audio';
  return (
    <section className="bo-metal rounded-lg border p-2.5" data-testid="booth-tune-vocal">
      <header className="mb-1.5 flex items-center justify-between">
        <span className="bo-engrave flex items-center gap-1.5 text-sm"><Mic2 className="h-3.5 w-3.5" aria-hidden /> Tune vocal</span>
        {fx && <span className="text-[10px] text-zinc-500">{fx.enabled ? 'On' : 'Bypassed'} · {style === 'hard' ? 'hard' : 'natural'}</span>}
      </header>
      {!isVocal && <p className="text-[11px] leading-relaxed text-zinc-500">Pick a recorded vocal track. Tuning works on audio, not instruments.</p>}
      {isVocal && (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => tune('natural')} disabled={busy} aria-pressed={style === 'natural'} className="bo-key h-9 rounded text-xs disabled:opacity-60" title="Gentle retune that keeps vibrato and slides" data-testid="booth-tune-natural">Natural</button>
            <button type="button" onClick={() => tune('hard')} disabled={busy} aria-pressed={style === 'hard'} className="bo-key h-9 rounded text-xs disabled:opacity-60" title="Instant retune, the hard-tuned effect" data-testid="booth-tune-hard">Hard</button>
          </div>
          {note && <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400" data-testid="booth-tune-note">{note}</p>}
          <div className={cn('bo-well mt-2 grid grid-cols-2 gap-2 rounded-md p-2', landed > 0 && 'bo-land')} key={landed} data-testid="booth-tune-report">
            <div>
              <div className="bo-engrave text-[10px]">Take</div>
              <div className="bo-led text-lg leading-tight" data-testid="booth-tune-before">{busy ? '…' : fmt(report?.before ?? null)}</div>
              <div className="text-[10px] text-zinc-500">avg off key{report?.before?.notes ? ` · ${report.before.notes} notes · worst ${report.before.worstCents.toFixed(0)}¢` : ''}</div>
            </div>
            <div>
              <div className="bo-engrave text-[10px]">Tuned</div>
              <div className="bo-led text-lg leading-tight" data-testid="booth-tune-after">{busy ? '…' : fmt(report?.after ?? null)}</div>
              <div className="text-[10px] text-zinc-500">{report?.after?.notes ? `worst ${report.after.worstCents.toFixed(0)}¢ · as exported` : 'as exported'}</div>
            </div>
          </div>
          {busy && <p className="mt-1 flex items-center gap-1 text-[10px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" /> Rendering the take through Pitch Correct…</p>}
          {fx && !report && !busy && (
            <button type="button" onClick={() => track && void measure(project, track.id)} className="mt-1.5 text-[11px] text-zinc-400 underline hover:text-zinc-100">Measure this take</button>
          )}
        </>
      )}
    </section>
  );
}
