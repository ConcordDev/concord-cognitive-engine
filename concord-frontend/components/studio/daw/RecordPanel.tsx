'use client';

import { useRef, useState } from 'react';
import { Mic, RefreshCw, Headphones, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { InputRecorderApi } from './useInputRecorder';
import { useBeatFrame } from './engine-hooks';
import type { ChannelMode } from '@/lib/daw/input-devices';

export function InputMeter({ api }: { api: InputRecorderApi }) {
  const bar = useRef<HTMLDivElement>(null);
  const rms = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLButtonElement>(null);
  const label = useRef<HTMLSpanElement>(null);
  useBeatFrame(() => {
    const l = api.getLevel();
    const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
    if (bar.current) { bar.current.style.width = pct(l.peakDb); bar.current.style.background = l.peakDb > -3 ? '#ef4444' : l.peakDb > -12 ? '#f59e0b' : '#22c55e'; }
    if (rms.current) rms.current.style.width = pct(l.rmsDb);
    if (clip.current) clip.current.style.background = l.clipped ? '#ef4444' : 'rgba(255,255,255,0.08)';
    if (label.current) label.current.textContent = l.peakDb <= -60 ? '-∞' : `${l.peakDb.toFixed(1)} dB`;
  });
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-3 flex-1 overflow-hidden rounded bg-black/60">
        <div ref={rms} className="absolute inset-y-0 left-0 bg-white/20" />
        <div ref={bar} className="absolute inset-y-0 left-0 opacity-80" />
        {[-18, -12, -6].map((db) => <div key={db} className="absolute inset-y-0 w-px bg-white/20" style={{ left: `${((db + 60) / 60) * 100}%` }} />)}
      </div>
      <span ref={label} className="w-14 text-right text-[10px] tabular-nums text-zinc-400" />
      <button ref={clip} onClick={api.resetClip} className="h-3 w-6 rounded text-[8px] font-bold text-white" title="Clip indicator — click to reset" data-testid="studio-clip-led">CLIP</button>
    </div>
  );
}

