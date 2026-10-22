'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { InputRecorder, type CapturedTake } from '@/lib/daw/input-recorder';
import {
  listAudioInputs, devicesNeedPermission, subscribeToDeviceChanges, resolvePreferredDevice,
  loadInputPrefs, saveInputPrefs, classifyMicError,
  type AudioInputDevice, type InputPrefs, type MicErrorInfo,
} from '@/lib/daw/input-devices';
import { applyMonitorRouting, type MonitorPath } from '@/lib/daw/dsp/monitor-routing';
import { CAL_CHIRPS, CAL_GAP_SEC, chirpArrivalDelays, judgeDelays, makeChirp } from '@/lib/daw/dsp/calibration';
import { getStudioEngine } from '@/lib/daw/playback-engine';
import { requestPersistentStorage } from '@/lib/daw/audio-store';

export interface InputRecorderState {
  devices: AudioInputDevice[];
  needsPermission: boolean;
  prefs: InputPrefs;
  open: boolean;
  opening: boolean;
  deviceChannels: number;
  activeLabel: string | null;
  error: MicErrorInfo | null;
  /** Take-alignment shift from computeRecordOffsetSec. Not a loopback measurement. */
  latencyMs: number;
  monitorPath: MonitorPath;
  /** One sentence for the path, then the latency report lines. */
  monitorLines: string[];
}

