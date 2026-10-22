'use client';

import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { AutomationCurve, DAWProject, DAWTrack } from '@/lib/daw/types';
import { newId } from '@/lib/daw/project';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { useBeatFrame } from './engine-hooks';

export const MASTER_ID = '__master__';

export interface MixerPanelProps {
  project: DAWProject;
  selectedTrackId: string | null;
  onSelectTrack: (id: string) => void;
  onTrack: (id: string, patch: Partial<DAWTrack>, key?: string) => void;
  onMasterVolume: (db: number) => void;
  onToggleMastering: () => void;
  onAddReturn: (kind: 'reverb' | 'delay' | 'vca') => void;
  onAutomation: (mode: 'read' | 'off') => void;
}

const dbLabel = (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '-∞');

export function MixerPanel(p: MixerPanelProps) {
  const tracks = p.project.tracks.filter((t) => t.type !== 'master');
  const buses = tracks.filter((t) => t.type === 'bus' && !t.vca);
  const vcas = tracks.filter((t) => t.vca);
  const meters = useRef<Map<string, HTMLDivElement>>(new Map());
  const peaks = useRef<Map<string, HTMLSpanElement>>(new Map());
  const rms = useRef<Map<string, HTMLSpanElement>>(new Map());
  const corr = useRef<Map<string, HTMLSpanElement>>(new Map());
  const lufs = useRef<HTMLSpanElement>(null);
  const tp = useRef<HTMLSpanElement>(null);
  const hold = useRef<Map<string, { db: number; at: number }>>(new Map());
  useBeatFrame(() => {
    const eng = getStudioEngine();
    const now = performance.now();
    for (const [id, el] of meters.current) {
      const meter = id === MASTER_ID ? null : eng.trackMeter(id);
      const db = id === MASTER_ID ? eng.masterPeakDb() : meter!.peak;
      el.style.height = `${Math.max(0, Math.min(100, ((db + 60) / 66) * 100))}%`;
      el.style.background = db > -0.3 ? '#ef4444' : db > -6 ? '#f59e0b' : '#22c55e';
      const h = hold.current.get(id);
      if (!h || db > h.db || now - h.at > 1500) hold.current.set(id, { db, at: now });
      const lab = peaks.current.get(id);
      const hv = hold.current.get(id)!.db;
      if (lab) { lab.textContent = hv <= -60 ? '' : hv.toFixed(1); lab.style.color = hv > -0.3 ? '#f87171' : '#a1a1aa'; }
      const rmsEl = rms.current.get(id);
      if (rmsEl) rmsEl.textContent = meter && meter.rms > -60 ? meter.rms.toFixed(0) : '';
      const corrEl = corr.current.get(id);
      if (corrEl) corrEl.textContent = meter ? meter.correlation.toFixed(2) : '';
    }
    const loud = eng.masterLoudness();
    if (lufs.current) lufs.current.textContent = Number.isFinite(loud.integratedLufs) ? `${loud.integratedLufs.toFixed(1)} LUFS` : '';
    if (tp.current) tp.current.textContent = Number.isFinite(loud.truePeakDbtp) ? `${loud.truePeakDbtp.toFixed(1)} dBTP` : '';
  });
  const selected = tracks.find((t) => t.id === p.selectedTrackId) || null;
  const strip = (id: string, name: string, color: string, vol: number, onVol: (v: number) => void, extra?: ReactNode, t?: DAWTrack) => (
    <div key={id} onClick={() => p.onSelectTrack(id)} className={cn('flex w-20 flex-shrink-0 flex-col items-center gap-1 rounded-lg border p-1.5', p.selectedTrackId === id ? 'border-white/30 bg-white/[0.06]' : 'border-white/5 bg-[#15151c]')} data-testid="studio-mixer-strip">
      <div className="h-1 w-full rounded" style={{ background: color }} />
      <div className="w-full truncate text-center text-[10px] text-zinc-300">{name}</div>
      {t && !t.vca && (
        <input type="range" min={-1} max={1} step={0.01} value={t.pan} onChange={(e) => p.onTrack(t.id, { pan: Number(e.target.value) }, `pan-${t.id}`)} onDoubleClick={() => p.onTrack(t.id, { pan: 0 })} className="h-1 w-full accent-zinc-300" aria-label={`${name} pan`} />
      )}
      <div className="flex h-28 items-end gap-1">
        <input
          type="range" min={-60} max={6} step={0.1}
          value={Number.isFinite(vol) ? Math.max(-60, vol) : -60}
          onChange={(e) => { const v = Number(e.target.value); onVol(v <= -60 ? -Infinity : v); }}
          onDoubleClick={() => onVol(0)}
          className="h-28 w-4 accent-zinc-200"
          style={{ writingMode: 'vertical-lr', direction: 'rtl' }}
          aria-label={`${name} volume`}
        />
        <div className="relative h-28 w-2 overflow-hidden rounded-sm bg-black/60">
          <div ref={(el) => { if (el) meters.current.set(id, el); else meters.current.delete(id); }} className="absolute bottom-0 w-full" />
        </div>
      </div>
      <div className="flex w-full justify-between text-[9px] tabular-nums text-zinc-400">
        <span>{dbLabel(vol)}</span>
        <span ref={(el) => { if (el) peaks.current.set(id, el); else peaks.current.delete(id); }} />
      </div>
      {t && !t.vca && (
        <div className="flex w-full justify-between text-[8px] tabular-nums text-zinc-500">
          <span ref={(el) => { if (el) rms.current.set(id, el); else rms.current.delete(id); }} title="RMS" />
          <span ref={(el) => { if (el) corr.current.set(id, el); else corr.current.delete(id); }} title="Correlation" />
        </div>
      )}
      {extra}
    </div>
  );
  return (
    <div className="flex h-full flex-col" data-testid="studio-mixer">
      <div className="flex min-h-0 flex-1 gap-1.5 overflow-x-auto p-2">
        {tracks.map((t) => strip(t.id, t.name, t.color, t.volume, (v) => p.onTrack(t.id, { volume: v }, `vol-${t.id}`), t.vca ? undefined : (
          <div className="flex gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { mute: !t.mute }); }} className={cn('h-5 w-6 rounded text-[10px] font-bold', t.mute ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-400')} aria-label={`${t.name} mute`}>M</button>
            <button type="button" onClick={(e) => { e.stopPropagation(); p.onTrack(t.id, { solo: !t.solo }); }} className={cn('h-5 w-6 rounded text-[10px] font-bold', t.solo ? 'bg-sky-400 text-black' : 'bg-white/5 text-zinc-400')} aria-label={`${t.name} solo`}>S</button>
          </div>
        ), t))}
        <div className="mx-1 w-px bg-white/10" />
        {strip(MASTER_ID, 'Master', '#e4e4e7', p.project.masterBus.volume, p.onMasterVolume, (
          <div className="flex w-full flex-col items-center gap-0.5">
            <button type="button" onClick={(e) => { e.stopPropagation(); p.onToggleMastering(); }} className={cn('w-full rounded px-1 py-0.5 text-[9px]', p.project.masteringChain.enabled ? 'bg-violet-500/30 text-violet-100' : 'bg-white/5 text-zinc-500')} title="Mastering chain on/off">
              {p.project.masteringChain.enabled ? 'Mastering on' : 'Mastering off'}
            </button>
            <span ref={lufs} className="text-[8px] tabular-nums text-zinc-400" data-testid="studio-master-lufs" />
            <span ref={tp} className="text-[8px] tabular-nums text-zinc-500" data-testid="studio-master-truepeak" />
          </div>
        ))}
      </div>
      <MixRoute project={p.project} track={selected} buses={buses} vcas={vcas} onTrack={p.onTrack} onAddReturn={p.onAddReturn} onAutomation={p.onAutomation} />
    </div>
  );
}

