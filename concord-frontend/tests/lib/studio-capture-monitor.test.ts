import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  armCapture,
  concatChannels,
  createCaptureAccumulator,
  disarmCapture,
  pushCaptureBlock,
  scriptProcessorBlockStart,
  CAPTURE_WORKLET_NAME,
  SCRIPT_TAP_FRAMES,
} from '@/lib/daw/dsp/capture-blocks';
import { applyMonitorRouting, decideMonitorRoute, describeMonitorLatency } from '@/lib/daw/dsp/monitor-routing';

describe('capture block assembly', () => {
  it('keeps only the open generation and concatenates channels', () => {
    const acc = createCaptureAccumulator();
    const gen = armCapture(acc);
    expect(pushCaptureBlock(acc, { gen, time: 1.5, channels: [Float32Array.of(1, 2), Float32Array.of(3, 4)] })).toBe(true);
    expect(pushCaptureBlock(acc, { gen: gen + 1, time: 2, channels: [Float32Array.of(9)] })).toBe(false);
    expect(pushCaptureBlock(acc, { gen, time: 1.5 + 2 / 48000, channels: [Float32Array.of(5), Float32Array.of(6)] })).toBe(true);
    const out = concatChannels(acc.chunks);
    expect(Array.from(out[0])).toEqual([1, 2, 5]);
    expect(Array.from(out[1])).toEqual([3, 4, 6]);
    expect(acc.firstTime).toBe(1.5);
    disarmCapture(acc);
    expect(pushCaptureBlock(acc, { gen, time: 3, channels: [Float32Array.of(7)] })).toBe(false);
  });

  it('places a ScriptProcessor block one buffer before playbackTime', () => {
    expect(scriptProcessorBlockStart(10, SCRIPT_TAP_FRAMES, 48000, 0)).toBeCloseTo(10 - 4096 / 48000);
    expect(scriptProcessorBlockStart(0, 4096, 48000, 3)).toBeCloseTo(3 - 4096 / 48000);
  });

  it('names the same processor the worklet source registers', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/daw/worklets/capture-tap.ts'), 'utf8');
    expect(src).toContain(`'${CAPTURE_WORKLET_NAME}'`);
    expect(src).not.toMatch(/\beval\s*\(/);
    expect(src).not.toMatch(/new Function\s*\(/);
  });
});

describe('monitor routing', () => {
  const base = { monitor: false, monitorThroughFx: true, directMonitor: false };

  it('mutes software monitoring for direct monitoring and for off', () => {
    expect(decideMonitorRoute({ ...base, directMonitor: true, monitor: true }, 't1').path).toBe('direct');
    expect(decideMonitorRoute(base, 't1').route).toBe('off');
  });

  it('routes through the armed track when monitoring with track FX', () => {
    const d = decideMonitorRoute({ ...base, monitor: true }, 'vocal');
    expect(d).toMatchObject({ route: 'graph', path: 'fx', trackId: 'vocal' });
  });

  it('falls back to a dry destination when no audio track is armed', () => {
    expect(decideMonitorRoute({ ...base, monitor: true }, null).path).toBe('dry');
    expect(decideMonitorRoute({ ...base, monitor: true, monitorThroughFx: false }, 'vocal').route).toBe('destination');
  });

  it('does not claim a live path before the input is open', () => {
    const graph = { setMonitorSource: () => false };
    const applied = applyMonitorRouting({ ...base, monitor: true }, 'vocal', null, graph);
    expect(applied.path).toBe('fx');
    expect(applied.reason).toMatch(/until the input is on/);
    expect(applied.report.totalSec).toBeNull();
    expect(applied.report.lines.join(' ')).toMatch(/not a loopback measurement/i);
  });

  it('falls back to dry when the graph has no channel, and detaches before attaching', () => {
    const routes: string[] = [];
    const calls: Array<string | null> = [];
    const audio = {
      setMonitorRoute: (r: string) => { routes.push(r); },
      monitorNode: () => ({}) as AudioNode,
      captureMode: 'worklet' as const,
      latencyParts: () => ({ baseLatency: 0.005, outputLatency: 0.02, trackLatency: 0.01 }),
    };
    const graph = {
      setMonitorSource: (node: AudioNode | null, id: string | null) => {
        calls.push(id);
        return !!node && id === 'vocal';
      },
    };
    const ok = applyMonitorRouting({ ...base, monitor: true }, 'vocal', audio, graph);
    expect(ok.path).toBe('fx');
    expect(routes).toEqual(['graph']);
    expect(calls).toEqual([null, 'vocal']);

    const missing = applyMonitorRouting({ ...base, monitor: true }, 'other', audio, graph);
    expect(missing.path).toBe('dry');
    expect(routes.at(-1)).toBe('destination');
  });
});

describe('monitor latency readout', () => {
  it('does not add base latency on top of a reported output latency', () => {
    const r = describeMonitorLatency({
      softwareMonitor: true,
      baseLatencySec: 0.005,
      outputLatencySec: 0.02,
      trackLatencySec: 0.01,
      deviceLatencySec: 0,
      capture: 'worklet',
    });
    expect(r.totalSec).toBeCloseTo(0.03);
    expect(r.inputSec).toBeCloseTo(0.01);
    expect(r.outputSec).toBeCloseTo(0.02);
    expect(r.lines.join(' ')).toMatch(/not added again/);
    expect(r.lines.join(' ')).toMatch(/not a loopback measurement/i);
    expect(r.lines.join(' ')).toMatch(/Insert delay is 0 ms/);
  });

  it('omits input latency when the browser did not report it', () => {
    const r = describeMonitorLatency({
      softwareMonitor: true,
      baseLatencySec: 0.01,
      capture: 'script',
    });
    expect(r.inputSec).toBeNull();
    expect(r.totalSec).toBeCloseTo(0.01);
    expect(r.outputEstimatedFromBase).toBe(true);
    expect(r.lines.join(' ')).toMatch(/did not report input latency/);
    expect(r.lines.join(' ')).toMatch(/ScriptProcessor fallback/);
  });

  it('shows no software delay when monitoring is off', () => {
    const r = describeMonitorLatency({ softwareMonitor: false, outputLatencySec: 0.02, trackLatencySec: 0.01, capture: 'closed' });
    expect(r.totalSec).toBeNull();
    expect(r.lines[0]).toMatch(/Software monitoring is off/);
  });
});
