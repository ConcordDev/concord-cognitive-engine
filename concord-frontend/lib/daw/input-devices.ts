/**
 * Audio input devices for Concord Studio recording.
 *
 * Pure helpers (no React) so they can be unit-tested with fake
 * MediaDevices: device enumeration with labels, hot-plug subscription,
 * music-grade getUserMedia constraints, remembered device preferences,
 * and plain-language error classification with per-browser recovery steps.
 */

export type ChannelMode = 'stereo' | 'mono1' | 'mono2';

export interface AudioInputDevice {
  deviceId: string;
  groupId: string;
  /** Human label. Empty labels (before permission) get a numbered fallback. */
  label: string;
  /** True when the browser reported a real label (permission granted). */
  hasRealLabel: boolean;
  /** True for the OS default input (Chrome's "default" pseudo-device or the first device). */
  isDefault: boolean;
}

export interface InputPrefs {
  deviceId: string | null;
  deviceLabel: string | null;
  channelMode: ChannelMode;
  voiceCleanup: boolean;
  gainDb: number;
  monitor: boolean;
  /** When monitoring, route through the armed track's inserts. Default on. */
  monitorThroughFx: boolean;
  /** Mute software monitoring. The interface's own knob is the monitor. */
  directMonitor: boolean;
  countInBars: number;
  /** Loopback offset in seconds, keyed by device id. Absent until calibration accepts. */
  latencyByDevice: Record<string, number>;
}

export const DEFAULT_INPUT_PREFS: InputPrefs = {
  deviceId: null,
  deviceLabel: null,
  channelMode: 'mono1',
  voiceCleanup: false,
  gainDb: 0,
  monitor: false,
  monitorThroughFx: true,
  directMonitor: false,
  countInBars: 1,
  latencyByDevice: {},
};

const PREFS_KEY = 'concord_studio_input_v1';

type MediaDevicesLike = Pick<MediaDevices, 'enumerateDevices'> &
  Partial<Pick<MediaDevices, 'addEventListener' | 'removeEventListener' | 'getUserMedia' | 'getSupportedConstraints'>> & {
    ondevicechange?: ((this: MediaDevices, ev: Event) => unknown) | null;
  };

function getMediaDevices(): MediaDevicesLike | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return null;
  return navigator.mediaDevices as MediaDevicesLike;
}

/**
 * List every audio input. Chrome adds "default" and "communications"
 * pseudo-devices that duplicate a real device; "communications" is dropped
 * and "default" is kept (as the remembered-OS-default option) only when it
 * is the sole entry for its group. Labels are blank until mic permission
 * has been granted once; callers should then call `getUserMedia` and
 * re-enumerate.
 */
export async function listAudioInputs(md: MediaDevicesLike | null = getMediaDevices()): Promise<AudioInputDevice[]> {
  if (!md || typeof md.enumerateDevices !== 'function') return [];
  const all = await md.enumerateDevices();
  const inputs = all.filter((d) => d.kind === 'audioinput');
  const realGroups = new Set(
    inputs.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d) => d.groupId),
  );
  const defaultEntry = inputs.find((d) => d.deviceId === 'default');
  const out: AudioInputDevice[] = [];
  let n = 0;
  for (const d of inputs) {
    if (d.deviceId === 'communications') continue;
    if (d.deviceId === 'default' && realGroups.has(d.groupId)) continue;
    n += 1;
    const rawLabel = (d.label || '').trim();
    const isDefault = d.deviceId === 'default' || (!!defaultEntry && d.groupId === defaultEntry.groupId) || (!defaultEntry && n === 1);
    out.push({
      deviceId: d.deviceId,
      groupId: d.groupId,
      label: rawLabel ? rawLabel.replace(/^Default - /, '') : `Input ${n}`,
      hasRealLabel: !!rawLabel,
      isDefault,
    });
  }
  // Default first, then alphabetical so the picker is stable across reloads.
  return out.sort((a, b) => (a.isDefault === b.isDefault ? a.label.localeCompare(b.label) : a.isDefault ? -1 : 1));
}

export function devicesNeedPermission(devices: AudioInputDevice[]): boolean {
  return devices.length > 0 && devices.every((d) => !d.hasRealLabel);
}

/**
 * Hot-plug: call `cb` whenever an input is plugged in or removed.
 * Returns an unsubscribe function.
 */
export function subscribeToDeviceChanges(cb: () => void, md: MediaDevicesLike | null = getMediaDevices()): () => void {
  if (!md) return () => {};
  const handler = () => cb();
  if (typeof md.addEventListener === 'function') {
    md.addEventListener('devicechange', handler);
    return () => md.removeEventListener?.('devicechange', handler);
  }
  const prev = md.ondevicechange ?? null;
  md.ondevicechange = handler as unknown as MediaDevices['ondevicechange'];
  return () => {
    md.ondevicechange = prev;
  };
}

