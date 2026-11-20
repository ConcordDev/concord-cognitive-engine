'use client';

/**
 * The exposure sheet. One row per film frame, top to bottom. A drawing's
 * number sits on the frame it starts and a pencil line holds it for as many
 * frames as it is exposed. Action, dialogue (the sound broken into mouth
 * shapes) and camera notes are written in pencil against the drawing; the
 * sound column is the soundtrack's real waveform at that frame. Change a
 * hold with − / + and the sheet re-lays itself from the server's answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { an } from './lt';

interface Drawing { frameId: string; drawing: number; startFrame: number; endFrame: number; exposure: number; startSec: number; action: string; dialogue: string; camera: string }
interface Sheet { fps: number; totalFrames: number; durationSec: number; drawings: Drawing[] }
interface SyncTrack { id: string; name: string; startFrame: number; endFrame: number; waveform: number[] }
type Field = 'action' | 'dialogue' | 'camera';

export function XSheet({ animId, rev, playhead, openDrawing, onOpenDrawing, onChanged }: {
  animId: string; rev: number; playhead: number | null; openDrawing: number;
  onOpenDrawing: (drawingIndex: number) => void; onChanged: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [sound, setSound] = useState<SyncTrack[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const body = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const [x, s] = await Promise.all([
      an<Sheet>('xsheet-get', { animId }),
      an<{ tracks: SyncTrack[] }>('audio-sync-map', { id: animId }),
    ]);
    if (!x.ok) { setErr(x.error); return; }
    setErr(null);
    const r = x.result;
    // Only a real sheet is drawn; anything malformed is said plainly.
    if (!r || !Array.isArray(r.drawings)) { setErr('The exposure sheet came back empty.'); setSheet({ fps: 12, totalFrames: 0, durationSec: 0, drawings: [] }); return; }
    setSheet(r);
    setSound((s.result?.tracks || []).filter((t) => Array.isArray(t.waveform) && t.waveform.length));
  }, [animId]);
  useEffect(() => { void load(); }, [load, rev]);

  // Keep the playhead row in view while playing.
  useEffect(() => {
    if (playhead == null || !body.current) return;
    const row = body.current.querySelector(`tr[data-frame="${playhead}"]`) as HTMLElement | null;
    if (row) { const b = body.current; const top = row.offsetTop - b.clientHeight / 2; b.scrollTop = Math.max(0, top); }
  }, [playhead]);

  const save = async (d: Drawing, field: Field) => {
    const key = `${d.frameId}:${field}`;
    if (!(key in draft)) return;
    const value = draft[key];
    if (value === d[field]) { setDraft(({ [key]: _, ...rest }) => rest); return; }
    const r = await an<{ sheet: Record<Field, string> }>('xsheet-set', { animId, frameId: d.frameId, [field]: value });
    if (!r.ok) { setErr(r.error); return; }
    setSheet((sh) => sh && { ...sh, drawings: sh.drawings.map((x) => (x.frameId === d.frameId ? { ...x, [field]: r.result?.sheet?.[field] || '' } : x)) });
    setDraft(({ [key]: _, ...rest }) => rest);
  };
  const hold = async (d: Drawing, delta: number) => {
    const exposure = Math.max(1, Math.min(60, d.exposure + delta));
    if (exposure === d.exposure) return;
    const r = await an('frame-set-exposure', { animId, frameId: d.frameId, exposure });
    if (!r.ok) { setErr(r.error); return; }
    await load();
    onChanged();
  };

  const level = (frame: number): number | null => {
    for (const t of sound) {
      if (frame - 1 < t.startFrame || frame - 1 >= t.endFrame) continue;
      const i = Math.floor(((frame - 1 - t.startFrame) / Math.max(1, t.endFrame - t.startFrame)) * t.waveform.length);
      return t.waveform[Math.min(t.waveform.length - 1, Math.max(0, i))] ?? 0;
    }
    return null;
  };

  if (err && !sheet) return <p className="lt-error" role="alert">{err}</p>;
  if (!sheet) return <div className="lt-skeleton h-64" role="status" aria-label="Loading the exposure sheet" />;

  const rows: { frame: number; d: Drawing; first: boolean }[] = [];
  for (const d of sheet.drawings) for (let f = d.startFrame; f <= d.endFrame; f++) rows.push({ frame: f, d, first: f === d.startFrame });
  const cell = (d: Drawing, field: Field, label: string) => (
    <input className="lt-cell" aria-label={`${label}, drawing ${d.drawing}`} placeholder={label.toLowerCase()} maxLength={field === 'action' ? 120 : field === 'dialogue' ? 40 : 60}
      value={draft[`${d.frameId}:${field}`] ?? d[field]}
      onChange={(e) => setDraft((x) => ({ ...x, [`${d.frameId}:${field}`]: e.target.value }))}
      onBlur={() => { void save(d, field); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      data-testid={`xs-${field}-${d.drawing}`} />
  );

  return (
    <section className="lt-xsheet flex h-full min-h-0 flex-col" aria-label="Exposure sheet" data-testid="lt-xsheet">
      <header className="flex items-baseline justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <h3 className="lt-title text-[15px] text-[var(--lt-graphite)]">X-sheet</h3>
        <span className="lt-mono text-[11px] text-[var(--lt-muted)]">{sheet.totalFrames} fr · {sheet.fps} fps · {sheet.durationSec} s</span>
      </header>
      {err && <p className="lt-error mx-3 mb-2" role="alert">{err}</p>}
      <div ref={body} className="min-h-0 flex-1 overflow-y-auto">
        <table>
          <colgroup><col style={{ width: 40 }} /><col style={{ width: 30 }} /><col /><col style={{ width: '22%' }} /><col style={{ width: 64 }} /><col style={{ width: '20%' }} /></colgroup>
          <thead><tr><th>Fr</th><th aria-label="Sound">♪</th><th>Action</th><th>Dial</th><th>Drawing</th><th>Camera</th></tr></thead>
          <tbody>
            {rows.map(({ frame, d, first }) => {
              const lv = level(frame);
              return (
                <tr key={frame} data-frame={frame} data-sec={frame % sheet.fps === 0} data-now={playhead === frame} data-open={d.drawing - 1 === openDrawing}>
                  <td className="lt-mono text-[11px] text-[var(--lt-muted)]">{String(frame).padStart(3, '0')}</td>
                  <td aria-hidden>{lv != null && <span className="block h-[6px] rounded-sm bg-[var(--lt-blue)]" style={{ width: `${Math.max(8, Math.round(lv * 100))}%`, opacity: 0.35 + lv * 0.65 }} />}</td>
                  <td>{first ? cell(d, 'action', 'Action') : null}</td>
                  <td>{first ? cell(d, 'dialogue', 'Dialogue') : null}</td>
                  <td className="lt-x-drawing">
                    {first ? (
                      <span className="flex items-center gap-0.5">
                        <button type="button" className="lt-mono min-w-[22px] text-left text-[14px] font-bold text-[var(--lt-graphite)] hover:text-[var(--lt-red)]" onClick={() => onOpenDrawing(d.drawing - 1)} aria-label={`Open drawing ${d.drawing}`}>{d.drawing}</button>
                        <button type="button" className="rounded p-0.5 text-[var(--lt-muted)] hover:text-[var(--lt-graphite)]" onClick={() => { void hold(d, -1); }} disabled={d.exposure <= 1} aria-label={`Hold drawing ${d.drawing} one frame less`}><Minus className="h-3 w-3" /></button>
                        <button type="button" className="rounded p-0.5 text-[var(--lt-muted)] hover:text-[var(--lt-graphite)]" onClick={() => { void hold(d, 1); }} aria-label={`Hold drawing ${d.drawing} one frame more`} data-testid={`xs-hold-plus-${d.drawing}`}><Plus className="h-3 w-3" /></button>
                      </span>
                    ) : <span className="lt-hold" aria-hidden />}
                  </td>
                  <td>{first ? cell(d, 'camera', 'Camera') : null}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
