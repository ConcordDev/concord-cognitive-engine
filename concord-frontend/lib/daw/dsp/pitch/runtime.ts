/**
 * Main-thread side of the pitch worklet: load flag, node registry, meter.
 * The audio thread never touches React.
 */

import type { EffectInstance } from '../../types';
import { noteLabel, type PitchMeter, type PitchSettings } from './core';
import { pitchWorkletReady, PITCH_WORKLET_NAME } from '../../worklets/load-pitch-worklet';

export interface PitchMeterView {
  id: string;
  detected: string;
  target: string;
  cents: number;
  voiced: boolean;
}

const EMPTY: PitchMeterView = { id: '', detected: '—', target: '—', cents: 0, voiced: false };
let view: PitchMeterView = EMPTY;
const nodes = new Map<string, (settings: PitchSettings) => void>();

export function readPitchMeter(): PitchMeterView {
  return view;
}

export function pitchNodeBound(id: string): boolean {
  return nodes.has(id);
}

export function pushPitchSettings(id: string, settings: PitchSettings): void {
  nodes.get(id)?.(settings);
}

export function createPitchDevice(ctx: BaseAudioContext, fx: EffectInstance): { input: AudioNode; output: AudioNode; dispose: () => void } | null {
  if (!pitchWorkletReady() || typeof AudioWorkletNode !== 'function') return null;
  try {
    const node = new AudioWorkletNode(ctx, PITCH_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
    });
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string; meter?: PitchMeter } | null;
      if (!data || data.type !== 'meter' || !data.meter) return;
      const m = data.meter;
      view = {
        id: fx.id,
        detected: m.voiced ? noteLabel(m.detectedHz) : '—',
        target: m.voiced ? noteLabel(m.targetHz) : '—',
        cents: m.voiced ? m.cents : 0,
        voiced: m.voiced,
      };
    };
    const send = (settings: PitchSettings) => node.port.postMessage({ type: 'settings', id: fx.id, settings });
    nodes.set(fx.id, send);
    return {
      input: node,
      output: node,
      dispose: () => {
        nodes.delete(fx.id);
        if (view.id === fx.id) view = EMPTY;
        try { node.disconnect(); } catch { /* noop */ }
      },
    };
  } catch {
    return null;
  }
}