function MixRoute({ project, track, buses, vcas, onTrack, onAddReturn, onAutomation }: {
  project: DAWProject;
  track: DAWTrack | null;
  buses: DAWTrack[];
  vcas: DAWTrack[];
  onTrack: MixerPanelProps['onTrack'];
  onAddReturn: MixerPanelProps['onAddReturn'];
  onAutomation: MixerPanelProps['onAutomation'];
}) {
  const mode = project.transport.automation === 'off' ? 'off' : 'read';
  const sends = track ? Object.entries(track.sendLevels || {}) : [];
  const lane = track?.automationLanes.find((l) => l.parameterPath === 'volume');
  const setSend = (busId: string, level: number | null, pre?: boolean) => {
    if (!track) return;
    const sendLevels = { ...track.sendLevels };
    const sendPre = { ...(track.sendPre || {}) };
    if (level == null) { delete sendLevels[busId]; delete sendPre[busId]; }
    else { sendLevels[busId] = level; if (pre != null) sendPre[busId] = pre; }
    onTrack(track.id, { sendLevels, sendPre }, `send-${track.id}`);
  };
  const addPoint = () => {
    if (!track) return;
    const beat = Math.max(0, getStudioEngine().getBeat());
    const points = [...(lane?.points || []), { id: newId('pt'), beat: Math.round(beat * 100) / 100, value: Number.isFinite(track.volume) ? track.volume : 0, curve: 'linear' as AutomationCurve }];
    const next = lane
      ? track.automationLanes.map((l) => (l.parameterPath === 'volume' ? { ...l, points } : l))
      : [...track.automationLanes, { id: newId('lane'), parameterPath: 'volume', parameterName: 'Volume', points, visible: true, color: track.color, min: -60, max: 6 }];
    onTrack(track.id, { automationLanes: next }, `vol-lane-${track.id}`);
  };
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-white/10 px-2 py-1.5 text-[10px] text-zinc-400">
      <button type="button" onClick={() => onAddReturn('reverb')} className="rounded bg-white/5 px-2 py-1 text-zinc-200 hover:bg-white/10">Add return (Reverb)</button>
      <button type="button" onClick={() => onAddReturn('delay')} className="rounded bg-white/5 px-2 py-1 text-zinc-200 hover:bg-white/10">Add return (Delay)</button>
      <button type="button" onClick={() => onAddReturn('vca')} className="rounded bg-white/5 px-2 py-1 text-zinc-200 hover:bg-white/10">Add VCA</button>
      <label className="flex items-center gap-1">
        Automation
        <select aria-label="Automation mode" value={mode} onChange={(e) => onAutomation(e.target.value === 'off' ? 'off' : 'read')} className="rounded bg-black/40 px-1 py-0.5 text-zinc-100">
          <option value="read">Read</option>
          <option value="off">Off</option>
        </select>
      </label>
      {track && !track.vca && (
        <label className="flex items-center gap-1">
          Output
          <select aria-label={`${track.name} output`} value={buses.some((b) => b.id === track.outputTarget) ? track.outputTarget : 'master'} onChange={(e) => onTrack(track.id, { outputTarget: e.target.value }, `out-${track.id}`)} className="rounded bg-black/40 px-1 py-0.5 text-zinc-100">
            <option value="master">Master</option>
            {buses.filter((b) => b.id !== track.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {track && !track.vca && vcas.length > 0 && (
        <label className="flex items-center gap-1">
          VCA
          <select aria-label={`${track.name} VCA`} value={track.vcaId || ''} onChange={(e) => onTrack(track.id, { vcaId: e.target.value || null }, `vca-${track.id}`)} className="rounded bg-black/40 px-1 py-0.5 text-zinc-100">
            <option value="">None</option>
            {vcas.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}
      {track && !track.vca && buses.length > 0 && (
        <label className="flex items-center gap-1">
          Send
          <select aria-label={`${track.name} add send`} value="" onChange={(e) => { if (e.target.value) setSend(e.target.value, track.sendLevels[e.target.value] ?? 0, false); }} className="rounded bg-black/40 px-1 py-0.5 text-zinc-100">
            <option value="">Add…</option>
            {buses.filter((b) => b.id !== track.id).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      )}
      {track && sends.map(([busId, level]) => {
        const bus = buses.find((b) => b.id === busId);
        if (!bus) return null;
        const pre = track.sendPre?.[busId] === true;
        return (
          <span key={busId} className="flex items-center gap-1">
            <span className="max-w-16 truncate">{bus.name}</span>
            <input aria-label={`${bus.name} send level`} type="range" min={-60} max={6} step={0.5} value={Math.max(-60, level)} onChange={(e) => setSend(busId, Number(e.target.value), pre)} className="h-1 w-16 accent-violet-400" />
            <label className="flex items-center gap-0.5"><input type="checkbox" checked={pre} onChange={(e) => setSend(busId, level, e.target.checked)} aria-label={`${bus.name} pre-fader`} />pre</label>
            <button type="button" onClick={() => setSend(busId, null)} className="text-zinc-500 hover:text-red-400" aria-label={`Remove ${bus.name} send`}>×</button>
          </span>
        );
      })}
      {track && (
        <span className="flex items-center gap-1">
          <button type="button" onClick={addPoint} className="rounded bg-white/5 px-1.5 py-0.5 text-zinc-200">Add volume point</button>
          {(lane?.points || []).slice().sort((a, b) => a.beat - b.beat).map((pt) => (
            <span key={pt.id} className="flex items-center gap-0.5">
              <span className="tabular-nums">{pt.beat}</span>
              <input aria-label={`Volume at beat ${pt.beat}`} type="number" step={0.1} value={pt.value} onChange={(e) => {
                const points = lane!.points.map((x) => (x.id === pt.id ? { ...x, value: Number(e.target.value) } : x));
                onTrack(track.id, { automationLanes: track.automationLanes.map((l) => (l.id === lane!.id ? { ...l, points } : l)) }, `vol-pt-${pt.id}`);
              }} className="w-12 rounded bg-black/40 px-0.5 text-zinc-100" />
              <select aria-label={`Curve at beat ${pt.beat}`} value={pt.curve === 'step' ? 'step' : 'linear'} onChange={(e) => {
                const curve: AutomationCurve = e.target.value === 'step' ? 'step' : 'linear';
                const points = lane!.points.map((x) => (x.id === pt.id ? { ...x, curve } : x));
                onTrack(track.id, { automationLanes: track.automationLanes.map((l) => (l.id === lane!.id ? { ...l, points } : l)) }, `vol-curve-${pt.id}`);
              }} className="rounded bg-black/40 text-zinc-100">
                <option value="linear">linear</option>
                <option value="step">step</option>
              </select>
              <button type="button" aria-label={`Delete volume point at ${pt.beat}`} onClick={() => {
                const points = lane!.points.filter((x) => x.id !== pt.id);
                onTrack(track.id, { automationLanes: track.automationLanes.map((l) => (l.id === lane!.id ? { ...l, points } : l)) }, `vol-del-${pt.id}`);
              }}>×</button>
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
