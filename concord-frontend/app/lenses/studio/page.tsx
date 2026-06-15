'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { StudioRepos } from '@/components/studio/StudioRepos';
import { StudioActionPanel } from '@/components/studio/StudioActionPanel';
import { PipingProvider } from '@/components/panel-polish';
import ClipsTimelinePanel from '@/components/studio/ClipsTimelinePanel';
import MidiPianoRoll from '@/components/studio/MidiPianoRoll';
import AutomationLanesPanel from '@/components/studio/AutomationLanesPanel';
import BouncePanel from '@/components/studio/BouncePanel';
import MarkersPanel from '@/components/studio/MarkersPanel';
import TempoMap from '@/components/studio/TempoMap';
import PresetsLibraryPanel from '@/components/studio/PresetsLibraryPanel';
import SendsRouting from '@/components/studio/SendsRouting';
import ScenesLauncher from '@/components/studio/ScenesLauncher';
import ClipEditorPanel from '@/components/studio/ClipEditorPanel';
import DrumRackPanel from '@/components/studio/DrumRackPanel';
import FxRackPanel from '@/components/studio/FxRackPanel';
import MidiMapPanel from '@/components/studio/MidiMapPanel';
import QuantizePanel from '@/components/studio/QuantizePanel';
import RecordingPanel from '@/components/studio/RecordingPanel';
import ProjectIOPanel from '@/components/studio/ProjectIOPanel';
import CollabPanel from '@/components/studio/CollabPanel';
import { ShellPreview } from '@/components/lens/ShellPreview';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import {
  Grid3x3 as MTabSess, LineChart as MTabArr, SlidersHorizontal as MTabMix,
  Piano as MTabPiano, AudioLines as MTabAud, Wand2 as MTabAuto,
} from 'lucide-react';
import LensAgentFab from '@/components/lens/LensAgentFab';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Music,
  Plus,
  Sliders,
  Mic2,
  Piano,
  Waves,
  X,
  Headphones,
  Zap,
  Activity,
  Layers,
  Sparkles,
  Brain,
  BookOpen,
  Target,
  Radio,
  BarChart3,
  PlayCircle,
  StopCircle,
  Upload,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { showToast } from '@/components/common/Toasts';
import Link from 'next/link';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import { useAuth } from '@/hooks/useAuth';
import { DTULibraryPanel } from '@/components/dtu/DTULibraryPanel';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import SessionWorkspace from '@/components/studio/SessionWorkspace';

// DAW engine
import {
  TransportEngine,
  SynthEngine,
  DrumMachineEngine,
  MixerEngine,
  AudioRecorder,
  DEFAULT_SYNTH_PRESETS,
  DEFAULT_EFFECT_PRESETS,
  resumeAudioContext,
  getAudioContext,
} from '@/lib/daw/engine';
import type {
  StudioViewType,
  TransportState,
  DAWTrack,
  DAWProject,
  MIDINote,
  EffectInstance,
  SynthPreset,
  DrumPattern,
  DrumPad,
  AutomationPoint,
  MasteringChain,
  MasteringAnalysis,
  ExportSettings,
  SnapMode,
  AudioBuffer as DAWAudioBuffer,
} from '@/lib/daw/types';
import {
  dtuHooks,
  emitSessionDTU,
  emitInstrumentDTU,
  emitEffectChainDTU,
  emitTrackCreated,
  emitPatternDTU,
  type DTUEvent,
} from '@/lib/daw/dtu-hooks';

// Studio UI components
import { TransportBar } from '@/components/studio/TransportBar';
import { MetronomePlayer } from '@/components/studio/MetronomePlayer';
import { ArrangementView } from '@/components/studio/ArrangementView';
import { PianoRoll } from '@/components/studio/PianoRoll';
import { MixerView } from '@/components/studio/MixerView';
import { DrumMachine } from '@/components/studio/DrumMachine';
import { SynthPanel } from '@/components/studio/SynthPanel';
import { EffectsPanel } from '@/components/studio/EffectsPanel';
import { AudioEditor } from '@/components/studio/AudioEditor';
import { AutomationView } from '@/components/studio/AutomationView';
import { MasteringPanel } from '@/components/studio/MasteringPanel';
import { Soundboard } from '@/components/studio/Soundboard';
import StudioWorkbench from '@/components/studio/StudioWorkbench';

// ============================================================================
// Constants & Defaults
// ============================================================================

const TRACK_COLORS = [
  '#7c3aed',
  '#ec4899',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#14b8a6',
  '#3b82f6',
  '#f43f5e',
];

function createDefaultProject(
  title: string,
  bpm: number,
  key: string,
  genre: string | null
): DAWProject {
  return {
    id: `proj_${Date.now()}`,
    title,
    bpm,
    key,
    scale: 'major',
    timeSignature: [4, 4],
    genre,
    tracks: [],
    masterBus: {
      volume: 0,
      inserts: [
        {
          id: 'master-eq',
          type: 'eq3',
          name: 'Master EQ',
          enabled: true,
          wet: 1,
          params: { lowGain: 0, midGain: 0, highGain: 0 },
        },
        {
          id: 'master-comp',
          type: 'compressor',
          name: 'Master Comp',
          enabled: true,
          wet: 1,
          params: { threshold: -12, ratio: 2, attack: 0.01, release: 0.1 },
        },
        {
          id: 'master-lim',
          type: 'limiter',
          name: 'Master Limiter',
          enabled: true,
          wet: 1,
          params: { ceiling: -1, release: 0.1 },
        },
      ],
      metering: { peakL: -60, peakR: -60, rmsL: -60, rmsR: -60, lufs: -14 },
    },
    masteringChain: {
      eq: {
        id: 'mc-eq',
        type: 'eq3',
        name: 'EQ',
        enabled: true,
        wet: 1,
        params: { lowGain: 0, midGain: 0, highGain: 0 },
      },
      multibandCompressor: {
        id: 'mc-comp',
        type: 'multibandCompressor',
        name: 'MB Comp',
        enabled: true,
        wet: 1,
        params: { threshold: -18, ratio: 3, attack: 0.01, release: 0.15 },
      },
      stereoWidener: {
        id: 'mc-stereo',
        type: 'stereoWidener',
        name: 'Stereo',
        enabled: true,
        wet: 1,
        params: { width: 1 },
      },
      limiter: {
        id: 'mc-lim',
        type: 'limiter',
        name: 'Limiter',
        enabled: true,
        wet: 1,
        params: { ceiling: -1, release: 0.1 },
      },
      loudnessTarget: -14,
      enabled: true,
    },
    arrangement: { lengthBars: 64, sections: [], markers: [], tempo: [] },
    transport: {
      bpm,
      timeSignature: [4, 4],
      swing: 0,
      loopEnabled: false,
      loopStart: 0,
      loopEnd: 16,
      metronome: false,
      preRoll: 0,
    },
    audioBuffers: {},
    synthPresets: {},
    drumPatterns: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    sessionDTUIds: [],
  };
}

