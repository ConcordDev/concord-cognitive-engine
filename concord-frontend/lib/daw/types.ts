/**
 * DAW Engine Types — Core type definitions for Concord Studio Lens
 * Covers: sequencer, mixer, piano roll, synths, effects, automation, DTU integration
 */

// ============================================================================
// Transport & Timeline
// ============================================================================

export type TransportState = 'stopped' | 'playing' | 'recording' | 'paused';
export type TimeSignature = [number, number]; // [beats, subdivision]
export type SnapMode = 'off' | '1/1' | '1/2' | '1/4' | '1/8' | '1/16' | '1/32';

export interface TransportConfig {
  bpm: number;
  timeSignature: TimeSignature;
  swing: number; // 0-100
  loopEnabled: boolean;
  loopStart: number; // in beats
  loopEnd: number; // in beats
  metronome: boolean;
  preRoll: number; // bars
}

// ============================================================================
// Tracks & Clips
// ============================================================================

export type TrackType = 'audio' | 'midi' | 'bus' | 'master';
export type ClipType = 'audio' | 'midi' | 'pattern';

export interface DAWTrack {
  id: string;
  name: string;
  type: TrackType;
  color: string;
  volume: number; // dB, -Infinity to +6
  pan: number; // -1 to 1
  mute: boolean;
  solo: boolean;
  armed: boolean;
  frozen: boolean;
  height: number; // px
  instrumentId: string | null;
  effectChain: EffectInstance[];
  sendLevels: Record<string, number>; // busId -> level
  clips: DAWClip[];
  automationLanes: AutomationLane[];
  inputSource: string | null; // for audio recording
  outputTarget: string; // 'master' or bus id
}

export interface DAWClip {
  id: string;
  name: string;
  type: ClipType;
  trackId: string;
  startBeat: number;
  lengthBeats: number;
  offset: number; // internal offset within clip
  color: string;
  looped: boolean;
  loopLength: number;
  fadeIn: number;
  fadeOut: number;
  gain: number; // dB
  pitch: number; // semitones
  reversed: boolean;
  timeStretch: number; // ratio
  midiNotes?: MIDINote[];
  audioBufferId?: string;
  patternId?: string;
}

// ============================================================================
// MIDI / Piano Roll
// ============================================================================

export interface MIDINote {
  id: string;
  pitch: number; // 0-127
  velocity: number; // 0-127
  startBeat: number;
  lengthBeats: number;
  channel: number;
}

export interface MIDIEvent {
  type: 'noteOn' | 'noteOff' | 'cc' | 'pitchBend' | 'aftertouch' | 'programChange';
  time: number;
  note?: number;
  velocity?: number;
  cc?: number;
  value?: number;
  channel: number;
}

export interface PianoRollState {
  clipId: string | null;
  zoomX: number;
  zoomY: number;
  scrollX: number;
  scrollY: number;
  snap: SnapMode;
  tool: 'select' | 'draw' | 'erase' | 'slice' | 'velocity';
  selectedNoteIds: Set<string>;
  ghostClipIds: string[];
  velocityLaneVisible: boolean;
  pitchBendLaneVisible: boolean;
  modWheelLaneVisible: boolean;
}

// ============================================================================
// Mixer
// ============================================================================

export interface MixerChannel {
  trackId: string;
  volume: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  metering: { peakL: number; peakR: number; rmsL: number; rmsR: number };
  inserts: EffectInstance[];
  sends: MixerSend[];
}

export interface MixerSend {
  id: string;
  targetBusId: string;
  level: number; // dB
  preFader: boolean;
  enabled: boolean;
}

export interface MasterBus {
  volume: number;
  inserts: EffectInstance[];
  metering: { peakL: number; peakR: number; rmsL: number; rmsR: number; lufs: number };
}

// ============================================================================
// Synthesizers
// ============================================================================

export type OscillatorShape = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'pulse' | 'pwm' | 'noise';
export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'allpass' | 'lowshelf' | 'highshelf' | 'peaking';
export type SynthType = 'subtractive' | 'fm' | 'sampler' | 'drumMachine' | 'wavetable';

export interface EnvelopeParams {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
}

export interface OscillatorParams {
  shape: OscillatorShape;
  detune: number; // cents
  octave: number; // -3 to +3
  level: number; // 0-1
  phase: number; // degrees
  pulseWidth?: number; // for pulse/pwm
}

