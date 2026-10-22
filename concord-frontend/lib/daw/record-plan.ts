/**
 * Decide what a finished capture becomes: one arrangement clip, one take per
 * loop pass, or a punch take. The capture handed in is already aligned to
 * `startBeat` (count-in removed).
 */

import type { TransportConfig } from './types';
import { bpmAt, type TempoPoint } from './tempo-map';
import { punchRange, sliceLoopCapture, trimPunch } from './takes';

export interface PlannedPiece {
  channels: Float32Array[];
  startBeat: number;
  lengthBeats: number;
  asTake: boolean;
  nameSuffix: string;
}

export function recordingStartBeat(
  playhead: number,
  transport: TransportConfig,
  beatsPerBar: number,
): { startBeat: number; noLoop: boolean; error?: string } {
  if (transport.punchEnabled) {
    const range = punchRange(transport);
    if (!range) return { startBeat: Math.max(0, playhead), noLoop: true, error: 'Set a punch out after punch in, or turn the loop on and punch inside it.' };
    const pre = Math.max(0, Math.min(4, Math.round(transport.punchPreRollBars ?? 1))) * Math.max(1, beatsPerBar);
    return { startBeat: Math.max(0, range.start - pre), noLoop: true };
  }
  if (transport.loopEnabled && transport.loopRecord && transport.loopEnd > transport.loopStart) {
    const inside = playhead >= transport.loopStart && playhead < transport.loopEnd;
    return { startBeat: Math.max(0, inside ? playhead : transport.loopStart), noLoop: false };
  }
  return { startBeat: Math.max(0, playhead), noLoop: true };
}

export function planRecording(args: {
  channels: Float32Array[];
  sampleRate: number;
  startBeat: number;
  transport: TransportConfig;
  points: TempoPoint[];
}): { pieces: PlannedPiece[]; error?: string } {
  const { channels, sampleRate, startBeat, transport, points } = args;
  if (!channels[0]?.length) return { pieces: [], error: 'Nothing was captured.' };
  if (transport.punchEnabled) {
    const range = punchRange(transport);
    if (!range) return { pieces: [], error: 'Set a punch range before recording.' };
    const trimmed = trimPunch(channels, sampleRate, {
      recordStartBeat: startBeat,
      rangeStart: range.start,
      rangeEnd: range.end,
      points,
    });
    if (!trimmed) return { pieces: [], error: 'The punch range was not in this capture.' };
    return { pieces: [{ ...trimmed, asTake: true, nameSuffix: 'punch' }] };
  }
  if (transport.loopEnabled && transport.loopRecord && transport.loopEnd > transport.loopStart) {
    const slices = sliceLoopCapture(channels, sampleRate, {
      startBeat,
      loopStart: transport.loopStart,
      loopEnd: transport.loopEnd,
      points,
    });
    if (!slices.length) return { pieces: [], error: 'Nothing landed inside the loop.' };
    return { pieces: slices.map((s, i) => ({ ...s, asTake: true, nameSuffix: `pass ${i + 1}` })) };
  }
  const lengthBeats = (channels[0].length / sampleRate) * (bpmAt(points, startBeat) / 60);
  return { pieces: [{ channels, startBeat, lengthBeats, asTake: false, nameSuffix: '' }] };
}
