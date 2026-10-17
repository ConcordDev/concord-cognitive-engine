/**
 * Offline render a server-generated `song` (from studio.compose) into a WAV
 * Blob using the same Concord Studio synthesis engine. Runs in an
 * OfflineAudioContext so it produces real PCM without touching the live
 * audio output.
 */

import { SynthEngine, DrumMachineEngine, DEFAULT_SYNTH_PRESETS } from './engine';
import { encodeDAWBufferToWavBlob } from './audio-buffer-edit';
import type { AudioBuffer as DAWAudioBuffer } from './types';

export interface ComposedSong {
  title: string;
  genre: string;
  bpm: number;
  key: string;
  scale: string;
  bars: number;
  durationSec: number;
  tracks: {
    name: string;
    role: 'chords' | 'bass' | 'melody';
    preset: string;
    notes: { pitch: number; startBeat: number; durationBeats: number; velocity: number }[];
  }[];
  drums: {
    steps: number;
    stepBeats: number;
    lanes: { pad: 'kick' | 'snare' | 'hat'; hits: number[] }[];
  };
}

export interface RenderSongOptions {
  sampleRate?: number;
  tailSec?: number;
  masterGain?: number;
  channels?: number;
}

const PAD_MAP: Record<'kick' | 'snare' | 'hat', string> = {
  kick: 'pad_0',
  snare: 'pad_1',
  hat: 'pad_2',
};

function presetForRole(role: ComposedSong['tracks'][number]['role']) {
  if (role === 'bass') return DEFAULT_SYNTH_PRESETS.find(p => p.id === 'sub-bass') || DEFAULT_SYNTH_PRESETS[0];
  if (role === 'chords') return DEFAULT_SYNTH_PRESETS.find(p => p.id === 'pad-warm') || DEFAULT_SYNTH_PRESETS[0];
  return DEFAULT_SYNTH_PRESETS.find(p => p.id === 'saw-lead') || DEFAULT_SYNTH_PRESETS[0];
}

function audioBufferToDawBuffer(nativeBuffer: AudioBuffer): DAWAudioBuffer {
  const channelData: Float32Array[] = [];
  for (let c = 0; c < nativeBuffer.numberOfChannels; c++) {
    channelData.push(Float32Array.from(nativeBuffer.getChannelData(c)));
  }
  return {
    id: `render_${Date.now()}`,
    name: 'Studio render',
    sampleRate: nativeBuffer.sampleRate,
    duration: nativeBuffer.duration,
    channels: nativeBuffer.numberOfChannels,
    waveformPeaks: [],
    channelData,
  };
}

export async function renderSongToWav(
  song: ComposedSong,
  opts: RenderSongOptions = {}
): Promise<{ blob: Blob; buffer: DAWAudioBuffer; durationSec: number }> {
  const sampleRate = opts.sampleRate ?? 44100;
  const tailSec = opts.tailSec ?? 1;
  const durationSec = song.durationSec ?? (song.bars * 4 * 60) / song.bpm;
  const totalSec = durationSec + tailSec;
  const length = Math.ceil(totalSec * sampleRate);

  const channels = opts.channels ?? 2;
  const offlineCtx = new OfflineAudioContext(channels, length, sampleRate);
  const beatDurationSec = 60 / song.bpm;

  // Master gain so the mix doesn't clip.
  const master = offlineCtx.createGain();
  master.gain.value = opts.masterGain ?? 0.6;
  master.connect(offlineCtx.destination);

  const synthEngines = new Map<string, SynthEngine>();
  const drumEngine = new DrumMachineEngine(offlineCtx);
  drumEngine.connect(master);

  // Schedule melodic tracks.
  for (const track of song.tracks) {
    const preset = presetForRole(track.role);
    const engine = new SynthEngine(preset, offlineCtx);
    engine.connect(master);
    synthEngines.set(track.name, engine);

    for (const note of track.notes) {
      const start = note.startBeat * beatDurationSec;
      const end = start + note.durationBeats * beatDurationSec;
      engine.noteOn(note.pitch, note.velocity, start);
      engine.noteOff(note.pitch, end);
    }
  }

  // Schedule drums.
  // The drum lanes describe ONE bar (song.drums.steps steps); loop it for
  // every bar of the song.
  const steps = song.drums?.steps || 16;
  const stepBeats = song.drums?.stepBeats || 0.25;
  for (let bar = 0; bar < song.bars; bar++) {
    for (const lane of song.drums?.lanes || []) {
      const padId = PAD_MAP[lane.pad];
      if (!padId) continue;
      for (const step of lane.hits) {
        const time = (bar * steps + step) * stepBeats * beatDurationSec;
        if (time < durationSec) drumEngine.triggerPad(padId, 100, time);
      }
    }
  }

  const nativeBuffer = await offlineCtx.startRendering();
  const dawBuffer = audioBufferToDawBuffer(nativeBuffer);
  const blob = encodeDAWBufferToWavBlob(dawBuffer);

  // Best-effort cleanup.
  synthEngines.forEach(e => e.dispose());
  drumEngine.dispose();
  master.disconnect();

  return { blob, buffer: dawBuffer, durationSec };
}