export function useInputRecorder(armedAudioTrackId: string | null = null) {
  const recRef = useRef<InputRecorder | null>(null);
  const [st, setSt] = useState<InputRecorderState>(() => ({
    devices: [], needsPermission: true, prefs: loadInputPrefs(), open: false, opening: false,
    deviceChannels: 1, activeLabel: null, error: null, latencyMs: 0,
    monitorPath: 'off', monitorLines: ['Software monitoring is off.'],
  }));
  const prefsRef = useRef(st.prefs);

  const applyMeasured = useCallback(() => {
    const r = recRef.current;
    if (!r) return;
    const id = prefsRef.current.deviceId || 'default';
    const measured = prefsRef.current.latencyByDevice?.[id];
    r.setMeasuredOffset(typeof measured === 'number' ? measured : null);
  }, []);

  const routeMonitor = useCallback(() => {
    const r = recRef.current;
    const applied = applyMonitorRouting(prefsRef.current, armedAudioTrackId, r && r.isOpen ? r : null, getStudioEngine().graph);
    const lines = [applied.reason, ...applied.report.lines];
    setSt((s) => {
      if (s.monitorPath === applied.path && s.monitorLines.join('\n') === lines.join('\n') && s.latencyMs === Math.round((r?.latencyOffsetSec() ?? 0) * 1000)) return s;
      return { ...s, monitorPath: applied.path, monitorLines: lines, latencyMs: Math.round((r?.latencyOffsetSec() ?? 0) * 1000) };
    });
  }, [armedAudioTrackId]);

  const recorder = () => {
    if (!recRef.current) recRef.current = new InputRecorder(getStudioEngine().ctx);
    return recRef.current;
  };

  const refresh = useCallback(async () => {
    try {
      const devices = await listAudioInputs();
      setSt((s) => ({ ...s, devices, needsPermission: devicesNeedPermission(devices) }));
      return devices;
    } catch {
      return [];
    }
  }, []);

  const openInput = useCallback(async (override?: Partial<InputPrefs>): Promise<boolean> => {
    const prefs = { ...prefsRef.current, ...override };
    setSt((s) => ({ ...s, opening: true, error: null }));
    await getStudioEngine().resume();
    const devices = await refresh();
    const dev = resolvePreferredDevice(devices, prefs);
    const r = recorder();
    const res = await r.open({ deviceId: dev?.deviceId ?? prefs.deviceId, voiceCleanup: prefs.voiceCleanup, channelMode: prefs.channelMode, gainDb: prefs.gainDb, monitor: prefs.monitor });
    if (!res.ok) {
      setSt((s) => ({ ...s, opening: false, open: false, error: res.error || null }));
      return false;
    }
    const after = await refresh();
    const active = after.find((d) => d.label === res.label) || after.find((d) => d.deviceId === dev?.deviceId) || null;
    const nextPrefs: InputPrefs = { ...prefs, deviceId: active?.deviceId ?? prefs.deviceId, deviceLabel: res.label || active?.label || prefs.deviceLabel };
    saveInputPrefs(nextPrefs);
    r.onDeviceLost(() => {
      setSt((s) => ({ ...s, open: false, error: classifyMicError(Object.assign(new Error('Device disconnected'), { name: 'NotFoundError' })) }));
      void refresh();
    });
    void requestPersistentStorage();
    prefsRef.current = nextPrefs;
    applyMeasured();
    setSt((s) => ({ ...s, opening: false, open: true, prefs: nextPrefs, deviceChannels: res.deviceChannels || 1, activeLabel: res.label || null, error: null, latencyMs: Math.round(r.latencyOffsetSec() * 1000) }));
    routeMonitor();
    return true;
  }, [applyMeasured, refresh, routeMonitor]);

  const setPrefs = useCallback(async (patch: Partial<InputPrefs>) => {
    let next = { ...prefsRef.current, ...patch };
    if (patch.directMonitor) next = { ...next, directMonitor: true, monitor: false };
    else if (patch.monitor) next = { ...next, monitor: true, directMonitor: false };
    prefsRef.current = next;
    saveInputPrefs(next);
    applyMeasured();
    setSt((s) => ({ ...s, prefs: next, latencyMs: Math.round((recRef.current?.latencyOffsetSec() ?? 0) * 1000) }));
    const r = recRef.current;
    const monitorPatch = 'monitor' in patch || 'monitorThroughFx' in patch || 'directMonitor' in patch;
    if (monitorPatch) routeMonitor();
    if (!r?.isOpen) return;
    if ('gainDb' in patch) r.setGain(next.gainDb);
    if ('deviceId' in patch || 'channelMode' in patch || 'voiceCleanup' in patch) {
      if (r.isRecording) return; // never interrupt a take
      await openInput(next);
    }
  }, [applyMeasured, openInput, routeMonitor]);

  const calibrate = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const r = recorder();
    if (!r.isOpen) {
      const opened = await openInput();
      if (!opened) return { ok: false, message: 'Turn on the input, then calibrate again.' };
    }
    const prefs = prefsRef.current;
    const restoreCleanup = prefs.voiceCleanup;
    if (restoreCleanup) {
      const re = await r.open({
        deviceId: prefs.deviceId,
        voiceCleanup: false,
        channelMode: prefs.channelMode,
        gainDb: prefs.gainDb,
        monitor: prefs.monitor,
      });
      if (!re.ok) return { ok: false, message: re.error?.message || 'Could not turn off voice cleanup for calibration.' };
      routeMonitor();
    }
    const ctx = getStudioEngine().ctx;
    await ctx.resume();
    const chirp = makeChirp(ctx.sampleRate);
    const buf = ctx.createBuffer(1, chirp.length, ctx.sampleRate);
    buf.copyToChannel(chirp as Float32Array<ArrayBuffer>, 0);
    const t0 = ctx.currentTime + 0.2;
    const playTimes: number[] = [];
    if (!r.start()) {
      if (restoreCleanup) {
        await r.open({ deviceId: prefs.deviceId, voiceCleanup: true, channelMode: prefs.channelMode, gainDb: prefs.gainDb, monitor: prefs.monitor });
        routeMonitor();
      }
      return { ok: false, message: 'The capture tap did not start.' };
    }
    for (let i = 0; i < CAL_CHIRPS; i++) {
      const when = t0 + i * CAL_GAP_SEC;
      playTimes.push(when);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(when);
    }
    const waitSec = playTimes[playTimes.length - 1] - ctx.currentTime + 0.55;
    await new Promise((resolve) => setTimeout(resolve, Math.max(200, waitSec * 1000)));
    const take = r.stop({ compensate: false });
    if (restoreCleanup) {
      await r.open({
        deviceId: prefs.deviceId,
        voiceCleanup: true,
        channelMode: prefs.channelMode,
        gainDb: prefs.gainDb,
        monitor: prefs.monitor,
      });
      routeMonitor();
    }
    if (!take) return { ok: false, message: 'Nothing was captured.' };
    const delays = chirpArrivalDelays(take.channels[0], chirp, take.sampleRate, playTimes, take.startTime);
    const judged = judgeDelays(delays);
    if (!judged.ok) return { ok: false, message: judged.reason };
    const id = prefs.deviceId || 'default';
    const latencyByDevice = { ...prefs.latencyByDevice, [id]: judged.offsetSec };
    await setPrefs({ latencyByDevice });
    const ms = Math.round(judged.offsetSec * 1000);
    return { ok: true, message: `Stored ${ms} ms for this input (${judged.agree} of ${judged.found} chirps within 2 ms).` };
  }, [openInput, routeMonitor, setPrefs]);

  const close = useCallback(() => {
    recRef.current?.close();
    setSt((s) => ({ ...s, open: false }));
  }, []);

  useEffect(() => {
    // Device list is an external system. The first read has to happen after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
    const unsub = subscribeToDeviceChanges(() => { void refresh(); });
    return () => { unsub(); recRef.current?.close(); recRef.current = null; };
  }, [refresh]);

  useEffect(() => { routeMonitor(); }, [armedAudioTrackId, st.open, st.prefs.monitor, st.prefs.monitorThroughFx, st.prefs.directMonitor, routeMonitor]);

  return {
    state: st,
    refresh,
    openInput,
    setPrefs,
    calibrate,
    close,
    getLevel: () => recRef.current?.getLevel() ?? { peakDb: -120, rmsDb: -120, clipped: false },
    resetClip: () => recRef.current?.resetClip(),
    start: () => recRef.current?.start() ?? false,
    stop: (): CapturedTake | null => recRef.current?.stop() ?? null,
    isRecording: () => !!recRef.current?.isRecording,
    isOpen: () => !!recRef.current?.isOpen,
  };
}

export type InputRecorderApi = ReturnType<typeof useInputRecorder>;
