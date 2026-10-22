/**
 * Software monitor routing and the latency numbers we are willing to show.
 *
 * The recorded take stays on the dry tap. Software monitoring is a second
 * branch: into the armed track (inserts, fader, master) or, when that
 * channel does not exist, straight to the destination. Direct monitoring
 * mutes the software branch. Nothing here is a loopback measurement.
 */

export type MonitorRoute = 'off' | 'destination' | 'graph';
export type MonitorPath = 'off' | 'direct' | 'fx' | 'dry';
export type CaptureKind = 'worklet' | 'script' | 'closed';

export interface MonitorPrefs {
  /** Hear yourself through the computer. */
  monitor: boolean;
  /** Prefer the armed track's inserts. Default on. */
  monitorThroughFx: boolean;
  /** Mute software monitoring; the interface knob is the monitor. */
  directMonitor: boolean;
}

export interface MonitorDecision {
  route: MonitorRoute;
  path: MonitorPath;
  trackId: string | null;
  /** Why the path is what it is. Shown in the record panel. */
  reason: string;
}

export function decideMonitorRoute(prefs: MonitorPrefs, armedTrackId: string | null): MonitorDecision {
  if (prefs.directMonitor) {
    return {
      route: 'off',
      path: 'direct',
      trackId: null,
      reason: 'Software monitoring is muted. Use the interface monitor knob. That hardware path is not measured here.',
    };
  }
  if (!prefs.monitor) {
    return {
      route: 'off',
      path: 'off',
      trackId: null,
      reason: 'Software monitoring is off.',
    };
  }
  if (prefs.monitorThroughFx && armedTrackId) {
    return {
      route: 'graph',
      path: 'fx',
      trackId: armedTrackId,
      reason: 'Hearing the armed track: inserts, then fader and master. The recorded take stays dry, before the inserts. Mute on that track silences the monitor.',
    };
  }
  if (prefs.monitorThroughFx && !armedTrackId) {
    return {
      route: 'destination',
      path: 'dry',
      trackId: null,
      reason: 'Hearing the input dry. No armed audio track to run the inserts on. The recorded take is the same dry signal.',
    };
  }
  return {
    route: 'destination',
    path: 'dry',
    trackId: null,
    reason: 'Hearing the input dry, past the track inserts. The recorded take is the same dry signal.',
  };
}

export interface MonitorLatencyInput {
  softwareMonitor: boolean;
  baseLatencySec?: number;
  outputLatencySec?: number;
  /** MediaStreamTrack latency, when the browser exposes it. */
  trackLatencySec?: number;
  /** Declared insert delay. Zero until a device reports one. */
  deviceLatencySec?: number;
  capture: CaptureKind;
}

export interface MonitorLatencyReport {
  softwareMonitor: boolean;
  inputSec: number | null;
  outputSec: number | null;
  baseSec: number | null;
  deviceSec: number;
  /** Sum of reported parts only. Null when software monitoring is off or output is unknown. */
  totalSec: number | null;
  outputEstimatedFromBase: boolean;
  lines: string[];
}

