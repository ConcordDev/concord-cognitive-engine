/**
 * Workbench mixdown renderer — the REAL bounce for server-side Studio
 * projects (the project/track/clip model served by the studio.* lens
 * actions and shown in DawWorkbenchSection).
 *
 * Q31: BouncePanel used to attach a 4-second 220 Hz placeholder tone as
 * a publish's reference audio and never sent audio to studio.bounce, so
 * every bounce sat "pending" forever. This module renders the actual
 * project into PCM with OfflineAudioContext:
 *
 *   - audio clips: the clip's audioUrl is fetched + decoded and placed
 *     at its beat position (looping bounded to the clip window), through
 *     the track's gain/pan;
 *   - MIDI / drum clips: the clip's actual notes are voiced — melodic
 *     notes via an oscillator whose waveform follows the track preset,
 *     drum notes via synthesized kick/snare/hat voices (the same
 *     synthesis approach as DrumRackPanel);
 *   - mute/solo are honored (any solo → only solo tracks render).
 *
 * Accounting is part of the contract: every clip that cannot be rendered
 * (audio clip with no source, failed fetch/decode, MIDI clip with no
 * notes) is returned in `skipped` with a reason — never silently
 * dropped. When nothing at all renders, `pcm` is null and the caller
 * must surface why instead of fabricating audio.
 *
 * Note on fidelity: nothing plays these server-side projects live, so
 * this render is the reference render — note timbres are honest
 * approximations keyed to the preset names, not sampled instruments.
 */

export interface WorkbenchTrack {
  id: string;
  name?: string;
  kind?: string;
  volume?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
  preset?: string;
}

export interface WorkbenchClip {
  id: string;
  trackId: string;
  name?: string;
  kind?: string;
  startBeats: number;
  lengthBeats: number;
  audioUrl?: string | null;
  loop?: boolean;
  muted?: boolean;
}

export interface WorkbenchNote {
  clipId: string;
  pitch: number;
  velocity?: number;
  startBeats: number;
  lengthBeats: number;
}

export interface WorkbenchProject {
  bpm?: number;
  tracks?: WorkbenchTrack[];
}

export interface RenderSkip {
  clipName: string;
  reason: string;
}

export interface WorkbenchRenderResult {
  /** Stereo PCM, or null when nothing rendered. */
  pcm: { channels: Float32Array[]; sampleRate: number } | null;
  durationSec: number;
  renderedClips: number;
  skipped: RenderSkip[];
  /** The tempo the render used (project bpm, or the 120 default). */
  bpm: number;
}

export interface WorkbenchRenderDeps {
  fetchAudio?: (url: string) => Promise<ArrayBuffer>;
  createContext?: (channels: number, length: number, sampleRate: number) => OfflineAudioContext;
}

const DEFAULT_BPM = 120;
const TAIL_SEC = 0.25;

function defaultCreateContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
  const Ctor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Ctor) throw new Error('OfflineAudioContext unavailable in this browser');
  return new Ctor(channels, length, sampleRate);
}

async function defaultFetchAudio(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.arrayBuffer();
}

function waveformFor(track: WorkbenchTrack): OscillatorType {
  const hint = `${track.preset || ''} ${track.name || ''}`.toLowerCase();
  if (hint.includes('saw')) return 'sawtooth';
  if (hint.includes('square')) return 'square';
  if (hint.includes('sub') || hint.includes('bass')) return 'sine';
  return 'triangle'; // pad-warm and everything else
}

function midiFreq(pitch: number): number {
  return 440 * Math.pow(2, (pitch - 69) / 12);
}

/** One shared 1-second white-noise buffer per render, built lazily. */
function noiseBuffer(ctx: OfflineAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function drumVoice(ctx: OfflineAudioContext, out: AudioNode, noise: AudioBuffer, pitch: number, t: number, vel: number) {
  if (pitch <= 37) {
    // Kick: sine pitch-drop.
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.11);
    g.gain.setValueAtTime(vel, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + 0.25);
  } else if (pitch <= 41) {
    // Snare: noise burst + body tone.
    const src = ctx.createBufferSource(); src.buffer = noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    src.connect(bp); bp.connect(g); g.connect(out);
    src.start(t); src.stop(t + 0.12);
  } else {
    // Hat (and anything higher): short high-passed noise; open hat (46) rings longer.
    const dur = pitch === 46 ? 0.3 : 0.05;
    const src = ctx.createBufferSource(); src.buffer = noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vel * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp); hp.connect(g); g.connect(out);
    src.start(t); src.stop(t + dur + 0.01);
  }
}