export interface FilterParams {
  type: FilterType;
  frequency: number; // Hz
  resonance: number; // Q
  envelope: number; // env amount
  keyTrack: number; // 0-1
}

export interface SynthPreset {
  id: string;
  name: string;
  type: SynthType;
  category: string;
  tags: string[];
  oscillators: OscillatorParams[];
  filter: FilterParams;
  ampEnvelope: EnvelopeParams;
  filterEnvelope: EnvelopeParams;
  lfo: LFOParams[];
  effects: EffectInstance[];
  polyphony: number;
  portamento: number;
  unison: number;
  unisonDetune: number;
  meta?: Record<string, unknown>;
}

export interface LFOParams {
  shape: OscillatorShape;
  rate: number; // Hz or synced ratio
  depth: number; // 0-1
  target: string; // parameter path
  sync: boolean;
}

// ============================================================================
// Sampler
// ============================================================================

export interface SamplerZone {
  id: string;
  audioBufferId: string;
  rootNote: number; // MIDI note
  lowNote: number;
  highNote: number;
  lowVelocity: number;
  highVelocity: number;
  loopStart: number;
  loopEnd: number;
  loopEnabled: boolean;
  reverse: boolean;
  tuning: number; // cents
  volume: number; // dB
  pan: number;
  envelope: EnvelopeParams;
}

export interface SamplerPreset {
  id: string;
  name: string;
  zones: SamplerZone[];
  globalEnvelope: EnvelopeParams;
  globalFilter: FilterParams;
  polyphony: number;
}

// ============================================================================
// Drum Machine
// ============================================================================

export interface DrumPad {
  id: string;
  name: string;
  audioBufferId: string | null;
  synthPresetId: string | null;
  volume: number;
  pan: number;
  pitch: number;
  mute: boolean;
  solo: boolean;
  chokeGroup: number | null;
  effects: EffectInstance[];
  color: string;
}

export interface DrumPattern {
  id: string;
  name: string;
  steps: number; // 16, 32, 64
  resolution: number; // beats per step
  tracks: DrumPatternTrack[];
}

export interface DrumPatternTrack {
  padId: string;
  steps: DrumStep[];
}

export interface DrumStep {
  active: boolean;
  velocity: number;
  probability: number; // 0-1
  flam: boolean;
}

// ============================================================================
// Effects
// ============================================================================

export type EffectType =
  | 'eq3' | 'eq8' | 'parametricEQ'
  | 'compressor' | 'multibandCompressor' | 'limiter' | 'gate' | 'deesser'
  | 'reverb' | 'convolutionReverb'
  | 'delay' | 'pingPongDelay'
  | 'distortion' | 'overdrive' | 'bitcrusher' | 'waveshaper'
  | 'chorus' | 'phaser' | 'flanger' | 'tremolo' | 'vibrato'
  | 'filter' | 'autoFilter' | 'autoWah'
  | 'stereoWidener' | 'pan'
  | 'pitchShift' | 'frequencyShifter';

export interface EffectInstance {
  id: string;
  type: EffectType;
  name: string;
  enabled: boolean;
  wet: number; // 0-1
  params: Record<string, number | string | boolean>;
}

export interface EffectPreset {
  id: string;
  name: string;
  type: EffectType;
  category: string;
  params: Record<string, number | string | boolean>;
  wet: number;
}

// ============================================================================
// Automation
// ============================================================================

export type AutomationCurve = 'linear' | 'exponential' | 'logarithmic' | 'step';

export interface AutomationLane {
  id: string;
  parameterPath: string; // e.g. 'volume', 'effects[0].params.frequency'
  parameterName: string;
  points: AutomationPoint[];
  visible: boolean;
  color: string;
  min: number;
  max: number;
}

export interface AutomationPoint {
  id: string;
  beat: number;
  value: number; // normalized 0-1
  curve: AutomationCurve;
}

// ============================================================================
// Audio Recording & Editing
// ============================================================================

export interface AudioBuffer {
  id: string;
  name: string;
  sampleRate: number;
  duration: number;
  channels: number;
  bpm?: number;
  key?: string;
  waveformPeaks: number[]; // downsampled for display
  spectralProfile?: SpectralProfile;
}

export interface SpectralProfile {
  bands: number[];
  centroid: number;
  brightness: number;
  warmth: number;
}