const pos = (v: number | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;

const ms = (sec: number) => `${(sec * 1000).toFixed(1)} ms`;

export function describeMonitorLatency(input: MonitorLatencyInput): MonitorLatencyReport {
  const base = pos(input.baseLatencySec);
  const reportedOutput = pos(input.outputLatencySec);
  const track = pos(input.trackLatencySec);
  const device = pos(input.deviceLatencySec) ?? 0;
  const output = reportedOutput ?? base;
  const outputEstimatedFromBase = reportedOutput === null && base !== null;
  const outputIncludesBase = reportedOutput !== null && base !== null && reportedOutput + 1e-9 >= base;
  const software = input.softwareMonitor;
  const lines: string[] = [];

  let total: number | null = null;
  if (!software) {
    lines.push('Software monitoring is off, so no software monitor delay is shown.');
  } else if (output === null) {
    lines.push('The browser did not report output latency or a context base latency, so no monitor delay is shown.');
  } else {
    const parts: string[] = [];
    if (track !== null) parts.push(`input ${ms(track)}`);
    parts.push(outputEstimatedFromBase ? `output ${ms(output)} (estimated from the context base latency)` : `output ${ms(output)}`);
    parts.push(`inserts ${ms(device)}`);
    total = (track ?? 0) + output + device;
    lines.push(`Monitor delay ${ms(total)} = ${parts.join(' + ')}.`);
    if (track === null) lines.push('The browser did not report input latency, so it is not included.');
    if (outputIncludesBase && base !== null) {
      lines.push(`The context base latency is ${ms(base)} and is already inside the reported output latency, so it is not added again.`);
    }
    if (device === 0) lines.push('Insert delay is 0 ms. No device in this build reports a processing delay.');
    lines.push('This is not a loopback measurement.');
  }

  if (input.capture === 'worklet') {
    lines.push('Capture tap: AudioWorklet. Blocks are copied off the render quantum and transferred to the main thread. The quantum size was not measured in this run.');
  } else if (input.capture === 'script') {
    lines.push('Capture tap: ScriptProcessor fallback, 4096 frames. AudioWorklet did not load, so live worklet devices stay off.');
  } else {
    lines.push('Capture tap: not open.');
  }

  return {
    softwareMonitor: software,
    inputSec: software ? track : null,
    outputSec: software ? output : null,
    baseSec: base,
    deviceSec: device,
    totalSec: total,
    outputEstimatedFromBase,
    lines,
  };
}

/** Something the recorder and the graph can both satisfy. Tested with fakes. */
export interface MonitorAudioPort {
  setMonitorRoute(route: MonitorRoute): void;
  monitorNode(): AudioNode | null;
  captureMode: CaptureKind;
  latencyParts(): { baseLatency?: number; outputLatency?: number; trackLatency?: number };
}

export interface MonitorGraphPort {
  setMonitorSource(node: AudioNode | null, trackId: string | null): boolean;
}

export interface AppliedMonitor {
  path: MonitorPath;
  reason: string;
  report: MonitorLatencyReport;
}

/**
 * Detach, then attach. A failed graph connection falls back to the dry
 * destination so the artist still hears the input.
 */
export function applyMonitorRouting(
  prefs: MonitorPrefs,
  armedTrackId: string | null,
  audio: MonitorAudioPort | null,
  graph: MonitorGraphPort,
): AppliedMonitor {
  const decision = decideMonitorRoute(prefs, armedTrackId);
  graph.setMonitorSource(null, null);
  if (!audio) {
    const waiting = decision.route === 'off' ? decision.reason : `${decision.reason} Nothing is connected until the input is on.`;
    const report = describeMonitorLatency({ softwareMonitor: false, capture: 'closed', deviceLatencySec: 0 });
    report.lines = ['Capture tap: not open. Monitor delay is shown after the input is on. It is not a loopback measurement.'];
    return { path: decision.path, reason: waiting, report };
  }
  let path = decision.path;
  let reason = decision.reason;
  let route = decision.route;
  if (audio && decision.route === 'graph' && decision.trackId) {
    audio.setMonitorRoute('graph');
    const node = audio.monitorNode();
    const ok = !!node && graph.setMonitorSource(node, decision.trackId);
    if (!ok) {
      graph.setMonitorSource(null, null);
      audio.setMonitorRoute('destination');
      route = 'destination';
      path = 'dry';
      reason = 'Hearing the input dry. The armed track has no channel in the audio graph yet.';
    }
  } else if (audio) {
    audio.setMonitorRoute(decision.route);
  }
  const parts = audio?.latencyParts() ?? {};
  const report = describeMonitorLatency({
    softwareMonitor: route !== 'off',
    baseLatencySec: parts.baseLatency,
    outputLatencySec: parts.outputLatency,
    trackLatencySec: parts.trackLatency,
    deviceLatencySec: 0,
    capture: audio?.captureMode ?? 'closed',
  });
  return { path, reason, report };
}