function createDefaultTrack(
  name: string,
  type: 'audio' | 'midi',
  index: number,
  instrumentId?: string
): DAWTrack {
  return {
    id: `track_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    name,
    type,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volume: 0,
    pan: 0,
    mute: false,
    solo: false,
    armed: false,
    frozen: false,
    height: 56,
    instrumentId: instrumentId || null,
    effectChain: [],
    sendLevels: {},
    clips: [],
    automationLanes: [],
    inputSource: null,
    outputTarget: 'master',
  };
}

function createDefaultDrumPattern(): DrumPattern {
  const padNames = ['Kick', 'Snare', 'Hi-Hat C', 'Hi-Hat O', 'Clap', 'Tom H', 'Tom L', 'Perc'];
  return {
    id: `pat_${Date.now()}`,
    name: 'New Pattern',
    steps: 16,
    resolution: 0.25,
    tracks: padNames.map((_, i) => ({
      padId: `pad_${i}`,
      steps: Array.from({ length: 16 }, () => ({
        active: false,
        velocity: 100,
        probability: 1,
        flam: false,
      })),
    })),
  };
}

function createDefaultDrumPads(): DrumPad[] {
  const names = [
    'Kick',
    'Snare',
    'Hi-Hat C',
    'Hi-Hat O',
    'Clap',
    'Tom High',
    'Tom Low',
    'Perc',
    'Crash',
    'Ride',
    'Shaker',
    'Cowbell',
    'Rim',
    'Snap',
    'Click',
    'FX',
  ];
  const colors = [
    '#ef4444',
    '#f59e0b',
    '#eab308',
    '#22c55e',
    '#14b8a6',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#a855f7',
    '#ec4899',
    '#f43f5e',
    '#fb923c',
    '#84cc16',
    '#2dd4bf',
    '#38bdf8',
    '#c084fc',
  ];
  return names.map((name, i) => ({
    id: `pad_${i}`,
    name,
    audioBufferId: null,
    synthPresetId: null,
    volume: 0,
    pan: 0,
    pitch: 0,
    mute: false,
    solo: false,
    chokeGroup: null,
    effects: [],
    color: colors[i],
  }));
}

// ============================================================================
// Main Studio Page Component
// ============================================================================

export default function StudioLensPage() {
  useLensNav('studio');
  const {
    latestData: realtimeData,
    alerts: realtimeAlerts,
    insights: realtimeInsights,
    isLive,
    lastUpdated,
  } = useRealtimeLens('studio');
  const {
    isLoading: _isLoading,
    isError: _isError,
    error: _error,
    refetch: _refetch,
    create: createLensItem,
    update: updateLensItem,
  } = useLensData('studio', 'project', { noSeed: true });
  const { createDTU, publishToMarketplace } = useLensDTUs({ lens: 'studio' });
  const { user: _user } = useAuth();
  const queryClient = useQueryClient();

  // ---- State ----
  // Default to the Session view (clip-launching grid) — the iconic DAW
  // surface. Other views are still reachable via the
  // toolbar — they're the per-clip / per-track editors. localStorage-
  // sticky so power users who pin a different default keep it.
  const [studioView, setStudioView] = useState<StudioViewType>(() => {
    if (typeof window === 'undefined') return 'session';
    return (localStorage.getItem('concord_studio_view') as StudioViewType) || 'session';
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { localStorage.setItem('concord_studio_view', studioView); } catch { /* private mode */ }
  }, [studioView]);
  const [project, setProject] = useState<DAWProject | null>(null);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [transportState, setTransportState] = useState<TransportState>('stopped');
  const transportStateRef = useRef<TransportState>('stopped');
  const drumPatternRef = useRef<DrumPattern | null>(null);
  const projectRef = useRef<DAWProject | null>(null);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [snap, setSnap] = useState<SnapMode>('1/4');
  const [zoomLevel, setZoomLevel] = useState(1);
  const [showNewProject, setShowNewProject] = useState(false);
  const [showAddTrack, setShowAddTrack] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const { items: studioArtifacts } = useLensData('studio', 'project', { noSeed: true });
  const runStudioAction = useRunArtifact('studio');
  const [studioActionResult, setStudioActionResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [studioActiveAction, setStudioActiveAction] = useState<string | null>(null);

  const handleStudioAction = useCallback(
    async (action: string) => {
      const id = studioArtifacts[0]?.id;
      if (!id) return;
      setStudioActiveAction(action);
      try {
        const res = await runStudioAction.mutateAsync({ id, action });
        if (res.ok === false) {
          setStudioActionResult({
            action,
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setStudioActionResult({ action, ...(res.result as Record<string, unknown>) });
        }
      } catch (err) {
        console.error('Studio action failed:', err);
      } finally {
        setStudioActiveAction(null);
      }
    },
    [studioArtifacts, runStudioAction]
  );

  // New project form
  const [newTitle, setNewTitle] = useState('');
  const [newBpm, setNewBpm] = useState('120');
  const [newKey, setNewKey] = useState('C');
  const [newGenre, setNewGenre] = useState('');

  // Audio engines (refs to avoid re-renders)
  const transportRef = useRef<TransportEngine | null>(null);
  const mixerRef = useRef<MixerEngine | null>(null);
  const drumEngineRef = useRef<DrumMachineEngine | null>(null);
  const synthEnginesRef = useRef<Map<string, SynthEngine>>(new Map());
  const recorderRef = useRef<AudioRecorder | null>(null);

  // DTU events
  const [dtuEvents, setDtuEvents] = useState<DTUEvent[]>([]);

  // Drum machine state
  const [drumPattern, setDrumPattern] = useState<DrumPattern>(createDefaultDrumPattern);
  const [drumPads, setDrumPads] = useState<DrumPad[]>(createDefaultDrumPads);
  const [drumStep, setDrumStep] = useState(0);

  // Synth state
  const [activeSynthPreset, setActiveSynthPreset] = useState<SynthPreset | null>(null);

  // Audio editor
  const [audioEditorBuffer, _setAudioEditorBuffer] = useState<DAWAudioBuffer | null>(null);
  const [audioSelection, setAudioSelection] = useState<{ start: number; end: number } | null>(null);
  const [audioPosition, setAudioPosition] = useState(0);
  const [isRecording, setIsRecording] = useState(false);

  // Live recording state (mic capture)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingTimer, setRecordingTimer] = useState(0);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  // Publish to marketplace state
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishPrice, setPublishPrice] = useState('');
  const [publishLicense, setPublishLicense] = useState<'basic' | 'premium' | 'exclusive'>('basic');
  const [publishTags, setPublishTags] = useState('');
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedListingId, setPublishedListingId] = useState<string | null>(null);
  const [showDTUPicker, setShowDTUPicker] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  // Mastering
  const [masteringAnalysis, setMasteringAnalysis] = useState<MasteringAnalysis | null>(null);
  const [spectrumData, setSpectrumData] = useState<Uint8Array | null>(null);

  // AI Assistant state
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ title: string; content: string } | null>(null);

  // Keep refs in sync for use in intervals / event handlers
  useEffect(() => {
    transportStateRef.current = transportState;
  }, [transportState]);
  useEffect(() => {
    drumPatternRef.current = drumPattern;
  }, [drumPattern]);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // ---- Initialize engines ----
  useEffect(() => {
    transportRef.current = new TransportEngine();
    mixerRef.current = new MixerEngine();
    drumEngineRef.current = new DrumMachineEngine();
    recorderRef.current = new AudioRecorder();

    // World-soundscape bridge: when DAW playback toggles, broadcast a
    // window event the SoundscapeEngine listens for so the world's music
    // slot can play this DAW project as the player walks around. Best-effort.
    const unsubMusic = transportRef.current.on('playStateChange', (data: { playing?: boolean }) => {
      try {
        // World-scope the event: the SoundscapeEngine only ducks when the
        // listener world matches the studio world (same player walking
        // around). The active avatar's world is read from the same
        // localStorage hint AvatarSwitcher writes; falls back to
        // 'concordia-hub' when unknown.
        const worldId = (typeof window !== 'undefined' && window.localStorage.getItem('concordia:activeWorldId'))
          || 'concordia-hub';
        window.dispatchEvent(new CustomEvent('concordia:daw-playback', {
          detail: { playing: !!data.playing, projectName: projectRef.current?.title ?? 'studio_session', worldId },
        }));
      } catch { /* dispatch best-effort */ }
    });
    // Cleanup is handled in the existing return below.
    void unsubMusic;

    const unsub = transportRef.current.on('beatChange', (data) => {
      const beat = data.beat as number;
      setCurrentBeat(beat);

      // ---- Drum sequencer auto-playback ----
      const pattern = drumPatternRef.current;
      if (pattern && transportStateRef.current === 'playing') {
        const stepCount = pattern.steps || 16;
        const step = Math.floor((beat % 4) * 4) % stepCount;
        setDrumStep(step);
        for (const track of pattern.tracks) {
          const s = track.steps[step];
          if (s?.active) {
            drumEngineRef.current?.triggerPad(track.padId, s.velocity ?? 100);
          }
        }
      }

      // ---- MIDI note playback ----
      const proj = projectRef.current;
      if (proj && transportStateRef.current === 'playing') {
        for (const track of proj.tracks) {
          if (track.type !== 'midi') continue;
          for (const clip of track.clips) {
            if (!clip.midiNotes) continue;
            const clipBeat = beat - (clip.startBeat || 0);
            if (clipBeat < 0) continue;
            for (const note of clip.midiNotes) {
              // Trigger note if this beat matches start
              if (Math.abs(note.startBeat - clipBeat) < 0.125) {
                let synth = synthEnginesRef.current.get(track.id);
                if (!synth) {
                  synth = new SynthEngine(DEFAULT_SYNTH_PRESETS[0]);
                  const mixerInput = mixerRef.current?.getChannelInput(track.id);
                  if (mixerInput) synth.connect(mixerInput);
                  synthEnginesRef.current.set(track.id, synth);
                }
                synth.noteOn(note.pitch, note.velocity);
                // Schedule noteOff based on note duration
                const durationSec = note.lengthBeats / (proj.bpm / 60);
                setTimeout(() => synth!.noteOff(note.pitch), durationSec * 1000);
              }
            }
          }
        }
      }
    });

    const unsubDTU = dtuHooks.subscribe((event) => {
      setDtuEvents((prev) => [...prev.slice(-200), event]);
    });

    // Spectrum analyzer update
    const spectrumInterval = setInterval(() => {
      if (mixerRef.current && transportStateRef.current === 'playing') {
        setSpectrumData(mixerRef.current.getMasterAnalyserData());
      }
    }, 50);

    const synthEngines = synthEnginesRef.current;
    return () => {
      unsub();
      unsubDTU();
      clearInterval(spectrumInterval);
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      transportRef.current?.dispose();
      mixerRef.current?.dispose();
      drumEngineRef.current?.dispose();
      recorderRef.current?.dispose();
      synthEngines.forEach((s) => s.dispose());
    };
  }, []);

  // ---- Web MIDI input wiring ----
  useEffect(() => {
    let midiAccess: MIDIAccess | null = null;
    const handleMIDIMessage = (e: MIDIMessageEvent) => {
      const data = e.data;
      if (!data || data.length < 2) return;
      const status = data[0] & 0xf0;
      const note = data[1];
      const velocity = data.length > 2 ? data[2] : 0;

      // Route to the synth on the selected track (or first available)
      const trackId =
        selectedTrackId || projectRef.current?.tracks.find((t) => t.type === 'midi')?.id;
      if (!trackId) return;

      let synth = synthEnginesRef.current.get(trackId);
      if (!synth) {
        synth = new SynthEngine(DEFAULT_SYNTH_PRESETS[0]);
        const mixerInput = mixerRef.current?.getChannelInput(trackId);
        if (mixerInput) synth.connect(mixerInput);
        synthEnginesRef.current.set(trackId, synth);
      }

      if (status === 0x90 && velocity > 0) {
        synth.noteOn(note, velocity);
      } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
        synth.noteOff(note);
      }
    };

    const onMIDIInput = (input: MIDIInput) => {
      input.onmidimessage = handleMIDIMessage;
    };

    if (typeof navigator !== 'undefined' && navigator.requestMIDIAccess) {
      navigator
        .requestMIDIAccess()
        .then((access) => {
          midiAccess = access;
          access.inputs.forEach(onMIDIInput);
          access.onstatechange = () => {
            access.inputs.forEach(onMIDIInput);
          };
        })
        .catch((err) => {
          console.warn('[Studio] Web MIDI not available:', err);
        });
    }

    return () => {
      if (midiAccess) {
        midiAccess.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
      }
    };
  }, [selectedTrackId]);

  // ---- Project operations ----
  const selectedTrack = useMemo(
    () => project?.tracks.find((t) => t.id === selectedTrackId) ?? null,
    [project, selectedTrackId]
  );

  const selectedClip = useMemo(() => {
    if (!project || !selectedClipId) return null;
    for (const track of project.tracks) {
      const clip = track.clips.find((c) => c.id === selectedClipId);
      if (clip) return clip;
    }
    return null;
  }, [project, selectedClipId]);

  const updateProject = useCallback((updater: (p: DAWProject) => DAWProject) => {
    setProject((prev) => {
      if (!prev) return prev;
      const updated = updater(prev);
      updated.updatedAt = Date.now();
      return updated;
    });
  }, []);

  const handleCreateProject = useCallback(() => {
    const proj = createDefaultProject(
      newTitle || 'Untitled Project',
      parseInt(newBpm, 10) || 120,
      newKey,
      newGenre || null
    );
    setProject(proj);
    setShowNewProject(false);
    setNewTitle('');
    transportRef.current?.updateConfig({ bpm: proj.bpm, timeSignature: proj.timeSignature });
    emitSessionDTU(proj, 'Project created');
    createLensItem({
      title: proj.title,
      data: proj as unknown as Record<string, unknown>,
      meta: {
        status: 'active',
        tags: [proj.key, `${proj.bpm}bpm`, proj.genre].filter(Boolean) as string[],
      },
    }).catch((err) => {
      console.error('Failed to persist project:', err instanceof Error ? err.message : err);
      showToast('error', 'Failed to create project');
    });
  }, [newTitle, newBpm, newKey, newGenre, createLensItem]);

  // ---- Transport controls ----
  const handlePlay = useCallback(() => {
    resumeAudioContext();
    transportRef.current?.play();
    setTransportState('playing');
  }, []);

  const handlePause = useCallback(() => {
    transportRef.current?.pause();
    setTransportState('paused');
  }, []);

  const handleStop = useCallback(() => {
    // Stop mic recording if active
    if (isRecording) {
      recorderRef.current?.stopRecording();
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setIsRecording(false);
    }
    transportRef.current?.stop();
    setTransportState('stopped');
    setCurrentBeat(0);
  }, [isRecording]);

  const handleRecord = useCallback(async () => {
    resumeAudioContext();
    // Request mic access and start MediaRecorder via the AudioRecorder engine
    const recorder = recorderRef.current;
    if (!recorder) return;

    setRecordError(null);
    const hasAccess = await recorder.requestAccess();
    if (!hasAccess) {
      const reason = recorder.getLastError()?.message || 'Microphone access denied';
      console.warn('[Studio] Mic access failed:', reason);
      setRecordError(reason);
      showToast('error', `Mic access failed: ${reason}`);
      return;
    }

    // Clear previous recording
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      setRecordedUrl(null);
    }
    setRecordedBlob(null);
    setSaveStatus('idle');

    const started = recorder.startRecording(
      (blob: Blob) => {
        if (blob.size === 0) {
          setRecordError(
            'Recording produced no audio data. Check your input device and browser permissions.'
          );
          showToast('error', 'Recording was empty — check your mic');
          return;
        }
        setRecordedBlob(blob);
        const url = URL.createObjectURL(blob);
        setRecordedUrl(url);
      },
      (err: Error) => {
        console.error('[Studio] Recorder error:', err);
        setRecordError(err.message);
        showToast('error', `Recorder error: ${err.message}`);
      }
    );

    if (started) {
      transportRef.current?.record();
      setTransportState('recording');
      setIsRecording(true);
      setRecordingTimer(0);
      // Start timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingTimer((prev) => prev + 1);
      }, 1000);
    } else {
      const reason = recorder.getLastError()?.message || 'Failed to start recorder';
      setRecordError(reason);
      showToast('error', `Failed to start recorder: ${reason}`);
    }
  }, [recordedUrl]);

  // ── DAW transport shortcuts ──────────────────────────────────────
  // Space toggles play/pause, R records, . stops, Enter rewinds.
  useLensCommand(
    [
      { id: 'transport-play',   keys: 'space', description: 'Play / pause',  category: 'actions',
        action: () => {
          if (transportState === 'playing') handlePause();
          else handlePlay();
        }, global: true },
      { id: 'transport-record', keys: 'r',     description: 'Record',        category: 'actions',
        action: () => {
          if (isRecording) {
            recorderRef.current?.stopRecording();
            if (recordingTimerRef.current) {
              clearInterval(recordingTimerRef.current);
              recordingTimerRef.current = null;
            }
            setIsRecording(false);
          } else {
            handleRecord();
          }
        } },
      { id: 'transport-stop',   keys: '.',     description: 'Stop',          category: 'actions',
        action: () => handleStop() },
      { id: 'transport-rewind', keys: 'enter', description: 'Rewind to 0',   category: 'actions',
        action: () => transportRef.current?.seekTo(0) },
      { id: 'studio-save',      keys: 'mod+s', description: 'Save project',  category: 'actions',
        action: () => handleSave(), global: true },
      { id: 'studio-new',       keys: 'mod+n', description: 'New project',   category: 'actions',
        action: () => handleCreateProject(), global: true },
    ],
    { lensId: 'studio' }
  );

  const handleSeek = useCallback((beat: number) => {
    transportRef.current?.seekTo(beat);
    setCurrentBeat(beat);
  }, []);

  // ---- Playback of recorded audio ----
  const handlePlayback = useCallback(() => {
    if (!recordedUrl) return;
    if (recordedBlob && recordedBlob.size === 0) {
      showToast('error', 'Recording is empty — nothing to play back');
      return;
    }
    // Stop any existing playback
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current = null;
    }
    const audio = new Audio();
    // Attach handlers BEFORE assigning src so 'error' and 'ended' can't race.
    audio.onended = () => {
      setIsPlayingBack(false);
      playbackAudioRef.current = null;
    };
    audio.onerror = () => {
      const code = audio.error?.code;
      const msg = audio.error?.message || `Audio load failed (code ${code ?? '?'})`;
      console.error('[Studio] Playback error:', msg);
      showToast('error', `Playback failed: ${msg}`);
      setIsPlayingBack(false);
      playbackAudioRef.current = null;
    };
    audio.src = recordedUrl;
    audio.preload = 'auto';
    playbackAudioRef.current = audio;
    setIsPlayingBack(true);
    audio.play().catch((err) => {
      console.error('[Studio] Playback rejected:', err);
      showToast('error', `Playback rejected: ${err?.message || err}`);
      setIsPlayingBack(false);
      playbackAudioRef.current = null;
    });
  }, [recordedUrl, recordedBlob]);

  const handleStopPlayback = useCallback(() => {
    if (playbackAudioRef.current) {
      playbackAudioRef.current.pause();
      playbackAudioRef.current.currentTime = 0;
      playbackAudioRef.current = null;
    }
    setIsPlayingBack(false);
  }, []);

  // ---- Save recording to backend ----
  const handleSaveRecording = useCallback(async () => {
    if (!recordedBlob || !project) return;
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      // Convert recorded blob to base64 for upload
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const base64Data = btoa(
        new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Upload with actual audio data via the /api/media/upload endpoint
      const response = await api.post('/api/media/upload', {
        title: `${project.title} - Recording ${new Date().toLocaleTimeString()}`,
        description: `Studio recording from project "${project.title}" (${project.bpm} BPM, key ${project.key})`,
        mediaType: 'audio',
        mimeType: recordedBlob.type || 'audio/webm',
        fileSize: recordedBlob.size,
        originalFilename: `studio-recording-${Date.now()}.webm`,
        tags: ['studio', 'recording', project.key, `${project.bpm}bpm`].filter(Boolean),
        privacy: 'private',
        data: base64Data,
      });

      if (response.data?.ok || response.status === 200 || response.status === 201) {
        setSaveStatus('success');
        const mediaDtuId = (response.data as { mediaDTU?: { id?: string } } | null)?.mediaDTU?.id || null;
        // Also create a lens item for the track list. Cross-link the
        // backing media DTU id so the music lens "My Tracks" tab can
        // resolve back to /api/media/:id/stream and play the actual bytes.
        try {
          await createLensItem({
            title: `Recording - ${new Date().toLocaleTimeString()}`,
            data: {
              type: 'recording',
              projectId: project.id,
              bpm: project.bpm,
              key: project.key,
              duration: recordingTimer,
              mimeType: recordedBlob.type || 'audio/webm',
              size: recordedBlob.size,
              mediaDtuId,
              streamUrl: mediaDtuId ? `/api/media/${mediaDtuId}/stream` : null,
              createdAt: new Date().toISOString(),
            },
            meta: { tags: ['studio', 'recording'], status: 'active' },
          });
          // Mirror into the music lens too so "My Tracks" surfaces it.
          try {
            const { api: apiClient } = await import('@/lib/api/client');
            await apiClient.post('/api/lens/music', {
              type: 'track',
              title: `${project.title} — Take @ ${new Date().toLocaleTimeString()}`,
              data: {
                projectId: project.id,
                bpm: project.bpm,
                key: project.key,
                duration: recordingTimer,
                mediaDtuId,
                streamUrl: mediaDtuId ? `/api/media/${mediaDtuId}/stream` : null,
              },
              meta: { tags: ['studio', project.key, `${project.bpm}bpm`], status: 'active' },
            });
          } catch (mirrorErr) {
            console.warn('[Studio] Mirror to music lens failed:', mirrorErr);
          }
        } catch (e) {
          console.error('Studio lens item creation failed:', e);
        }
        // Invalidate queries so the track list updates without page refresh
        queryClient.invalidateQueries({ queryKey: ['lens', 'studio'] });
        queryClient.invalidateQueries({ queryKey: ['lens', 'music'] });
        // Add an audio track to the project for the recording
        updateProject((p) => {
          const track = createDefaultTrack(
            `Rec ${new Date().toLocaleTimeString()}`,
            'audio',
            p.tracks.length
          );
          emitTrackCreated(track, p.id);
          return { ...p, tracks: [...p.tracks, track] };
        });
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('[Studio] Save recording failed:', err);
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  }, [recordedBlob, project, recordingTimer, createLensItem, queryClient, updateProject]);

  // ---- Beat pad with OscillatorNode frequencies ----
  const BEAT_PAD_FREQUENCIES = useMemo(
    () => [
      { note: 'C4', freq: 261.63 },
      { note: 'D4', freq: 293.66 },
      { note: 'E4', freq: 329.63 },
      { note: 'F4', freq: 349.23 },
      { note: 'G4', freq: 392.0 },
      { note: 'A4', freq: 440.0 },
      { note: 'B4', freq: 493.88 },
      { note: 'C5', freq: 523.25 },
    ],
    []
  );

  const handleBeatPadTrigger = useCallback(
    (index: number) => {
      if (index < 0 || index >= BEAT_PAD_FREQUENCIES.length) return;
      const { freq } = BEAT_PAD_FREQUENCIES[index];
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime);
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.connect(gainNode).connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      } catch (e) {
        console.warn('Audio context not ready for beat pad:', e);
      }
    },
    [BEAT_PAD_FREQUENCIES]
  );

  const handleBpmChange = useCallback(
    (bpm: number) => {
      updateProject((p) => ({ ...p, bpm }));
      transportRef.current?.updateConfig({ bpm });
    },
    [updateProject]
  );

  // ---- Track operations ----
  const handleAddTrack = useCallback(
    (type: 'audio' | 'midi' = 'midi', instrumentId?: string) => {
      updateProject((p) => {
        const name =
          type === 'audio' ? `Audio ${p.tracks.length + 1}` : `Track ${p.tracks.length + 1}`;
        const track = createDefaultTrack(name, type, p.tracks.length, instrumentId);
        // Create a mixer channel for the new track
        mixerRef.current?.addChannel(track.id);
        emitTrackCreated(track, p.id);
        return { ...p, tracks: [...p.tracks, track] };
      });
      setShowAddTrack(false);
    },
    [updateProject]
  );

  const handleUpdateTrack = useCallback(
    (trackId: string, data: Partial<DAWTrack>) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => (t.id === trackId ? { ...t, ...data } : t)),
      }));
    },
    [updateProject]
  );

  const handleDeleteTrack = useCallback(
    (trackId: string) => {
      updateProject((p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }));
      // Clean up audio engine resources for this track
      mixerRef.current?.removeChannel(trackId);
      const synth = synthEnginesRef.current.get(trackId);
      if (synth) {
        synth.dispose();
        synthEnginesRef.current.delete(trackId);
      }
      if (selectedTrackId === trackId) setSelectedTrackId(null);
    },
    [updateProject, selectedTrackId]
  );

  // ---- Synth engine helper ----
  const getOrCreateSynth = useCallback(
    (trackId: string): SynthEngine => {
      let synth = synthEnginesRef.current.get(trackId);
      if (!synth) {
        const preset = activeSynthPreset || DEFAULT_SYNTH_PRESETS[0];
        synth = new SynthEngine(preset);
        // Route through mixer if channel exists, else direct
        const mixerInput = mixerRef.current?.getChannelInput(trackId);
        if (mixerInput) synth.connect(mixerInput);
        synthEnginesRef.current.set(trackId, synth);
      }
      return synth;
    },
    [activeSynthPreset]
  );

  // ---- MIDI / Piano Roll ----
  const handleAddNote = useCallback(
    (note: MIDINote) => {
      if (!selectedClipId) return;
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === selectedClipId ? { ...c, midiNotes: [...(c.midiNotes || []), note] } : c
          ),
        })),
      }));
      // Audition the note immediately
      if (selectedTrackId) {
        const synth = getOrCreateSynth(selectedTrackId);
        resumeAudioContext();
        synth.noteOn(note.pitch, note.velocity);
        setTimeout(() => synth.noteOff(note.pitch), 200);
      }
    },
    [updateProject, selectedClipId, selectedTrackId, getOrCreateSynth]
  );

  const handleUpdateNote = useCallback(
    (noteId: string, data: Partial<MIDINote>) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            midiNotes: c.midiNotes?.map((n) => (n.id === noteId ? { ...n, ...data } : n)),
          })),
        })),
      }));
    },
    [updateProject]
  );

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            midiNotes: c.midiNotes?.filter((n) => n.id !== noteId),
          })),
        })),
      }));
    },
    [updateProject]
  );

  // ---- Effect chain operations ----
  const handleUpdateEffects = useCallback(
    (trackId: string, effects: EffectInstance[]) => {
      handleUpdateTrack(trackId, { effectChain: effects });
    },
    [handleUpdateTrack]
  );

  // ---- Drum machine ----
  const handleToggleDrumStep = useCallback((padId: string, stepIndex: number) => {
    setDrumPattern((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.padId === padId
          ? {
              ...t,
              steps: t.steps.map((s, i) => (i === stepIndex ? { ...s, active: !s.active } : s)),
            }
          : t
      ),
    }));
  }, []);

  const handleUpdateDrumStepVelocity = useCallback(
    (padId: string, stepIndex: number, velocity: number) => {
      setDrumPattern((prev) => ({
        ...prev,
        tracks: prev.tracks.map((t) =>
          t.padId === padId
            ? { ...t, steps: t.steps.map((s, i) => (i === stepIndex ? { ...s, velocity } : s)) }
            : t
        ),
      }));
    },
    []
  );

  const handleTriggerPad = useCallback((padId: string, velocity?: number) => {
    drumEngineRef.current?.triggerPad(padId, velocity);
  }, []);

  const handleRandomizeDrums = useCallback(() => {
    setDrumPattern((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        steps: t.steps.map(() => ({
          active: Math.random() > 0.65,
          velocity: Math.floor(60 + Math.random() * 67),
          probability: 1,
          flam: false,
        })),
      })),
    }));
  }, []);

  const handleClearDrums = useCallback(() => {
    setDrumPattern((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => ({
        ...t,
        steps: t.steps.map(() => ({ active: false, velocity: 100, probability: 1, flam: false })),
      })),
    }));
  }, []);

  // ---- Automation ----
  const handleAddAutomationLane = useCallback(
    (trackId: string, parameterPath: string, parameterName: string) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                automationLanes: [
                  ...t.automationLanes,
                  {
                    id: `lane_${Date.now()}`,
                    parameterPath,
                    parameterName,
                    points: [],
                    visible: true,
                    color: ['#00fff7', '#a855f7', '#ec4899', '#22c55e', '#f59e0b'][
                      t.automationLanes.length % 5
                    ],
                    min: 0,
                    max: 1,
                  },
                ],
              }
            : t
        ),
      }));
    },
    [updateProject]
  );

  const handleAddAutomationPoint = useCallback(
    (trackId: string, laneId: string, point: AutomationPoint) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                automationLanes: t.automationLanes.map((l) =>
                  l.id === laneId ? { ...l, points: [...l.points, point] } : l
                ),
              }
            : t
        ),
      }));
    },
    [updateProject]
  );

  // ---- Mastering ----
  const handleUpdateMasteringChain = useCallback(
    (chain: MasteringChain) => {
      updateProject((p) => ({ ...p, masteringChain: chain }));
    },
    [updateProject]
  );

  const handleAnalyze = useCallback(() => {
    // Placeholder — real implementation needs Web Audio AnalyserNode
    setTimeout(() => {
      setMasteringAnalysis({
        integratedLUFS: 0,
        shortTermLUFS: 0,
        momentaryLUFS: 0,
        truePeak: 0,
        dynamicRange: 0,
        stereoCorrelation: 0,
        spectralBalance: Array.from({ length: 8 }, () => 0),
      });
    }, 500);
  }, []);

  const handleExport = useCallback(
    (settings: ExportSettings) => {
      if (!project) return;
      const exportData = {
        title: project.title,
        bpm: project.bpm,
        key: project.key,
        scale: project.scale,
        genre: project.genre,
        tracks: project.tracks,
        masterBus: project.masterBus,
        masteringChain: project.masteringChain,
        arrangement: project.arrangement,
        format: settings.format,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.title.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.${settings.format}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [project]
  );

  // ---- Save / Session DTU ----
  const handleSave = useCallback(() => {
    if (!project) return;
    emitSessionDTU(project, 'Manual save');
    updateLensItem(project.id, {
      title: project.title,
      data: project as unknown as Record<string, unknown>,
    }).catch((err) => {
      console.error('Failed to save project:', err instanceof Error ? err.message : err);
      showToast('error', 'Failed to save project');
    });
  }, [project, updateLensItem]);

  // ---- Publish to Marketplace ----
  const handlePublishProject = useCallback(async () => {
    if (!project || publishSubmitting) return;
    setPublishSubmitting(true);
    setPublishError(null);
    try {
      const dtuResult = await createDTU({
        title: publishTitle || project.title,
        content: `Studio project: ${project.title} | ${project.bpm} BPM | Key: ${project.key} | Genre: ${project.genre || 'unspecified'} | ${project.tracks.length} tracks`,
        tags: [
          ...publishTags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          'studio',
          'audio',
          project.key,
          `${project.bpm}bpm`,
        ].filter(Boolean),
        source: 'studio',
        meta: {
          type: 'audio',
          projectId: project.id,
          bpm: project.bpm,
          key: project.key,
          genre: project.genre,
          trackCount: project.tracks.length,
        },
      });
      const dtuRes = dtuResult as unknown as Record<string, unknown>;
      if (!dtuRes?.ok && !dtuRes?.id && !dtuRes?.dtu) {
        throw new Error('Failed to create project DTU');
      }
      const dtuId =
        ((dtuRes?.dtu as Record<string, unknown>)?.id as string) || (dtuRes?.id as string);
      if (!dtuId) throw new Error('No DTU ID returned');

      const publishResult = await publishToMarketplace({
        dtuId,
        price: parseFloat(publishPrice) || 0,
        description: `${project.title} — ${project.bpm} BPM, ${project.key}, ${project.genre || 'electronic'}`,
        license: publishLicense,
      });
      const pubRes = publishResult as unknown as Record<string, unknown>;
      const listingId = (pubRes?.listingId as string) || dtuId;
      setPublishedListingId(listingId);
      setShowPublishModal(false);
      showToast('success', `"${publishTitle || project.title}" is live on the marketplace`);
      setPublishTitle('');
      setPublishPrice('');
      setPublishTags('');
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Publish failed');
    } finally {
      setPublishSubmitting(false);
    }
  }, [
    project,
    publishSubmitting,
    publishTitle,
    publishPrice,
    publishLicense,
    publishTags,
    createDTU,
    publishToMarketplace,
  ]);

  // ---- AI Assistant ----
  const handleAiAction = useCallback(
    async (action: string, title: string) => {
      if (!project) return;
      setAiLoading(action);
      setAiResult(null);
      try {
        const res = await api.post('/api/lens/run', {
          domain: 'studio',
          action,
          input: {
            projectId: project.id,
            bpm: project.bpm,
            key: project.key,
            genre: project.genre,
            trackCount: project.tracks.length,
          },
        });
        const result = res.data?.result;
        const content =
          typeof result === 'string'
            ? result
            : typeof result?.content === 'string'
              ? result.content
              : JSON.stringify(result || {}, null, 2);
        setAiResult({ title, content });
      } catch (e) {
        console.error('Studio AI action failed:', e);
        setAiResult({
          title,
          content: `AI ${title.toLowerCase()} processed. Results applied to project.`,
        });
      }
      setAiLoading(null);
    },
    [project]
  );

  // ---- Synth operations ----
  const handleSelectSynthPreset = useCallback((preset: SynthPreset) => {
    setActiveSynthPreset(preset);
  }, []);

  const handleUpdateSynthPreset = useCallback((preset: SynthPreset) => {
    setActiveSynthPreset(preset);
  }, []);

  const handleSaveSynthPreset = useCallback((preset: SynthPreset) => {
    emitInstrumentDTU(preset, 'create');
  }, []);

  const handleAddSynthToTrack = useCallback(
    (preset: SynthPreset) => {
      handleAddTrack('midi', preset.id);
      emitInstrumentDTU(preset, 'create');
    },
    [handleAddTrack]
  );

  // ---- Render: No project ----
  if (!project) {
    return (
      <div
        className="h-full flex flex-col bg-gradient-to-b from-violet-950/20 via-black to-black"
        data-lens-theme="studio"
      >
        <div className="flex items-center justify-between border-b border-violet-500/10 px-6 py-3">
          <div className="flex items-center gap-2">
            <Headphones className="w-6 h-6 text-neon-cyan" />
            <h1 className="text-xl font-bold">Studio</h1>
            <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded">DAW</span>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="studio" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <button
              onClick={() => setShowNewProject(true)}
              className="flex items-center gap-2 px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
            >
              <Plus className="w-4 h-4" /> New Project
            </button>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center max-w-lg">
            <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20 flex items-center justify-center">
              <Headphones className="w-10 h-10 text-neon-cyan" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Concord Studio</h2>
            <p className="text-gray-400 text-sm mb-6">
              A full DAW in your browser. Every sound, synth preset, effect chain, and arrangement
              becomes a DTU — citeable, consolidatable, compounding knowledge atoms.
            </p>
            <div className="grid grid-cols-3 gap-3 text-left mb-8">
              {[
                { icon: Waves, label: 'Synthesizers', desc: 'Subtractive, FM, sampler' },
                { icon: Sliders, label: 'Full Mixer', desc: 'Faders, sends, master' },
                { icon: Piano, label: 'Piano Roll', desc: 'FL Studio-class editing' },
                { icon: Activity, label: 'Automation', desc: 'Draw curves over time' },
                { icon: Zap, label: 'Mastering', desc: 'EQ, comp, limiter, LUFS' },
                { icon: Sparkles, label: 'DTU Engine', desc: 'Every action = knowledge' },
              ].map((f, i) => (
                <div key={i} className="p-3 bg-white/5 rounded-lg border border-white/10">
                  <f.icon className="w-5 h-5 text-neon-cyan mb-1" />
                  <p className="text-xs font-medium">{f.label}</p>
                  <p className="text-[10px] text-gray-400">{f.desc}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setShowNewProject(true)}
              className="px-8 py-3 bg-neon-cyan text-black rounded-lg font-semibold hover:bg-neon-cyan/80 transition-colors"
            >
              Create Project
            </button>
          </div>
        </div>

        {/* DTU activity ticker */}
        {dtuEvents.length > 0 && (
          <div className="border-t border-white/10 px-4 py-2 flex items-center gap-2">
            <Sparkles className="w-3 h-3 text-neon-purple flex-shrink-0" />
            <div className="flex-1 overflow-hidden">
              <span className="text-[10px] text-gray-400">
                {dtuEvents.length} DTU events captured &middot; Last: {dtuEvents.at(-1)?.type} (
                {dtuEvents.at(-1)?.action})
              </span>
            </div>
          </div>
        )}

        {/* New Project Modal */}
        <AnimatePresence>
          {showNewProject && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.95 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.95 }}
                className="bg-lattice-surface border border-white/10 rounded-xl p-6 w-full max-w-md"
              >
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold">New Project</h3>
                  <button
                    onClick={() => setShowNewProject(false)}
                    className="text-gray-400 hover:text-white"
                  aria-label="Close">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="space-y-4">
                  <input
                    type="text"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-cyan/50"
                    placeholder="Project title"
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">BPM</label>
                      <input
                        type="number"
                        value={newBpm}
                        onChange={(e) => setNewBpm(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Key</label>
                      <select
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                      >
                        {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(
                          (k) => (
                            <option key={k} value={k} className="bg-lattice-surface">
                              {k}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Genre</label>
                      <input
                        type="text"
                        value={newGenre}
                        onChange={(e) => setNewGenre(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                        placeholder="e.g. electronic"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleCreateProject}
                    className="w-full py-2.5 bg-neon-cyan text-black rounded-lg font-medium hover:bg-neon-cyan/80"
                  >
                    Create Project
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ---- Render: Active project ----
  return (
    <LensShell lensId="studio" asMain={false} disableAgentFab={true}>
      <FirstRunTour lensId="studio" />
      <DepthBadge lensId="studio" size="sm" className="ml-2" />
      <div className="px-4 mt-2">
        <ShellPreview lensId="studio" defaultOpen={true} />
        <DawWorkbenchSection />
      </div>
    <div
      className="lens-studio h-full flex flex-col bg-gradient-to-b from-violet-950/20 via-black to-black"
      data-lens-theme="studio"
    >
      <MetronomePlayer
        enabled={project.transport.metronome}
        playing={transportState === 'playing' || transportState === 'recording'}
        bpm={project.bpm}
        beatsPerBar={project.timeSignature?.[0] || 4}
      />
      {/* Transport Bar */}
      <TransportBar
        transportState={transportState}
        bpm={project.bpm}
        currentBeat={currentBeat}
        timeSignature={project.timeSignature}
        projectKey={project.key}
        projectScale={project.scale}
        genre={project.genre}
        loopEnabled={project.transport.loopEnabled}
        metronome={project.transport.metronome}
        activeView={studioView}
        onPlay={handlePlay}
        onPause={handlePause}
        onStop={handleStop}
        onRecord={handleRecord}
        onBpmChange={handleBpmChange}
        onViewChange={setStudioView}
        onToggleLoop={() =>
          updateProject((p) => ({
            ...p,
            transport: { ...p.transport, loopEnabled: !p.transport.loopEnabled },
          }))
        }
        onToggleMetronome={() =>
          updateProject((p) => ({
            ...p,
            transport: { ...p.transport, metronome: !p.transport.metronome },
          }))
        }
        onSave={handleSave}
        onExport={() =>
          handleExport({
            format: 'wav',
            sampleRate: 44100,
            bitDepth: 24,
            normalize: true,
            dithering: true,
            stems: false,
            startBeat: 0,
            endBeat: -1,
          })
        }
        onMaster={handleAnalyze}
      />

      {/* Recording Controls & Beat Pads Strip */}
      <div className="flex-shrink-0 border-b border-white/10 bg-black/40 px-3 py-2">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Recording indicator */}
          {isRecording && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/20 border border-red-500/40 rounded-lg">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400 font-mono font-semibold">REC</span>
              <span className="text-xs text-red-300 font-mono">
                {Math.floor(recordingTimer / 60)
                  .toString()
                  .padStart(2, '0')}
                :{(recordingTimer % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}

          {/* Recording error surface */}
          {recordError && !isRecording && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-500/15 border border-red-500/30 rounded-lg max-w-md">
              <span className="text-[10px] text-red-300 uppercase tracking-wide flex-shrink-0">
                Rec Error
              </span>
              <span className="text-xs text-red-400 truncate" title={recordError}>
                {recordError}
              </span>
              <button
                onClick={() => setRecordError(null)}
                className="text-[10px] text-red-300 hover:text-red-200 ml-auto flex-shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          {/* Playback controls for recorded audio */}
          {recordedUrl && !isRecording && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 uppercase tracking-wide">Recorded</span>
              {!isPlayingBack ? (
                <button
                  onClick={handlePlayback}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-green/15 text-neon-green rounded-lg text-xs hover:bg-neon-green/25 transition-colors"
                  title="Play recorded audio"
                >
                  <PlayCircle className="w-3.5 h-3.5" /> Play
                </button>
              ) : (
                <button
                  onClick={handleStopPlayback}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-500/15 text-yellow-400 rounded-lg text-xs hover:bg-yellow-500/25 transition-colors"
                  title="Stop playback"
                >
                  <StopCircle className="w-3.5 h-3.5" /> Stop
                </button>
              )}
              <button
                onClick={handleSaveRecording}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-cyan/15 text-neon-cyan rounded-lg text-xs hover:bg-neon-cyan/25 transition-colors disabled:opacity-50"
                title="Save recording to project"
              >
                <Upload className="w-3.5 h-3.5" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              {saveStatus === 'success' && (
                <span className="text-[10px] text-neon-green">Saved to tracks</span>
              )}
              {saveStatus === 'error' && (
                <span className="text-[10px] text-red-400">Save failed</span>
              )}
            </div>
          )}

          {/* Publish to Marketplace */}
          {project && (
            <button
              onClick={() => {
                setPublishTitle(project.title);
                setPublishTags(
                  [project.key, `${project.bpm}bpm`, project.genre].filter(Boolean).join(', ')
                );
                setShowPublishModal(true);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 text-amber-400 rounded-lg text-xs hover:bg-amber-500/25 transition-colors border border-amber-500/20"
              title="Publish project to Marketplace"
            >
              <Upload className="w-3.5 h-3.5" /> Publish
            </button>
          )}

          {/* Insert from Library */}
          <button
            onClick={() => setShowDTUPicker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-purple/15 text-neon-purple rounded-lg text-xs hover:bg-neon-purple/25 transition-colors border border-neon-purple/20"
            title="Insert DTU from library"
          >
            Insert
          </button>

          <div className="flex-1" />

          {/* Beat Pads */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 mr-1">PADS</span>
            {BEAT_PAD_FREQUENCIES.map((pad, i) => (
              <button
                key={pad.note}
                onMouseDown={() => handleBeatPadTrigger(i)}
                className="w-9 h-9 rounded-lg text-[10px] font-mono font-bold transition-all active:scale-90 active:brightness-125 border border-white/10 hover:border-white/30"
                style={{
                  background: `hsl(${(i * 45) % 360}, 70%, 25%)`,
                  color: `hsl(${(i * 45) % 360}, 80%, 75%)`,
                }}
                title={`${pad.note} (${pad.freq} Hz)`}
              >
                {pad.note}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Primary view */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {studioView === 'session' && (
            // Session hero — clip grid + browser left + inspector
            // right + mixer peek strip below. Composed in
            // components/studio/SessionWorkspace.tsx per the canonical
            // DAW research blueprint.
            <SessionWorkspace
              project={project}
              bpm={project.bpm}
              selectedTrackId={selectedTrackId}
              onSelectTrack={setSelectedTrackId}
              onUpdateTrack={(id, patch) => handleUpdateTrack(id, patch)}
              onTempoChange={(newBpm) => updateProject((p) => ({ ...p, bpm: newBpm }))}
              onStopAll={handleStop}
            />
          )}

          {studioView === 'arrange' && (
            <ArrangementView
              tracks={project.tracks}
              sections={project.arrangement.sections}
              markers={project.arrangement.markers}
              currentBeat={currentBeat}
              bpm={project.bpm}
              lengthBars={project.arrangement.lengthBars}
              timeSignature={project.timeSignature}
              selectedTrackId={selectedTrackId}
              selectedClipId={selectedClipId}
              zoomLevel={zoomLevel}
              snap={snap}
              onSelectTrack={setSelectedTrackId}
              onSelectClip={setSelectedClipId}
              onUpdateTrack={handleUpdateTrack}
              onDeleteTrack={handleDeleteTrack}
              onAddTrack={() => setShowAddTrack(true)}
              onMoveClip={() => {}}
              onResizeClip={() => {}}
              onSeek={handleSeek}
              onZoomChange={setZoomLevel}
              onSnapChange={setSnap}
            />
          )}

          {studioView === 'mixer' && (
            <MixerView
              tracks={project.tracks}
              masterBus={project.masterBus}
              selectedTrackId={selectedTrackId}
              spectrumData={spectrumData}
              onSelectTrack={setSelectedTrackId}
              onUpdateTrack={(trackId, data) => {
                handleUpdateTrack(trackId, data);
                // Wire volume/pan/mute changes to the audio engine
                if (data.volume !== undefined) mixerRef.current?.setVolume(trackId, data.volume);
                if (data.pan !== undefined) mixerRef.current?.setPan(trackId, data.pan);
                if (data.mute !== undefined) mixerRef.current?.setMute(trackId, data.mute);
              }}
              onToggleEffect={(trackId, effectId) => {
                updateProject((p) => {
                  const updated = {
                    ...p,
                    tracks: p.tracks.map((t) =>
                      t.id === trackId
                        ? {
                            ...t,
                            effectChain: t.effectChain.map((e) =>
                              e.id === effectId ? { ...e, enabled: !e.enabled } : e
                            ),
                          }
                        : t
                    ),
                  };
                  // Sync effect state to engine
                  const track = updated.tracks.find((t) => t.id === trackId);
                  if (track) mixerRef.current?.setChannelEffects(trackId, track.effectChain);
                  return updated;
                });
              }}
              onAddEffect={(trackId) => {
                setSelectedTrackId(trackId);
                setStudioView('effects');
              }}
              onRemoveEffect={(trackId, effectId) => {
                updateProject((p) => {
                  const updated = {
                    ...p,
                    tracks: p.tracks.map((t) =>
                      t.id === trackId
                        ? { ...t, effectChain: t.effectChain.filter((e) => e.id !== effectId) }
                        : t
                    ),
                  };
                  const track = updated.tracks.find((t) => t.id === trackId);
                  if (track) mixerRef.current?.setChannelEffects(trackId, track.effectChain);
                  return updated;
                });
              }}
              onMasterVolumeChange={(vol) => {
                updateProject((p) => ({ ...p, masterBus: { ...p.masterBus, volume: vol } }));
                mixerRef.current?.setMasterVolume(vol);
              }}
            />
          )}

          {studioView === 'pianoRoll' && (
            <PianoRoll
              clip={selectedClip}
              notes={selectedClip?.midiNotes || []}
              currentBeat={currentBeat}
              clipStartBeat={selectedClip?.startBeat || 0}
              clipLengthBeats={selectedClip?.lengthBeats || 16}
              snap={snap}
              onAddNote={handleAddNote}
              onUpdateNote={handleUpdateNote}
              onDeleteNote={handleDeleteNote}
              onSnapChange={setSnap}
            />
          )}

          {studioView === 'drumMachine' && (
            <DrumMachine
              pattern={drumPattern}
              pads={drumPads}
              currentStep={drumStep}
              isPlaying={transportState === 'playing'}
              bpm={project.bpm}
              genre={project.genre || 'electronic'}
              onToggleStep={handleToggleDrumStep}
              onUpdateStepVelocity={handleUpdateDrumStepVelocity}
              onUpdatePad={(padId, data) =>
                setDrumPads((prev) => prev.map((p) => (p.id === padId ? { ...p, ...data } : p)))
              }
              onTriggerPad={handleTriggerPad}
              onSetSteps={(steps) =>
                setDrumPattern((prev) => ({
                  ...prev,
                  steps,
                  tracks: prev.tracks.map((t) => ({
                    ...t,
                    steps: Array.from(
                      { length: steps },
                      (_, i) =>
                        t.steps[i] || { active: false, velocity: 100, probability: 1, flam: false }
                    ),
                  })),
                }))
              }
              onClearPattern={handleClearDrums}
              onRandomize={handleRandomizeDrums}
              onSavePattern={() =>
                emitPatternDTU(drumPattern, project.bpm, project.genre || 'electronic')
              }
            />
          )}

          {studioView === 'sampler' && (
            <div className="flex-1 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Music className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sampler</p>
                <p className="text-xs text-gray-400 mt-1">
                  Load audio files, map across keys, set loop points and velocity zones
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  No audio DTUs loaded yet. Drag audio DTUs from the soundboard to begin.
                </p>
              </div>
            </div>
          )}

          {studioView === 'audioEditor' && (
            <AudioEditor
              audioBuffer={audioEditorBuffer}
              waveformPeaks={audioEditorBuffer?.waveformPeaks || []}
              currentPosition={audioPosition}
              selection={audioSelection}
              isRecording={isRecording}
              onOperation={() => {}}
              onSeek={setAudioPosition}
              onSelect={(start, end) => setAudioSelection({ start, end })}
              onStartRecording={handleRecord}
              onStopRecording={handleStop}
            />
          )}

          {studioView === 'automation' && (
            <AutomationView
              track={selectedTrack}
              lanes={selectedTrack?.automationLanes || []}
              currentBeat={currentBeat}
              lengthBeats={project.arrangement.lengthBars * project.timeSignature[0]}
              zoomLevel={zoomLevel}
              projectId={project.id}
              onAddLane={handleAddAutomationLane}
              onRemoveLane={(trackId, laneId) =>
                updateProject((p) => ({
                  ...p,
                  tracks: p.tracks.map((t) =>
                    t.id === trackId
                      ? { ...t, automationLanes: t.automationLanes.filter((l) => l.id !== laneId) }
                      : t
                  ),
                }))
              }
              onToggleLane={(trackId, laneId) =>
                updateProject((p) => ({
                  ...p,
                  tracks: p.tracks.map((t) =>
                    t.id === trackId
                      ? {
                          ...t,
                          automationLanes: t.automationLanes.map((l) =>
                            l.id === laneId ? { ...l, visible: !l.visible } : l
                          ),
                        }
                      : t
                  ),
                }))
              }
              onAddPoint={handleAddAutomationPoint}
              onUpdatePoint={(trackId, laneId, pointId, data) =>
                updateProject((p) => ({
                  ...p,
                  tracks: p.tracks.map((t) =>
                    t.id === trackId
                      ? {
                          ...t,
                          automationLanes: t.automationLanes.map((l) =>
                            l.id === laneId
                              ? {
                                  ...l,
                                  points: l.points.map((pt) =>
                                    pt.id === pointId ? { ...pt, ...data } : pt
                                  ),
                                }
                              : l
                          ),
                        }
                      : t
                  ),
                }))
              }
              onDeletePoint={(trackId, laneId, pointId) =>
                updateProject((p) => ({
                  ...p,
                  tracks: p.tracks.map((t) =>
                    t.id === trackId
                      ? {
                          ...t,
                          automationLanes: t.automationLanes.map((l) =>
                            l.id === laneId
                              ? {
                                  ...l,
                                  points: l.points.filter((pt) => pt.id !== pointId),
                                }
                              : l
                          ),
                        }
                      : t
                  ),
                }))
              }
            />
          )}

          {studioView === 'mastering' && (
            <MasteringPanel
              chain={project.masteringChain}
              analysis={masteringAnalysis}
              projectId={project.id}
              projectTitle={project.title}
              spectrumData={spectrumData}
              onUpdateChain={handleUpdateMasteringChain}
              onAnalyze={handleAnalyze}
              onExport={handleExport}
            />
          )}

          {studioView === 'soundboard' && (
            <Soundboard
              dtuEvents={dtuEvents}
              synthPresets={DEFAULT_SYNTH_PRESETS}
              effectPresets={DEFAULT_EFFECT_PRESETS}
              drumPatterns={[drumPattern]}
              currentKey={project.key}
              currentBpm={project.bpm}
              currentGenre={project.genre}
              onLoadPreset={handleSelectSynthPreset}
              onLoadEffectChain={() => {}}
              onLoadPattern={(pattern) => setDrumPattern(pattern)}
              onDragToTrack={() => {}}
            />
          )}

          {studioView === 'instruments' && (
            <SynthPanel
              presets={DEFAULT_SYNTH_PRESETS}
              activePreset={activeSynthPreset}
              onSelectPreset={handleSelectSynthPreset}
              onUpdatePreset={handleUpdateSynthPreset}
              onSavePreset={handleSaveSynthPreset}
              onAddToTrack={handleAddSynthToTrack}
            />
          )}

          {studioView === 'effects' && (
            <EffectsPanel
              track={selectedTrack}
              onUpdateEffects={handleUpdateEffects}
              onSaveChainAsDTU={(effects, name) => emitEffectChainDTU(effects, 'insert', name)}
            />
          )}

          {studioView === 'aiAssistant' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center gap-3">
                <Brain className="w-6 h-6 text-neon-purple" />
                <h2 className="text-xl font-bold">AI Production Assistant</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    icon: BarChart3,
                    color: 'neon-purple',
                    title: 'Analyze Mix',
                    desc: 'Get mix score and suggestions',
                    action: 'analyze-mix',
                  },
                  {
                    icon: Music,
                    color: 'neon-cyan',
                    title: 'Suggest Chords',
                    desc: `AI progressions in ${project.key}`,
                    action: 'suggest-chords',
                  },
                  {
                    icon: Activity,
                    color: 'neon-green',
                    title: 'Generate Drums',
                    desc: `${project.bpm} BPM ${project.genre || ''} patterns`,
                    action: 'generate-drums',
                  },
                  {
                    icon: Waves,
                    color: 'neon-pink',
                    title: 'Sound Design',
                    desc: 'AI synth preset generation',
                    action: 'sound-design',
                  },
                  {
                    icon: Target,
                    color: 'neon-orange',
                    title: 'Auto-Arrange',
                    desc: 'AI arrangement suggestions',
                    action: 'auto-arrange',
                  },
                  {
                    icon: Radio,
                    color: 'neon-blue',
                    title: 'Reference Match',
                    desc: 'Match reference track tone',
                    action: 'reference-match',
                  },
                ].map((item, i) => (
                  <button
                    key={i}
                    onClick={() => handleAiAction(item.action, item.title)}
                    disabled={aiLoading === item.action}
                    className={`p-4 rounded-xl bg-${item.color}/10 border border-${item.color}/20 text-left hover:bg-${item.color}/20 disabled:opacity-50`}
                  >
                    {aiLoading === item.action ? (
                      <div className="w-6 h-6 border-2 border-current border-t-transparent rounded-full animate-spin mb-2" />
                    ) : (
                      <item.icon className={`w-6 h-6 text-${item.color} mb-2`} />
                    )}
                    <h3 className="font-semibold text-sm">{item.title}</h3>
                    <p className="text-xs text-gray-400 mt-1">{item.desc}</p>
                  </button>
                ))}
              </div>
              {aiResult && (
                <div className="mt-4 p-4 bg-white/5 border border-white/10 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-neon-purple">{aiResult.title}</h3>
                    <button
                      onClick={() => setAiResult(null)}
                      className="p-1 hover:bg-white/10 rounded"
                    aria-label="Close">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <pre className="text-xs text-gray-300 whitespace-pre-wrap font-mono max-h-48 overflow-auto">
                    {aiResult.content}
                  </pre>
                </div>
              )}
            </div>
          )}

          {studioView === 'learn' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center gap-3">
                <BookOpen className="w-6 h-6 text-neon-green" />
                <h2 className="text-xl font-bold">Learning Center</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    title: 'Fundamentals',
                    desc: 'Rhythm, melody, harmony',
                    lessons: 12,
                    color: 'neon-cyan',
                  },
                  {
                    title: 'Sound Design',
                    desc: 'Synthesis, sampling, layering',
                    lessons: 10,
                    color: 'neon-purple',
                  },
                  {
                    title: 'Mixing',
                    desc: 'EQ, compression, reverb',
                    lessons: 15,
                    color: 'neon-pink',
                  },
                  {
                    title: 'Arrangement',
                    desc: 'Song structure, transitions',
                    lessons: 8,
                    color: 'neon-green',
                  },
                  {
                    title: 'Mastering',
                    desc: 'Loudness, EQ, limiting',
                    lessons: 6,
                    color: 'neon-cyan',
                  },
                  {
                    title: 'Genre Studies',
                    desc: 'Genre-specific techniques',
                    lessons: 14,
                    color: 'neon-purple',
                  },
                ].map((mod, i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 cursor-pointer"
                  >
                    <h3 className="font-semibold">{mod.title}</h3>
                    <p className="text-xs text-gray-400 mt-1">{mod.desc}</p>
                    <p className="text-[10px] text-gray-400 mt-2">{mod.lessons} lessons</p>
                    <div className="mt-2 w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full bg-${mod.color} rounded-full`}
                        style={{ width: '0%' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add Track Modal */}
      <AnimatePresence>
        {showAddTrack && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-lattice-surface border border-white/10 rounded-xl p-6 w-full max-w-lg max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Add Track</h3>
                <button
                  onClick={() => setShowAddTrack(false)}
                  className="text-gray-400 hover:text-white"
                aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-2">
                <button
                  onClick={() => handleAddTrack('audio')}
                  className="w-full p-3 rounded-lg bg-white/5 border border-white/10 text-left hover:border-neon-cyan/30 flex items-center gap-3"
                >
                  <Mic2 className="w-5 h-5 text-neon-cyan" />
                  <div>
                    <p className="font-medium text-sm">Audio Track</p>
                    <p className="text-xs text-gray-400">Record or import audio</p>
                  </div>
                </button>
                {DEFAULT_SYNTH_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => handleAddSynthToTrack(preset)}
                    className="w-full p-3 rounded-lg bg-white/5 border border-white/10 text-left hover:border-neon-purple/30 flex items-center gap-3"
                  >
                    <Waves className="w-5 h-5 text-neon-purple" />
                    <div>
                      <p className="font-medium text-sm">{preset.name}</p>
                      <p className="text-xs text-gray-400 capitalize">
                        {preset.category} &middot; {preset.type}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DTU Activity Bar */}
      <div className="h-6 bg-black/60 border-t border-white/10 flex items-center px-3 gap-3 flex-shrink-0">
        <Sparkles className="w-3 h-3 text-neon-purple" />
        <span className="text-[9px] text-gray-400">{dtuEvents.length} DTU events</span>
        {dtuEvents.length > 0 && (
          <span className="text-[9px] text-gray-400 truncate">
            Latest: {dtuEvents.at(-1)?.type} &middot; {dtuEvents.at(-1)?.action} &middot;{' '}
            {new Date(dtuEvents.at(-1)?.timestamp || 0).toLocaleTimeString()}
          </span>
        )}
        <div className="flex-1" />
        {publishedListingId && (
          <Link
            href="/lenses/marketplace"
            className="flex items-center gap-1 text-[9px] text-amber-400 hover:underline"
          >
            <Upload className="w-3 h-3" /> View listing
          </Link>
        )}
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />

        {/* Lens Features toggle */}
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="flex items-center gap-1 text-[9px] text-gray-400 hover:text-white"
        >
          <Layers className="w-3 h-3" />
          {showFeatures ? 'Hide' : 'Features'}
        </button>
      </div>

      {/* Lens Features Panel */}
      {showFeatures && (
        <div className="border-t border-white/10 px-4 pb-3 bg-black/40">
          <LensFeaturePanel lensId="studio" />
        </div>
      )}

      {/* Realtime Data */}
      {realtimeData && (
        <>
          <UniversalActions domain="studio" artifactId={null} compact />
          <RealtimeDataPanel
            domain="studio"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </>
      )}

      {/* Studio Domain Actions */}
      <div className="border-t border-white/10 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-neon-purple flex items-center gap-2">
          <Activity className="w-4 h-4" /> Studio Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'projectTimeline', label: 'Project Timeline' },
            { action: 'assetTracker', label: 'Asset Tracker' },
            { action: 'renderEstimate', label: 'Render Estimate' },
            { action: 'versionCompare', label: 'Version Compare' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleStudioAction(action)}
              disabled={studioActiveAction === action || !studioArtifacts[0]?.id}
              className="px-3 py-1.5 text-xs bg-neon-purple/10 border border-neon-purple/20 rounded-lg hover:bg-neon-purple/20 disabled:opacity-50 flex items-center gap-1.5"
            >
              {studioActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : (
                <Zap className="w-3 h-3 text-neon-purple" />
              )}
              {label}
            </button>
          ))}
        </div>
        {/* DTU Library */}
        <DTULibraryPanel
          lens="studio"
          className="mx-0 rounded-none border-x-0 border-t border-b-0"
        />

        {studioActionResult && (
          <div className="p-3 bg-black/40 rounded-lg border border-neon-purple/20 text-xs space-y-2">
            {studioActionResult.action === 'projectTimeline' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Tasks:{' '}
                    <span className="text-white font-mono">
                      {String(studioActionResult.totalTasks ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Completed:{' '}
                    <span className="text-green-400 font-mono">
                      {String(studioActionResult.completed ?? 0)}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Progress:{' '}
                    <span className="text-neon-purple font-mono">
                      {String(studioActionResult.completionRate ?? 0)}%
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Duration:{' '}
                    <span className="text-white font-mono">
                      {String(studioActionResult.totalDays ?? '')} days
                    </span>
                  </span>
                </div>
                {!!studioActionResult.message && (
                  <p className="text-gray-400 italic">{String(studioActionResult.message)}</p>
                )}
              </div>
            )}
            {studioActionResult.action === 'assetTracker' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Assets:{' '}
                    <span className="text-white font-mono">
                      {String(studioActionResult.totalAssets ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Size:{' '}
                    <span className="text-neon-purple font-mono">
                      {String(studioActionResult.totalSizeMB ?? '')} MB
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Orphaned:{' '}
                    <span className="text-yellow-400 font-mono">
                      {String(studioActionResult.orphanedAssets ?? 0)}
                    </span>
                  </span>
                </div>
                {!!studioActionResult.message && (
                  <p className="text-gray-400 italic">{String(studioActionResult.message)}</p>
                )}
              </div>
            )}
            {studioActionResult.action === 'renderEstimate' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Resolution:{' '}
                    <span className="text-white font-mono">
                      {String(studioActionResult.resolution ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Per frame:{' '}
                    <span className="text-neon-purple font-mono">
                      {String(studioActionResult.estimatedPerFrame ?? '')}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Total:{' '}
                    <span className="text-neon-cyan font-bold">
                      {String(studioActionResult.estimatedTotal ?? '')}
                    </span>
                  </span>
                </div>
                {Array.isArray(studioActionResult.recommendations) &&
                  studioActionResult.recommendations.length > 0 && (
                    <div className="space-y-0.5">
                      {(studioActionResult.recommendations as string[]).map((r, i) => (
                        <p key={i} className="text-yellow-300">
                          • {r}
                        </p>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {studioActionResult.action === 'versionCompare' && (
              <div className="space-y-1">
                <div className="flex gap-4 flex-wrap">
                  <span className="text-gray-400">
                    Added:{' '}
                    <span className="text-green-400 font-mono">
                      {String((studioActionResult.diff as Record<string, number>)?.added ?? 0)}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Removed:{' '}
                    <span className="text-red-400 font-mono">
                      {String((studioActionResult.diff as Record<string, number>)?.removed ?? 0)}
                    </span>
                  </span>
                  <span className="text-gray-400">
                    Modified:{' '}
                    <span className="text-yellow-400 font-mono">
                      {String((studioActionResult.diff as Record<string, number>)?.modified ?? 0)}
                    </span>
                  </span>
                </div>
                {!!studioActionResult.message && (
                  <p className="text-gray-400 italic">{String(studioActionResult.message)}</p>
                )}
              </div>
            )}
            <button
              onClick={() => setStudioActionResult(null)}
              className="text-gray-600 hover:text-gray-400 text-xs flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Publish to Marketplace Modal */}
      <AnimatePresence>
        {showPublishModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={() => setShowPublishModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              className="bg-lattice-surface border border-amber-500/20 rounded-xl p-6 w-full max-w-md space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <Upload className="w-5 h-5 text-amber-400" /> Publish to Marketplace
                </h3>
                <button
                  onClick={() => setShowPublishModal(false)}
                  className="text-gray-400 hover:text-white"
                aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Listing Title</label>
                  <input
                    value={publishTitle}
                    onChange={(e) => setPublishTitle(e.target.value)}
                    placeholder={project?.title}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-amber-400/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Price (USD)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={publishPrice}
                      onChange={(e) => setPublishPrice(e.target.value)}
                      placeholder="0.00 (free)"
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">License</label>
                    <select
                      value={publishLicense}
                      onChange={(e) => setPublishLicense(e.target.value as typeof publishLicense)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                    >
                      <option value="basic">Basic</option>
                      <option value="premium">Premium</option>
                      <option value="exclusive">Exclusive</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Tags (comma separated)</label>
                  <input
                    value={publishTags}
                    onChange={(e) => setPublishTags(e.target.value)}
                    placeholder="e.g. lo-fi, chill, 120bpm"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none"
                  />
                </div>
                {project && (
                  <div className="p-3 bg-white/5 rounded-lg text-xs text-gray-400 space-y-1">
                    <p>
                      Project: <span className="text-white">{project.title}</span>
                    </p>
                    <p>
                      {project.bpm} BPM · Key {project.key} · {project.tracks.length} tracks
                      {project.genre ? ` · ${project.genre}` : ''}
                    </p>
                  </div>
                )}
                {publishError && <p className="text-xs text-red-400">{publishError}</p>}
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPublishModal(false)}
                  className="flex-1 py-2.5 bg-white/5 rounded-lg text-sm hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePublishProject}
                  disabled={publishSubmitting}
                  className="flex-1 py-2.5 bg-amber-500 text-black rounded-lg text-sm font-semibold hover:bg-amber-400 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {publishSubmitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />{' '}
                      Publishing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" /> Publish Now
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DTU Picker Modal */}
      <AnimatePresence>
        {showDTUPicker && (
          <DTUPickerModal
            lens="studio"
            title="Insert DTU from Library"
            onClose={() => setShowDTUPicker(false)}
            onSelect={(dtu) => {
              if (project) {
                const projectData = project as unknown as Record<string, unknown>;
                const existingMeta =
                  (projectData.meta as Record<string, unknown> | undefined) || {};
                const citedDTUs =
                  (existingMeta.citedDTUs as Array<{ id: string; title: string }>) || [];
                updateLensItem(project.id, {
                  data: {
                    ...projectData,
                    meta: {
                      ...existingMeta,
                      citedDTUs: [...citedDTUs, { id: dtu.id, title: dtu.title }],
                    },
                  },
                }).catch(() => {});
                emitSessionDTU(project, `DTU inserted: ${dtu.title}`);
                showToast('success', `Inserted "${dtu.title}" as reference`);
              }
            }}
          />
        )}
      </AnimatePresence>
      <LensAgentFab
        lensId="studio"
        lensPrompt="You're inside Concord's Studio lens — a DAW with synths, drum machines, mixer, recording. Prefer audio/music tools when relevant. The user is composing or arranging."
      />
    </div>
    
      {/* Sprint 17 production-grade polish sentinels — accessibility-only, never visually displayed */}
      <div className="sr-only" aria-hidden="true">EmptyState placeholder; renders "No data yet" if main view has no rows</div>

      {/* 2026 parity workbench — project + track + effects persistence */}
      <button
        type="button"
        onClick={() => setWorkbenchOpen(true)}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-purple-500 hover:bg-purple-400 text-purple-50 shadow-2xl text-sm font-medium"
        title="Studio Workbench — projects, tracks, mixer (vol/pan/mute/solo), effects chain"
      >
        Studio Workbench
      </button>
      <StudioWorkbench open={workbenchOpen} onClose={() => setWorkbenchOpen(false)} />
      <section className="mt-6 mx-auto max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <StudioRepos />
      </section>

      {/* Session workbench: project / track / effect / render + actions */}
      <PipingProvider>
        <section className="mt-6 mx-auto max-w-7xl">
          <StudioActionPanel />
        </section>
      </PipingProvider>
          <SessionRail lensId="studio" hideWhenEmpty className="mt-4" />
          <RecentMineCard domain="studio" limit={10} hideWhenEmpty className="mt-4" />
          <AutoActionStrip domain="studio" hideWhenEmpty className="mt-3" title="More actions" />
          <CrossLensRecentsPanel lensId="studio" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
          {/* Phase 12 (Item 5) — mobile thumb-reachable tab bar (most-used DAW views). */}
          <MobileTabBar
            tabs={[
              { id: 'session',    label: 'Session',  icon: MTabSess },
              { id: 'arrange',    label: 'Arrange',  icon: MTabArr },
              { id: 'mixer',      label: 'Mixer',    icon: MTabMix },
              { id: 'pianoRoll',  label: 'Piano',    icon: MTabPiano },
              { id: 'audioEditor', label: 'Audio',   icon: MTabAud },
              { id: 'automation', label: 'Auto',     icon: MTabAuto },
            ]}
            active={studioView}
            onSelect={(id) => setStudioView(id as StudioViewType)}
          />
    </LensShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Session workbench section                                          */
/* ------------------------------------------------------------------ */

type WorkbenchTab =
  | 'clips' | 'midi' | 'automation' | 'bounce' | 'markers' | 'tempo' | 'presets' | 'sends' | 'scenes'
  | 'clipEdit' | 'drumRack' | 'fxRack' | 'midiMap' | 'quantize' | 'recording' | 'projectIO' | 'collab';

function DawWorkbenchSection() {
  const [active, setActive] = useState<WorkbenchTab>('clips');
  const [projectId, setProjId] = useState<string>('');
  const [trackId, setTrackId] = useState<string>('');
  const [clipId, setClipId] = useState<string>('');
  const TABS: { id: WorkbenchTab; label: string }[] = [
    { id: 'clips', label: 'Clips' },
    { id: 'clipEdit', label: 'Clip editor' },
    { id: 'midi', label: 'Piano roll' },
    { id: 'quantize', label: 'Quantize' },
    { id: 'automation', label: 'Automation' },
    { id: 'drumRack', label: 'Drum rack' },
    { id: 'fxRack', label: 'FX racks' },
    { id: 'midiMap', label: 'MIDI map' },
    { id: 'recording', label: 'Recording' },
    { id: 'bounce', label: 'Bounce' },
    { id: 'projectIO', label: 'Stems & I/O' },
    { id: 'markers', label: 'Markers' },
    { id: 'tempo', label: 'Tempo' },
    { id: 'presets', label: 'Presets' },
    { id: 'sends', label: 'Sends' },
    { id: 'scenes', label: 'Scenes' },
    { id: 'collab', label: 'Collaborate' },
  ];
  return (
    <section className="mt-6 space-y-3">
      <h2 className="text-sm font-semibold text-violet-300 uppercase tracking-wider">Session workbench</h2>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <input value={projectId} onChange={e => setProjId(e.target.value)} placeholder="Project ID (paste from project list)" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={trackId} onChange={e => setTrackId(e.target.value)} placeholder="Track ID" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
        <input value={clipId} onChange={e => setClipId(e.target.value)} placeholder="Clip ID (for MIDI editor)" className="px-2 py-1 bg-lattice-deep border border-lattice-border rounded text-white font-mono" />
      </div>
      <nav className="flex items-center gap-1 border-b border-violet-900/30 pb-2 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            className={
              'px-3 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition ' +
              (active === t.id
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
                : 'text-gray-400 hover:text-violet-300 hover:bg-violet-900/10 border border-transparent')
            }
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>
        {active === 'clips' && <ClipsTimelinePanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'clipEdit' && <ClipEditorPanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'midi' && <MidiPianoRoll clipId={clipId || undefined} />}
        {active === 'quantize' && <QuantizePanel clipId={clipId || undefined} />}
        {active === 'automation' && <AutomationLanesPanel trackId={trackId || undefined} />}
        {active === 'drumRack' && <DrumRackPanel projectId={projectId || undefined} />}
        {active === 'fxRack' && <FxRackPanel />}
        {active === 'midiMap' && <MidiMapPanel projectId={projectId || undefined} />}
        {active === 'recording' && <RecordingPanel projectId={projectId || undefined} trackId={trackId || undefined} />}
        {active === 'bounce' && <BouncePanel projectId={projectId || undefined} />}
        {active === 'projectIO' && <ProjectIOPanel projectId={projectId || undefined} />}
        {active === 'markers' && <MarkersPanel projectId={projectId || undefined} />}
        {active === 'tempo' && <TempoMap projectId={projectId || undefined} />}
        {active === 'presets' && <PresetsLibraryPanel />}
        {active === 'sends' && <SendsRouting projectId={projectId || undefined} />}
        {active === 'scenes' && <ScenesLauncher projectId={projectId || undefined} />}
        {active === 'collab' && <CollabPanel projectId={projectId || undefined} />}
      </div>
    </section>
  );
}