export interface ConstraintOptions {
  deviceId?: string | null;
  /** Browser voice processing (echo cancel, noise suppression, AGC). Off for music. */
  voiceCleanup?: boolean;
  /** Match the AudioContext so no resampling happens between device and graph. */
  sampleRate?: number;
  /** 2 asks for stereo where the interface exposes it; the browser may give 1. */
  channelCount?: 1 | 2;
  /** Relax `exact` device + sample-rate requirements (OverconstrainedError retry). */
  relaxed?: boolean;
}

/**
 * Music-grade getUserMedia audio constraints. Voice processing is OFF by
 * default: echo cancellation, noise suppression and auto gain all smear
 * transients, duck sustained notes and pump the level, which is what made
 * earlier Studio recordings sound muffled and wobbly.
 */
export function buildAudioConstraints(opts: ConstraintOptions = {}): MediaTrackConstraints {
  const cleanup = !!opts.voiceCleanup;
  const c: MediaTrackConstraints & Record<string, unknown> = {
    echoCancellation: cleanup,
    noiseSuppression: cleanup,
    autoGainControl: cleanup,
    channelCount: { ideal: opts.channelCount ?? 2 },
    latency: { ideal: 0 },
  };
  if (!cleanup) c.voiceIsolation = false;
  if (opts.sampleRate && !opts.relaxed) c.sampleRate = { ideal: opts.sampleRate };
  if (opts.deviceId && opts.deviceId !== 'default') {
    c.deviceId = opts.relaxed ? { ideal: opts.deviceId } : { exact: opts.deviceId };
  }
  return c;
}

/** Pick the remembered device: exact id, then same label (ids can rotate), then the default. */
export function resolvePreferredDevice(devices: AudioInputDevice[], prefs: Pick<InputPrefs, 'deviceId' | 'deviceLabel'>): AudioInputDevice | null {
  if (devices.length === 0) return null;
  if (prefs.deviceId) {
    const byId = devices.find((d) => d.deviceId === prefs.deviceId);
    if (byId) return byId;
  }
  if (prefs.deviceLabel) {
    const byLabel = devices.find((d) => d.hasRealLabel && d.label === prefs.deviceLabel);
    if (byLabel) return byLabel;
  }
  return devices.find((d) => d.isDefault) ?? devices[0];
}

export function loadInputPrefs(storage: Pick<Storage, 'getItem'> | null = safeStorage()): InputPrefs {
  if (!storage) return { ...DEFAULT_INPUT_PREFS };
  try {
    const raw = storage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_INPUT_PREFS };
    const p = JSON.parse(raw) as Partial<InputPrefs>;
    return {
      deviceId: typeof p.deviceId === 'string' ? p.deviceId : null,
      deviceLabel: typeof p.deviceLabel === 'string' ? p.deviceLabel : null,
      channelMode: p.channelMode === 'stereo' || p.channelMode === 'mono2' ? p.channelMode : 'mono1',
      voiceCleanup: p.voiceCleanup === true,
      gainDb: Number.isFinite(p.gainDb) ? Math.max(-24, Math.min(24, Number(p.gainDb))) : 0,
      monitor: p.directMonitor === true ? false : p.monitor === true,
      monitorThroughFx: p.monitorThroughFx !== false,
      directMonitor: p.directMonitor === true,
      countInBars: Number.isFinite(p.countInBars) ? Math.max(0, Math.min(4, Math.round(Number(p.countInBars)))) : 1,
      latencyByDevice: sanitizeLatencyMap(p.latencyByDevice),
    };
  } catch {
    return { ...DEFAULT_INPUT_PREFS };
  }
}

export function saveInputPrefs(prefs: InputPrefs, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode / quota: preference just isn't remembered */
  }
}

function sanitizeLatencyMap(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k) continue;
    if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 0.5) out[k] = val;
  }
  return out;
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type BrowserKind = 'chrome' | 'edge' | 'firefox' | 'safari' | 'ios' | 'other';