export function RecordPanel({ api }: { api: InputRecorderApi }) {
  const s = api.state;
  const [warnMonitor, setWarnMonitor] = useState(false);
  const chOpts: Array<[ChannelMode, string]> = [['mono1', 'Input 1 (mono)'], ['mono2', 'Input 2 (mono)'], ['stereo', 'Inputs 1+2 (stereo)']];
  return (
    <div className="space-y-2 text-xs" data-testid="studio-record-panel">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200"><Mic className="h-3.5 w-3.5 text-red-400" /> Input</div>
      {s.error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2" role="alert" data-testid="studio-mic-error">
          <div className="flex items-center gap-1 font-medium text-red-300"><AlertTriangle className="h-3.5 w-3.5" /> {s.error.title}</div>
          <p className="mt-1 text-[11px] text-red-200/80">{s.error.message}</p>
          {s.error.steps.length > 0 && <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-[11px] text-zinc-300">{s.error.steps.map((x) => <li key={x}>{x}</li>)}</ol>}
          {s.error.retryable && <button onClick={() => void api.openInput()} className="mt-2 rounded bg-white/10 px-2 py-1 text-[11px] text-white hover:bg-white/20">Try again</button>}
        </div>
      )}
      {!s.open && (
        <button onClick={() => void api.openInput()} disabled={s.opening} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-red-500/15 px-2 py-2 text-[12px] text-red-200 hover:bg-red-500/25 disabled:opacity-50" data-testid="studio-enable-input">
          <ShieldCheck className="h-3.5 w-3.5" /> {s.opening ? 'Waiting for permission…' : s.needsPermission ? 'Allow microphone / interface' : 'Turn on input'}
        </button>
      )}
      <label className="block">
        <span className="mb-0.5 flex items-center justify-between text-[10px] text-zinc-500">
          Device
          <button onClick={() => void api.refresh()} className="flex items-center gap-0.5 text-zinc-500 hover:text-white" title="Rescan devices"><RefreshCw className="h-3 w-3" /> rescan</button>
        </span>
        <select
          value={s.prefs.deviceId || ''}
          onChange={(e) => { const d = s.devices.find((x) => x.deviceId === e.target.value); void api.setPrefs({ deviceId: e.target.value || null, deviceLabel: d?.label || null }); }}
          className="w-full rounded bg-black/40 px-1 py-1 text-zinc-100"
          data-testid="studio-input-device"
        >
          {s.devices.length === 0 && <option value="">No inputs found — plug in a mic or interface</option>}
          {s.devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label}{d.isDefault ? ' (system default)' : ''}</option>)}
        </select>
        {s.needsPermission && s.devices.length > 0 && <span className="text-[10px] text-zinc-500">Names appear after you allow access.</span>}
      </label>
      <label className="block">
        <span className="mb-0.5 block text-[10px] text-zinc-500">Channel</span>
        <select value={s.prefs.channelMode} onChange={(e) => void api.setPrefs({ channelMode: e.target.value as ChannelMode })} className="w-full rounded bg-black/40 px-1 py-1 text-zinc-100" data-testid="studio-input-channel">
          {chOpts.map(([v, l]) => <option key={v} value={v} disabled={s.open && s.deviceChannels < 2 && v !== 'mono1'}>{l}{s.open && s.deviceChannels < 2 && v !== 'mono1' ? ' — device is mono' : ''}</option>)}
        </select>
      </label>
      <InputMeter api={api} />
      <label className="flex items-center gap-2 text-[10px] text-zinc-400">
        <span className="w-14">Input gain</span>
        <input type="range" min={-24} max={24} step={0.5} value={s.prefs.gainDb} onChange={(e) => void api.setPrefs({ gainDb: Number(e.target.value) })} className="h-1 flex-1 accent-red-400" />
        <span className="w-10 text-right tabular-nums">{s.prefs.gainDb > 0 ? '+' : ''}{s.prefs.gainDb.toFixed(1)}</span>
      </label>
      <div className="text-[10px] text-zinc-500">Aim for peaks around -12 to -6 dB. Red = too hot.</div>
      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
        <input type="checkbox" checked={s.prefs.voiceCleanup} onChange={(e) => void api.setPrefs({ voiceCleanup: e.target.checked })} className="mt-0.5" data-testid="studio-voice-cleanup" />
        <span>Voice cleanup <span className="block text-[10px] text-zinc-500">Echo cancel, noise suppression, auto gain. Leave off for singing and instruments: it squashes dynamics.</span></span>
      </label>
      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={s.prefs.monitor}
          onChange={(e) => { if (e.target.checked && !warnMonitor) { setWarnMonitor(true); return; } void api.setPrefs({ monitor: e.target.checked }); }}
          className="mt-0.5"
          data-testid="studio-monitor"
        />
        <span className="flex items-center gap-1"><Headphones className="h-3 w-3" /> Hear yourself (monitoring)</span>
      </label>
      {warnMonitor && !s.prefs.monitor && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-100">
          Use headphones. With speakers, monitoring feeds back into the microphone. The delay shown below is what the browser reported, not a loopback measurement.
          <div className="mt-1 flex gap-1">
            <button onClick={() => { setWarnMonitor(false); void api.setPrefs({ monitor: true }); }} className="rounded bg-amber-500/30 px-2 py-0.5">I have headphones on</button>
            <button onClick={() => setWarnMonitor(false)} className="rounded bg-white/10 px-2 py-0.5">Cancel</button>
          </div>
        </div>
      )}
      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={s.prefs.monitorThroughFx}
          onChange={(e) => void api.setPrefs({ monitorThroughFx: e.target.checked })}
          className="mt-0.5"
          data-testid="studio-monitor-fx"
        />
        <span>Monitor with track FX <span className="block text-[10px] text-zinc-500">When you hear yourself, the input runs through the armed track&apos;s inserts, fader, and master. The recorded take stays dry. On by default.</span></span>
      </label>
      <label className="flex items-start gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={s.prefs.directMonitor}
          onChange={(e) => void api.setPrefs({ directMonitor: e.target.checked })}
          className="mt-0.5"
          data-testid="studio-direct-monitor"
        />
        <span>Direct monitoring (interface) <span className="block text-[10px] text-zinc-500">Mutes software monitoring. Listen on the interface&apos;s hardware knob. That path is not measured here.</span></span>
      </label>
      <div className="space-y-1 text-[10px] text-zinc-500" data-testid="studio-monitor-latency">
        {s.monitorLines.map((line, i) => <p key={i}>{line}</p>)}
      </div>
      {s.open && (
        <div className="text-[10px] text-zinc-500">
          {s.activeLabel ? `Using ${s.activeLabel}. ` : ''}
          Take alignment shift {s.latencyMs} ms (reported input plus output, clamped at 500 ms). Not a loopback measurement.
          {' '}{s.deviceChannels === 2 ? 'Stereo device.' : 'Mono device.'}
        </div>
      )}
    </div>
  );
}