export async function renderWorkbenchProject(
  project: WorkbenchProject,
  clips: WorkbenchClip[],
  notesByClip: Map<string, WorkbenchNote[]>,
  opts: { sampleRate?: number } & WorkbenchRenderDeps = {},
): Promise<WorkbenchRenderResult> {
  const sampleRate = opts.sampleRate ?? 48000;
  const bpm = Number(project.bpm) > 0 ? Number(project.bpm) : DEFAULT_BPM;
  const secPerBeat = 60 / bpm;
  const tracks = project.tracks || [];
  const skipped: RenderSkip[] = [];

  const anySolo = tracks.some((t) => t.solo && !t.muted);
  const activeTracks = tracks.filter((t) => !t.muted && (!anySolo || t.solo));
  const activeIds = new Set(activeTracks.map((t) => t.id));
  const activeClips = clips.filter((c) => activeIds.has(c.trackId) && !c.muted);

  // Classify before allocating: audio clips need a source, note clips
  // need notes. Anything else is accounted as skipped, not silenced.
  interface Job { clip: WorkbenchClip; track: WorkbenchTrack; notes: WorkbenchNote[] }
  const jobs: Job[] = [];
  for (const clip of activeClips) {
    const track = activeTracks.find((t) => t.id === clip.trackId)!;
    const notes = notesByClip.get(clip.id) || [];
    if (clip.kind === 'audio') {
      if (!clip.audioUrl) { skipped.push({ clipName: clip.name || clip.id, reason: 'audio clip has no audio source' }); continue; }
      jobs.push({ clip, track, notes });
    } else if (notes.length > 0) {
      jobs.push({ clip, track, notes });
    } else {
      skipped.push({ clipName: clip.name || clip.id, reason: 'MIDI clip has no notes' });
    }
  }

  if (jobs.length === 0) {
    return { pcm: null, durationSec: 0, renderedClips: 0, skipped, bpm };
  }

  const endBeats = Math.max(...jobs.map((j) => j.clip.startBeats + j.clip.lengthBeats));
  const durationSec = endBeats * secPerBeat + TAIL_SEC;
  const createContext = opts.createContext || defaultCreateContext;
  const fetchAudio = opts.fetchAudio || defaultFetchAudio;
  const ctx = createContext(2, Math.ceil(sampleRate * durationSec), sampleRate);

  let noise: AudioBuffer | null = null;
  let renderedClips = 0;

  for (const { clip, track, notes } of jobs) {
    const gain = ctx.createGain();
    gain.gain.value = Number.isFinite(track.volume) ? Number(track.volume) : 0.8;
    let head: AudioNode = gain;
    if (typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Number.isFinite(track.pan) ? Number(track.pan) : 0;
      gain.connect(panner);
      head = panner;
    }
    head.connect(ctx.destination);

    const clipStartSec = clip.startBeats * secPerBeat;
    const clipWindowSec = clip.lengthBeats * secPerBeat;

    if (clip.kind === 'audio') {
      try {
        const raw = await fetchAudio(String(clip.audioUrl));
        const decoded = await ctx.decodeAudioData(raw);
        const src = ctx.createBufferSource();
        src.buffer = decoded;
        src.connect(gain);
        if (clip.loop && decoded.duration < clipWindowSec) {
          src.loop = true;
          src.start(clipStartSec, 0, clipWindowSec);
        } else {
          src.start(clipStartSec, 0, Math.min(decoded.duration, clipWindowSec));
        }
        renderedClips++;
      } catch {
        skipped.push({ clipName: clip.name || clip.id, reason: 'audio could not be loaded or decoded' });
      }
      continue;
    }

    const isDrum = clip.kind === 'drum' || track.kind === 'drum';
    const wave = waveformFor(track);
    for (const note of notes) {
      const t = clipStartSec + note.startBeats * secPerBeat;
      const dur = Math.max(0.05, note.lengthBeats * secPerBeat);
      const vel = Math.max(0.05, Math.min(1, (note.velocity ?? 96) / 127));
      if (isDrum) {
        if (!noise) noise = noiseBuffer(ctx);
        drumVoice(ctx, gain, noise, note.pitch, t, vel);
      } else {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = wave;
        osc.frequency.value = midiFreq(note.pitch);
        const attack = wave === 'triangle' ? 0.06 : 0.01;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.002, vel * 0.5), t + attack);
        g.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(g); g.connect(gain);
        osc.start(t); osc.stop(t + dur + 0.02);
      }
    }
    renderedClips++;
  }

  if (renderedClips === 0) {
    return { pcm: null, durationSec: 0, renderedClips: 0, skipped, bpm };
  }

  const rendered = await ctx.startRendering();
  const channels = [0, 1].map((i) => rendered.getChannelData(Math.min(i, rendered.numberOfChannels - 1)).slice());
  return { pcm: { channels, sampleRate }, durationSec, renderedClips, skipped, bpm };
}

/** Wrap rendered PCM in an AudioBuffer (for consumers that take one, e.g. the publish dialog). */
export function pcmToAudioBuffer(pcm: { channels: Float32Array[]; sampleRate: number }): AudioBuffer {
  const length = pcm.channels[0]?.length || 0;
  const buffer = new AudioBuffer({ length, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
  pcm.channels.forEach((ch, i) => buffer.copyToChannel(ch as Float32Array<ArrayBuffer>, i));
  return buffer;
}