export function detectBrowser(ua: string): BrowserKind {
  const s = ua || '';
  if (/iPhone|iPad|iPod/i.test(s) || (/Macintosh/i.test(s) && /Mobile\//i.test(s))) return 'ios';
  if (/Edg\//i.test(s)) return 'edge';
  if (/Firefox\//i.test(s)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS\//i.test(s)) return 'chrome';
  if (/Safari\//i.test(s)) return 'safari';
  return 'other';
}

export type MicErrorKind =
  | 'insecure-context'
  | 'unsupported'
  | 'permission-denied'
  | 'no-device'
  | 'device-in-use'
  | 'overconstrained'
  | 'aborted'
  | 'unknown';

export interface MicErrorInfo {
  kind: MicErrorKind;
  title: string;
  message: string;
  steps: string[];
  /** True when retrying (after the user follows the steps) can succeed. */
  retryable: boolean;
}

function reallowSteps(browser: BrowserKind): string[] {
  switch (browser) {
    case 'chrome':
    case 'edge':
      return [
        'Click the lock or tune icon left of the address bar.',
        'Set Microphone to Allow, then reload the page.',
        'macOS: also check System Settings > Privacy & Security > Microphone and enable your browser.',
      ];
    case 'firefox':
      return [
        'Click the microphone icon (or the lock) in the address bar.',
        'Clear the "Blocked" microphone permission, then reload and choose Allow.',
        'macOS: System Settings > Privacy & Security > Microphone must list Firefox as enabled.',
      ];
    case 'safari':
      return [
        'Safari menu > Settings for concord-os.org (or Settings > Websites > Microphone).',
        'Set Microphone to Allow, then reload.',
        'macOS: System Settings > Privacy & Security > Microphone must include Safari.',
      ];
    case 'ios':
      return [
        'Tap "aA" in the address bar > Website Settings > Microphone > Allow.',
        'If it is missing: iOS Settings > Safari > Microphone > Allow (or Ask).',
        'Reload the page and tap Record again.',
      ];
    default:
      return ['Open your browser site settings for concord-os.org, allow the microphone, then reload.'];
  }
}

/** Turn a getUserMedia / AudioContext failure into something a musician can act on. */
export function classifyMicError(
  err: unknown,
  env: { isSecureContext?: boolean; userAgent?: string } = {},
): MicErrorInfo {
  const browser = detectBrowser(env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''));
  const name = (err && typeof err === 'object' && 'name' in err ? String((err as { name: unknown }).name) : '') || '';
  const msg = err instanceof Error ? err.message : String(err ?? '');

  if (env.isSecureContext === false || name === 'InsecureContextError') {
    return {
      kind: 'insecure-context',
      title: 'Recording needs a secure page',
      message: 'Browsers only allow microphones on https:// pages (or localhost).',
      steps: ['Open https://concord-os.org/lenses/studio instead of an http:// or IP address.'],
      retryable: false,
    };
  }
  if (name === 'NotSupportedError' || name === 'UnsupportedError' || /getUserMedia unavailable|not supported/i.test(msg)) {
    return {
      kind: 'unsupported',
      title: 'This browser can\u2019t record audio',
      message: 'Audio input isn\u2019t available here (in-app browsers often block it).',
      steps: ['Open the page in Chrome, Edge, Firefox or Safari directly.'],
      retryable: false,
    };
  }
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return {
      kind: 'permission-denied',
      title: 'Microphone access is blocked',
      message: 'The browser or your operating system denied the microphone.',
      steps: reallowSteps(browser),
      retryable: true,
    };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return {
      kind: 'no-device',
      title: 'No microphone found',
      message: 'No audio input is connected or enabled.',
      steps: [
        'Plug in your mic or USB audio interface (the list refreshes automatically).',
        'Check the cable/power and that the interface shows up in your OS sound settings.',
      ],
      retryable: true,
    };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || (name === 'AbortError' && /in use|busy|could not start/i.test(msg))) {
    return {
      kind: 'device-in-use',
      title: 'The input is busy',
      message: 'Another app or tab is holding the microphone, or the device stopped responding.',
      steps: [
        'Close other apps using the mic (Zoom, Discord, FaceTime, another DAW) or other Concord tabs.',
        'Unplug and re-plug the interface, then press Retry.',
      ],
      retryable: true,
    };
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return {
      kind: 'overconstrained',
      title: 'That input disappeared',
      message: 'The remembered device isn\u2019t available with these settings.',
      steps: ['Pick another input from the list, or reconnect the device.'],
      retryable: true,
    };
  }
  if (name === 'AbortError') {
    return {
      kind: 'aborted',
      title: 'The input stopped',
      message: 'The browser aborted the microphone request.',
      steps: ['Press Retry. If it repeats, reconnect the device.'],
      retryable: true,
    };
  }
  return {
    kind: 'unknown',
    title: 'Couldn\u2019t start recording',
    message: msg || 'Unknown error',
    steps: ['Press Retry, or pick a different input.'],
    retryable: true,
  };
}

/**
 * Seconds to shift a take earlier so it lines up with what the performer heard.
 * Playback reaches the ears `outputLatency` late, and the captured input arrives
 * `inputLatency` late (track setting when exposed, else the context's base latency).
 */
export function computeRecordOffsetSec(l: { baseLatency?: number; outputLatency?: number; trackLatency?: number; measuredSec?: number }): number {
  if (typeof l.measuredSec === 'number' && Number.isFinite(l.measuredSec) && l.measuredSec >= 0) {
    return Math.min(0.5, l.measuredSec);
  }
  const finite = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const input = finite(l.trackLatency) || finite(l.baseLatency);
  const out = finite(l.outputLatency);
  // Clamp: a nonsense value (some drivers report seconds of latency) must not eat the take.
  return Math.min(0.5, input + out);
}