export interface AudioEditOperation {
  type: 'cut' | 'copy' | 'paste' | 'delete' | 'fadeIn' | 'fadeOut' | 'normalize' | 'reverse' | 'timeStretch' | 'pitchShift' | 'gain';
  startSample?: number;
  endSample?: number;
  params?: Record<string, number>;
}

// ============================================================================
// Mastering
// ============================================================================

export interface MasteringChain {
  eq: EffectInstance;
  multibandCompressor: EffectInstance;
  stereoWidener: EffectInstance;
  limiter: EffectInstance;
  loudnessTarget: number; // LUFS
  enabled: boolean;
}

export interface MasteringAnalysis {
  integratedLUFS: number;
  shortTermLUFS: number;
  momentaryLUFS: number;
  truePeak: number;
  dynamicRange: number;
  stereoCorrelation: number;
  spectralBalance: number[];
}

export interface ExportSettings {
  format: 'wav' | 'mp3' | 'flac' | 'ogg';
  sampleRate: 44100 | 48000 | 88200 | 96000;
  bitDepth: 16 | 24 | 32;
  normalize: boolean;
  dithering: boolean;
  stems: boolean;
  startBeat: number;
  endBeat: number;
}

// ============================================================================
// DTU Integration
// ============================================================================

export type StudioDTUType = 'audio' | 'instrument' | 'process' | 'session' | 'effect' | 'pattern';

export interface AudioDTU {
  type: 'audio';
  audioBufferId: string;
  waveformCharacteristics: SpectralProfile;
  bpm?: number;
  key?: string;
  timbreTags: string[];
  duration: number;
  sampleRate: number;
}

export interface InstrumentDTU {
  type: 'instrument';
  synthType: SynthType;
  preset: SynthPreset;
  category: string;
  timbreTags: string[];
}

export interface ProcessDTU {
  type: 'process';
  processType: 'mixChain' | 'masterChain' | 'arrangementPattern' | 'effectChain';
  chain: EffectInstance[];
  description: string;
  genre?: string;
}

export interface SessionDTU {
  type: 'session';
  projectState: DAWProject;
  snapshotAt: number;
  parentSessionId?: string;
  changeDescription: string;
}

export interface EffectDTU {
  type: 'effect';
  preset: EffectPreset;
  genre?: string;
  useCase?: string;
}

export interface PatternDTU {
  type: 'pattern';
  pattern: DrumPattern;
  bpm: number;
  genre: string;
}

// ============================================================================
// Project (Top-level)
// ============================================================================

export interface DAWProject {
  id: string;
  title: string;
  bpm: number;
  key: string;
  scale: string;
  timeSignature: TimeSignature;
  genre: string | null;
  tracks: DAWTrack[];
  masterBus: MasterBus;
  masteringChain: MasteringChain;
  arrangement: ArrangementState;
  transport: TransportConfig;
  audioBuffers: Record<string, AudioBuffer>;
  synthPresets: Record<string, SynthPreset>;
  drumPatterns: Record<string, DrumPattern>;
  createdAt: number;
  updatedAt: number;
  sessionDTUIds: string[];
}

export interface ArrangementState {
  lengthBars: number;
  sections: ArrangementSection[];
  markers: ArrangementMarker[];
  tempo: TempoAutomation[];
}

export interface ArrangementSection {
  id: string;
  name: string;
  startBar: number;
  endBar: number;
  color: string;
}

export interface ArrangementMarker {
  id: string;
  name: string;
  bar: number;
  color: string;
}

export interface TempoAutomation {
  bar: number;
  bpm: number;
  curve: AutomationCurve;
}

// ============================================================================
// Studio View State
// ============================================================================

export type StudioViewType =
  | 'session'      // Default clip-grid hero (browser left + inspector right + mixer peek)
  | 'arrange'
  | 'mixer'
  | 'pianoRoll'
  | 'drumMachine'
  | 'sampler'
  | 'audioEditor'
  | 'automation'
  | 'mastering'
  | 'soundboard'
  | 'instruments'
  | 'effects'
  | 'aiAssistant'
  | 'learn';

export interface StudioState {
  viewType: StudioViewType;
  project: DAWProject | null;
  transport: TransportState;
  playheadBeat: number;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  pianoRoll: PianoRollState;
  zoomLevel: number;
  scrollPosition: { x: number; y: number };
}
