import { describe, it, expect, vi } from 'vitest';
import {
  listAudioInputs,
  devicesNeedPermission,
  subscribeToDeviceChanges,
  buildAudioConstraints,
  resolvePreferredDevice,
  loadInputPrefs,
  saveInputPrefs,
  classifyMicError,
  detectBrowser,
  computeRecordOffsetSec,
  DEFAULT_INPUT_PREFS,
} from '@/lib/daw/input-devices';

function dev(kind: MediaDeviceKind, deviceId: string, label: string, groupId = deviceId): MediaDeviceInfo {
  return { kind, deviceId, label, groupId, toJSON: () => ({}) } as MediaDeviceInfo;
}

function fakeMd(list: MediaDeviceInfo[]) {
  const listeners = new Set<() => void>();
  return {
    enumerateDevices: vi.fn(async () => list),
    addEventListener: vi.fn((_t: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_t: string, fn: () => void) => listeners.delete(fn)),
    fire: () => listeners.forEach((fn) => fn()),
    listeners,
  };
}

describe('listAudioInputs (device enumeration)', () => {
  it('lists every audioinput by label and drops outputs/video', async () => {
    const md = fakeMd([
      dev('audioinput', 'a1', 'MacBook Pro Microphone', 'g1'),
      dev('audioinput', 'a2', 'Focusrite Scarlett 2i2 USB', 'g2'),
      dev('audiooutput', 'o1', 'Speakers', 'g1'),
      dev('videoinput', 'v1', 'FaceTime HD', 'g3'),
    ]);
    const out = await listAudioInputs(md as never);
    expect(out.map((d) => d.label).sort()).toEqual(['Focusrite Scarlett 2i2 USB', 'MacBook Pro Microphone']);
    expect(out.every((d) => d.hasRealLabel)).toBe(true);
  });

  it('collapses Chrome default/communications pseudo-devices and marks the default', async () => {
    const md = fakeMd([
      dev('audioinput', 'default', 'Default - Shure MV7', 'gs'),
      dev('audioinput', 'communications', 'Communications - Shure MV7', 'gs'),
      dev('audioinput', 'shure', 'Shure MV7', 'gs'),
      dev('audioinput', 'mac', 'MacBook Pro Microphone', 'gm'),
    ]);
    const out = await listAudioInputs(md as never);
    expect(out.map((d) => d.deviceId)).toEqual(['shure', 'mac']);
    expect(out[0].isDefault).toBe(true);
    expect(out[1].isDefault).toBe(false);
  });

  it('gives numbered fallback labels before permission and reports that permission is needed', async () => {
    const md = fakeMd([dev('audioinput', 'x', '', 'g'), dev('audioinput', 'y', '', 'h')]);
    const out = await listAudioInputs(md as never);
    expect(out.map((d) => d.label)).toEqual(['Input 1', 'Input 2']);
    expect(devicesNeedPermission(out)).toBe(true);
  });

  it('returns an empty list when mediaDevices is missing', async () => {
    expect(await listAudioInputs(null)).toEqual([]);
  });

  it('subscribes to devicechange for hot-plugging and unsubscribes', () => {
    const md = fakeMd([]);
    const cb = vi.fn();
    const off = subscribeToDeviceChanges(cb, md as never);
    md.fire();
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    md.fire();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('buildAudioConstraints', () => {
  it('turns voice processing OFF by default (music grade)', () => {
    const c = buildAudioConstraints({ sampleRate: 48000 }) as Record<string, unknown>;
    expect(c.echoCancellation).toBe(false);
    expect(c.noiseSuppression).toBe(false);
    expect(c.autoGainControl).toBe(false);
    expect(c.sampleRate).toEqual({ ideal: 48000 });
    expect(c.channelCount).toEqual({ ideal: 2 });
    expect(c.deviceId).toBeUndefined();
  });

  it('enables cleanup only when asked', () => {
    const c = buildAudioConstraints({ voiceCleanup: true });
    expect(c.echoCancellation).toBe(true);
    expect(c.noiseSuppression).toBe(true);
    expect(c.autoGainControl).toBe(true);
  });

  it('pins an exact device, and relaxes to ideal on retry', () => {
    expect(buildAudioConstraints({ deviceId: 'abc' }).deviceId).toEqual({ exact: 'abc' });
    const relaxed = buildAudioConstraints({ deviceId: 'abc', sampleRate: 48000, relaxed: true }) as Record<string, unknown>;
    expect(relaxed.deviceId).toEqual({ ideal: 'abc' });
    expect(relaxed.sampleRate).toBeUndefined();
  });

  it('treats the "default" pseudo id as no pin', () => {
    expect(buildAudioConstraints({ deviceId: 'default' }).deviceId).toBeUndefined();
  });
});

describe('device preferences', () => {
  const devices = [
    { deviceId: 'mac', groupId: 'g1', label: 'MacBook Mic', hasRealLabel: true, isDefault: true },
    { deviceId: 'usb-new-id', groupId: 'g2', label: 'Scarlett 2i2', hasRealLabel: true, isDefault: false },
  ];
  it('matches by id, then by label when ids rotate, then default', () => {
    expect(resolvePreferredDevice(devices, { deviceId: 'usb-new-id', deviceLabel: null })?.deviceId).toBe('usb-new-id');
    expect(resolvePreferredDevice(devices, { deviceId: 'usb-old-id', deviceLabel: 'Scarlett 2i2' })?.deviceId).toBe('usb-new-id');
    expect(resolvePreferredDevice(devices, { deviceId: 'gone', deviceLabel: 'Gone' })?.deviceId).toBe('mac');
    expect(resolvePreferredDevice([], { deviceId: null, deviceLabel: null })).toBeNull();
  });

  it('round-trips prefs through storage and sanitises bad values', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveInputPrefs({ ...DEFAULT_INPUT_PREFS, deviceId: 'usb', deviceLabel: 'Scarlett', channelMode: 'stereo', gainDb: 6 }, storage);
    expect(loadInputPrefs(storage)).toMatchObject({ deviceId: 'usb', channelMode: 'stereo', gainDb: 6, monitor: false, voiceCleanup: false });
    mem.set('concord_studio_input_v1', JSON.stringify({ gainDb: 999, channelMode: 'weird', countInBars: 99 }));
    expect(loadInputPrefs(storage)).toMatchObject({ gainDb: 24, channelMode: 'mono1', countInBars: 4 });
    mem.set('concord_studio_input_v1', '{not json');
    expect(loadInputPrefs(storage)).toEqual(DEFAULT_INPUT_PREFS);
  });
});

describe('classifyMicError', () => {
  const chrome = 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128 Safari/537.36';
  const ios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
  const named = (name: string, message = '') => Object.assign(new Error(message), { name });

  it('explains permission denied with per-browser steps', () => {
    const c = classifyMicError(named('NotAllowedError'), { userAgent: chrome, isSecureContext: true });
    expect(c.kind).toBe('permission-denied');
    expect(c.steps.join(' ')).toMatch(/address bar/i);
    const i = classifyMicError(named('NotAllowedError'), { userAgent: ios, isSecureContext: true });
    expect(i.steps.join(' ')).toMatch(/Website Settings/);
  });

  it('classifies no device, device in use, insecure context and unsupported', () => {
    expect(classifyMicError(named('NotFoundError'), { isSecureContext: true }).kind).toBe('no-device');
    expect(classifyMicError(named('NotReadableError'), { isSecureContext: true }).kind).toBe('device-in-use');
    expect(classifyMicError(named('NotAllowedError'), { isSecureContext: false }).kind).toBe('insecure-context');
    expect(classifyMicError(new Error('getUserMedia unavailable'), { isSecureContext: true }).kind).toBe('unsupported');
    expect(classifyMicError(named('OverconstrainedError'), { isSecureContext: true }).kind).toBe('overconstrained');
  });

  it('detects browsers', () => {
    expect(detectBrowser(chrome)).toBe('chrome');
    expect(detectBrowser(ios)).toBe('ios');
    expect(detectBrowser('Mozilla/5.0 Firefox/130.0')).toBe('firefox');
    expect(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/17 Safari/605')).toBe('safari');
  });
});

describe('computeRecordOffsetSec (latency compensation)', () => {
  it('adds input and output latency and clamps nonsense', () => {
    expect(computeRecordOffsetSec({ baseLatency: 0.01, outputLatency: 0.02 })).toBeCloseTo(0.03);
    expect(computeRecordOffsetSec({ baseLatency: 0.01, outputLatency: 0.02, trackLatency: 0.005 })).toBeCloseTo(0.025);
    expect(computeRecordOffsetSec({ outputLatency: 9 })).toBe(0.5);
    expect(computeRecordOffsetSec({ baseLatency: NaN, outputLatency: -1 })).toBe(0);
  });
});
