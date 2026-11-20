'use client';

/**
 * Controllers: plug in a MIDI controller, press Learn, wiggle a knob or a
 * fader, and it now drives that fader or pan. Maps are stored with the song
 * (studio.midi-map-*); incoming messages move the real mixer through the same
 * edit path as the mouse (one undo step per gesture).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Cable, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';
import type { DAWProject } from '@/lib/daw/types';
import { isSavedProject, studio, type MidiMap } from './boothApi';
import { defaultRange, MASTER_TARGET, parseCc, parseTarget, targetLabel, trackTarget, valueFor, type TargetKind } from './midiLearn';

type Access = 'off' | 'asking' | 'ready' | 'unsupported' | 'denied';


export function MidiLearn({ project, selectedTrackId, onTrack, onMasterVolume }: {
  project: DAWProject;
  selectedTrackId: string | null;
  onTrack: (id: string, patch: { volume?: number; pan?: number }, key?: string) => void;
  onMasterVolume: (db: number) => void;
}) {
  const [access, setAccess] = useState<Access>('off');
  const [devices, setDevices] = useState<string[]>([]);
  const [maps, setMaps] = useState<MidiMap[]>([]);
  const [learning, setLearning] = useState<string | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  const saved = isSavedProject(project.id);
  const midi = useRef<MIDIAccess | null>(null);
  // Handlers read the latest values without re-binding every MIDI input.
  const live = useRef({ maps, learning, onTrack, onMasterVolume, projectId: project.id });
  // eslint-disable-next-line react-hooks/refs
  live.current = { maps, learning, onTrack, onMasterVolume, projectId: project.id };

  const loadMaps = useCallback(async () => {
    if (!saved) return;
    const r = await studio<{ maps: MidiMap[] }>('midi-map-list', { projectId: project.id });
    if (r.ok) setMaps(r.result?.maps || []);
  }, [project.id, saved]);
  useEffect(() => { void loadMaps(); }, [loadMaps]);

  const learn = useCallback(async (target: string, kind: TargetKind, cc: { channel: number; controller: number }, deviceName: string) => {
    setLearning(null);
    const r = await studio<{ map: MidiMap; replaced: number }>('midi-map-add', {
      projectId: live.current.projectId, target, msgType: 'cc', controller: cc.controller, channel: cc.channel, deviceName, ...defaultRange(kind),
    });
    if (!r.ok || !r.result?.map) { showToast('error', r.error || 'That control was not saved.'); return; }
    const m = r.result.map;
    setMaps((prev) => [...prev.filter((x) => x.target !== m.target && !(x.controller === m.controller && x.channel === m.channel && x.msgType === m.msgType)), m]);
    setLanded(m.id);
  }, []);

  const onMessage = useCallback((data: Uint8Array | null, deviceName: string) => {
    const cc = parseCc(data);
    if (!cc) return;
    const { learning: target, maps: list } = live.current;
    if (target) {
      const t = parseTarget(target);
      if (t) void learn(target, t.kind, cc, deviceName);
      return;
    }
    for (const m of list) {
      if (m.msgType !== 'cc' || m.controller !== cc.controller || m.channel !== cc.channel) continue;
      const t = parseTarget(m.target);
      if (!t) continue;
      const v = valueFor(t.kind, cc.value, m.rangeMin, m.rangeMax);
      if (t.scope === 'master') live.current.onMasterVolume(v);
      else if (t.trackId) live.current.onTrack(t.trackId, t.kind === 'pan' ? { pan: v } : { volume: v }, `midi-${t.kind}-${t.trackId}`);
    }
  }, [learn]);

  const bind = useCallback(() => {
    const acc = midi.current;
    if (!acc) return;
    const names: string[] = [];
    acc.inputs.forEach((input) => {
      const name = input.name || 'MIDI input';
      names.push(name);
      input.onmidimessage = (e: MIDIMessageEvent) => onMessage(e.data, name);
    });
    setDevices(names);
  }, [onMessage]);

  const enable = async () => {
    const nav = navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> };
    if (typeof nav.requestMIDIAccess !== 'function') { setAccess('unsupported'); return; }
    setAccess('asking');
    try {
      const acc = await nav.requestMIDIAccess();
      midi.current = acc;
      acc.onstatechange = () => bind();
      bind();
      setAccess('ready');
    } catch {
      setAccess('denied');
    }
  };
  useEffect(() => { if (access === 'ready') bind(); }, [access, bind]);
  useEffect(() => () => {
    const acc = midi.current;
    if (!acc) return;
    acc.onstatechange = null;
    acc.inputs.forEach((input) => { input.onmidimessage = null; });
  }, []);

  const remove = async (m: MidiMap) => {
    const before = maps;
    setMaps(before.filter((x) => x.id !== m.id));
    const r = await studio('midi-map-delete', { id: m.id });
    if (!r.ok) { setMaps(before); showToast('error', r.error || 'That map was not removed.'); }
  };

  const sel = project.tracks.find((t) => t.id === selectedTrackId && t.type !== 'master') || null;
  const targets: Array<[string, string]> = [
    ...(sel ? [[trackTarget(sel.id, 'volume'), `${sel.name} fader`], [trackTarget(sel.id, 'pan'), `${sel.name} pan`]] as Array<[string, string]> : []),
    [MASTER_TARGET, 'Master fader'],
  ];

  return (
    <section className="bo-metal rounded-lg border p-2.5" data-testid="booth-midi-learn">
      <header className="mb-1.5 flex items-center justify-between">
        <span className="bo-engrave flex items-center gap-1.5 text-sm"><Cable className="h-3.5 w-3.5" aria-hidden /> Controllers</span>
        {access === 'ready' && <span className="text-[10px] text-zinc-500">{devices.length ? devices.join(', ') : 'No controller plugged in'}</span>}
      </header>
      {!saved && <p className="text-[11px] text-zinc-500">Controller maps save with the song once it is saved.</p>}
      {saved && access !== 'ready' && (
        <div className="space-y-1.5">
          <p className="text-[11px] leading-relaxed text-zinc-400">Drive faders and pans from a hardware controller. Your browser asks once for MIDI access.</p>
          <button type="button" onClick={() => void enable()} disabled={access === 'asking'} className="bo-key flex h-8 items-center gap-1.5 rounded px-3 text-xs disabled:opacity-60" data-testid="booth-midi-enable">
            {access === 'asking' && <Loader2 className="h-3 w-3 animate-spin" />} Connect controller
          </button>
          {access === 'unsupported' && <p className="text-[11px] text-amber-300">This browser has no Web MIDI. Chrome or Edge on desktop do.</p>}
          {access === 'denied' && <p className="text-[11px] text-red-300">MIDI access was refused. Allow it in the site settings and try again.</p>}
        </div>
      )}
      {saved && access === 'ready' && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {targets.map(([target, label]) => (
              <button
                key={target}
                type="button"
                onClick={() => setLearning((cur) => (cur === target ? null : target))}
                aria-pressed={learning === target}
                className="bo-key rounded px-2 py-1 text-[11px]"
                data-testid="booth-midi-learn-target"
              >
                {learning === target ? 'Move a control…' : `Learn ${label}`}
              </button>
            ))}
          </div>
          {learning && <p className="text-[11px] text-amber-300">Move a knob or fader on your controller now. Press the key again to cancel.</p>}
        </div>
      )}
      {maps.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {maps.map((m) => {
            const label = targetLabel(m.target, project);
            return (
              <li key={m.id} className={cn('flex items-center justify-between gap-2 rounded bg-black/30 px-1.5 py-1 text-[11px]', landed === m.id && 'bo-land')}>
                <span className="bo-led text-[11px]">CC {m.controller} · ch {m.channel + 1}</span>
                <span className={cn('flex-1 truncate', label ? 'text-zinc-200' : 'text-zinc-600 line-through')}>{label ?? 'Track removed'}</span>
                <button type="button" onClick={() => void remove(m)} className="text-zinc-500 hover:text-red-400" aria-label={`Forget CC ${m.controller} mapping`}><X className="h-3 w-3" /></button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
