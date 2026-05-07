'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api, apiHelpers } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { VoiceRecorder } from '@/components/voice/VoiceRecorder';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  Square,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Star,
  Trash2,
  Edit3,
  Check,
  X,
  Save,
  FileText,
  Activity,
  Clock,
  HardDrive,
  Sliders,
  Zap,
  Radio,
  Award,
  GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';

type RecordingStatus = 'ready' | 'recording' | 'processing';
type ExportFormat = 'wav' | 'mp3' | 'flac';

interface Take {
  id: string;
  number: number;
  name: string;
  duration: number;
  timestamp: Date;
  starred: boolean;
  isBest: boolean;
  waveformHeights: number[];
  transcript: string | null;
}

interface EffectNode {
  id: string;
  name: string;
  enabled: boolean;
  paramLabel: string;
  paramValue: number;
  paramMin: number;
  paramMax: number;
  paramUnit: string;
}

type ProcessingPreset = 'raw' | 'podcast' | 'vocal' | 'broadcast';

const PRESET_CONFIGS: Record<ProcessingPreset, Record<string, { enabled: boolean; value: number }>> = {
  raw: {
    'noise-gate': { enabled: false, value: -60 },
    compressor: { enabled: false, value: 4 },
    eq: { enabled: false, value: 0 },
    'de-esser': { enabled: false, value: 4 },
    reverb: { enabled: false, value: 10 },
  },
  podcast: {
    'noise-gate': { enabled: true, value: -40 },
    compressor: { enabled: true, value: 6 },
    eq: { enabled: true, value: 3 },
    'de-esser': { enabled: true, value: 6 },
    reverb: { enabled: false, value: 10 },
  },
  vocal: {
    'noise-gate': { enabled: true, value: -45 },
    compressor: { enabled: true, value: 4 },
    eq: { enabled: true, value: 5 },
    'de-esser': { enabled: true, value: 5 },
    reverb: { enabled: true, value: 25 },
  },
  broadcast: {
    'noise-gate': { enabled: true, value: -35 },
    compressor: { enabled: true, value: 8 },
    eq: { enabled: true, value: 2 },
    'de-esser': { enabled: true, value: 7 },
    reverb: { enabled: false, value: 5 },
  },
};

const generateWaveform = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => Math.sin(i * 0.5) * 0.35 + 0.5);

const INITIAL_TAKES: Take[] = [];

const DEFAULT_EFFECTS: EffectNode[] = [
  { id: 'noise-gate', name: 'Noise Gate', enabled: false, paramLabel: 'Threshold', paramValue: -40, paramMin: -80, paramMax: 0, paramUnit: 'dB' },
  { id: 'compressor', name: 'Compressor', enabled: false, paramLabel: 'Ratio', paramValue: 4, paramMin: 1, paramMax: 20, paramUnit: ':1' },
  { id: 'eq', name: 'EQ', enabled: false, paramLabel: 'Presence', paramValue: 0, paramMin: -12, paramMax: 12, paramUnit: 'dB' },
  { id: 'de-esser', name: 'De-esser', enabled: false, paramLabel: 'Intensity', paramValue: 4, paramMin: 0, paramMax: 10, paramUnit: '' },
  { id: 'reverb', name: 'Reverb', enabled: false, paramLabel: 'Mix', paramValue: 10, paramMin: 0, paramMax: 100, paramUnit: '%' },
];

const DEFAULT_INPUTS = [
  { id: 'default', label: 'Built-in Microphone' },
];

export default function VoiceLensPage() {
  useLensNav('voice');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('voice');
  const queryClient = useQueryClient();

  // Recording state
  const [status, setStatus] = useState<RecordingStatus>('ready');
  const [recordingTime, setRecordingTime] = useState(0);
  const [sessionTime, setSessionTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Takes
  const [takes, setTakes] = useState<Take[]>([]);
  const { isLoading, isError: isError, error: error, refetch: refetch, items: takeItems, create: createTake } = useLensData<Take>('voice', 'take', {
    seed: INITIAL_TAKES.map(t => ({ title: t.name, data: t as unknown as Record<string, unknown> })),
  });
  const [activeTakeId, setActiveTakeId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Processing
  const [effects, setEffects] = useState<EffectNode[]>(DEFAULT_EFFECTS);
  const [activePreset, setActivePreset] = useState<ProcessingPreset>('raw');

  // Transcription
  const [editingTranscript, setEditingTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState('');

  // Input
  const [selectedInput, setSelectedInput] = useState('default');

  // Waveform animation
  const [waveformBars, setWaveformBars] = useState<number[]>(() =>
    Array.from({ length: 48 }, () => 0.1)
  );
  const animFrameRef = useRef<number>();

  // Level meters
  const [levelL, setLevelL] = useState(0);
  const [levelR, setLevelR] = useState(0);

  const runVoiceAction = useRunArtifact('voice');
  const [voiceActionResult, setVoiceActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [voiceActiveAction, setVoiceActiveAction] = useState<string | null>(null);

  const handleVoiceAction = useCallback(async (action: string) => {
    const id = takeItems[0]?.id;
    if (!id) return;
    setVoiceActiveAction(action);
    try {
      const res = await runVoiceAction.mutateAsync({ id, action });
      if (res.ok) setVoiceActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setVoiceActiveAction(null);
    }
  }, [takeItems, runVoiceAction]);

  // Real recording refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const takeBlobsRef = useRef<Map<string, Blob>>(new Map());
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  // Sync backend take items into local state
  useEffect(() => {
    if (takeItems.length > 0 && takes.length === 0) {
      setTakes(takeItems.map(i => ({ ...(i.data as unknown as Take), id: i.id })));
    }
  }, [takeItems, takes.length]);

  const activeTake = takes.find((t) => t.id === activeTakeId) || null;

  // Session timer
  useEffect(() => {
    const iv = setInterval(() => setSessionTime((p) => p + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  // Recording timer
  useEffect(() => {
    if (status !== 'recording') return;
    const iv = setInterval(() => setRecordingTime((p) => p + 1), 1000);
    return () => clearInterval(iv);
  }, [status]);

  // Waveform + level animation while recording
  useEffect(() => {
    if (status !== 'recording') {
      setWaveformBars(Array.from({ length: 48 }, () => 0.1));
      setLevelL(0);
      setLevelR(0);
      return;
    }
    let running = true;
    const animate = () => {
      if (!running) return;
      const now = Date.now();
      setWaveformBars(
        Array.from({ length: 48 }, (_, i) =>
          Math.max(0.08, Math.min(1, 0.3 + Math.sin(now / 180 + i * 0.35) * 0.25 + Math.sin(now / 120 + i * 0.7) * 0.2 + Math.cos(now / 90 + i * 0.5) * 0.15))
        )
      );
      setLevelL(0.4 + Math.sin(now / 150) * 0.25 + Math.cos(now / 200) * 0.2);
      setLevelR(0.35 + Math.cos(now / 170) * 0.25 + Math.sin(now / 230) * 0.2);
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animate();
    return () => {
      running = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [status]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatTimestamp = (d: Date) => {
    const h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
  };

  // Transport handlers — wired to real MediaRecorder
  const handleRecord = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      recordedChunksRef.current = [];
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setStatus('recording');
      setRecordingTime(0);
    } catch (err) {
      console.error('[Voice] Mic access failed:', err);
      useUIStore.getState().addToast({ type: 'error', message: 'Microphone access denied' });
    }
  }, []);

  const handleStop = useCallback(() => {
    if (status === 'recording' && mediaRecorderRef.current) {
      setStatus('processing');
      const recorder = mediaRecorderRef.current;
      const takeId = `take-${Date.now()}`;
      const takeNum = takes.length + 1;
      const duration = recordingTime;

      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'audio/webm' });
        takeBlobsRef.current.set(takeId, blob);

        // Upload to backend
        const reader = new FileReader();
        reader.onloadend = async () => {
          const base64 = (reader.result as string).split(',')[1];
          try {
            await api.post('/api/media/upload', {
              title: `Take ${takeNum}`,
              mediaType: 'audio',
              mimeType: 'audio/webm',
              fileSize: blob.size,
              originalFilename: `voice-take-${takeNum}-${Date.now()}.webm`,
              tags: ['voice', 'recording'],
              privacy: 'private',
              duration,
              data: base64,
            });
          } catch (err) {
            console.error('[Voice] Upload failed:', err);
          }
        };
        reader.readAsDataURL(blob);

        const newTake: Take = {
          id: takeId,
          number: takeNum,
          name: `Take ${takeNum}`,
          duration,
          timestamp: new Date(),
          starred: false,
          isBest: false,
          waveformHeights: generateWaveform(16),
          transcript: null,
        };
        setTakes((prev) => [...prev, newTake]);
        setActiveTakeId(takeId);
        createTake({ title: `Take ${takeNum}`, data: newTake as unknown as Record<string, unknown> });
        setStatus('ready');
      };
      recorder.stop();

      // Stop mic stream
      mediaStreamRef.current?.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
      mediaRecorderRef.current = null;
    } else {
      // Stop playback
      if (playbackAudioRef.current) {
        playbackAudioRef.current.pause();
        playbackAudioRef.current = null;
      }
      setIsPlaying(false);
    }
  }, [status, recordingTime, takes.length, createTake]);

  const handlePlayPause = useCallback(() => {
    if (status === 'recording') return;
    if (!activeTakeId) return;
    if (isPlaying) {
      playbackAudioRef.current?.pause();
      playbackAudioRef.current = null;
      setIsPlaying(false);
    } else {
      const blob = takeBlobsRef.current.get(activeTakeId);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => { setIsPlaying(false); playbackAudioRef.current = null; };
        audio.play().catch(() => { setIsPlaying(false); });
        playbackAudioRef.current = audio;
        setIsPlaying(true);
      }
    }
  }, [status, activeTakeId, isPlaying]);

  // Take actions
  const toggleStar = (id: string) =>
    setTakes((prev) => prev.map((t) => (t.id === id ? { ...t, starred: !t.starred } : t)));

  const deleteTake = (id: string) => {
    setTakes((prev) => prev.filter((t) => t.id !== id));
    if (activeTakeId === id) setActiveTakeId(null);
  };

  const startRename = (take: Take) => {
    setRenamingId(take.id);
    setRenameValue(take.name);
  };

  const confirmRename = () => {
    if (renamingId && renameValue.trim()) {
      setTakes((prev) =>
        prev.map((t) => (t.id === renamingId ? { ...t, name: renameValue.trim() } : t))
      );
    }
    setRenamingId(null);
  };

  const markBest = (id: string) =>
    setTakes((prev) =>
      prev.map((t) => ({ ...t, isBest: t.id === id }))
    );

  // Effects
  const toggleEffect = (id: string) =>
    setEffects((prev) =>
      prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e))
    );

  const setEffectParam = (id: string, value: number) =>
    setEffects((prev) =>
      prev.map((e) => (e.id === id ? { ...e, paramValue: value } : e))
    );

  const applyPreset = (preset: ProcessingPreset) => {
    setActivePreset(preset);
    const cfg = PRESET_CONFIGS[preset];
    setEffects((prev) =>
      prev.map((e) => {
        const pc = cfg[e.id];
        return pc ? { ...e, enabled: pc.enabled, paramValue: pc.value } : e;
      })
    );
  };

  // Transcription / Save
  const handleTranscribe = async (audioBlob: Blob): Promise<string> => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');
    const res = await apiHelpers.voice.transcribe(formData);
    return res.data?.transcript || res.data?.text || '';
  };

  const saveMutation = useMutation({
    mutationFn: async ({ transcript, audioBlob }: { transcript?: string; audioBlob?: Blob }) => {
      const formData = new FormData();
      // Use actual recorded audio blob if available, otherwise send transcript-only
      if (audioBlob && audioBlob.size > 0) {
        formData.append('audio', audioBlob, 'recording.webm');
      }
      if (transcript) formData.append('transcript', transcript);
      return apiHelpers.voice.ingest(formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dtus'] });
    },
    onError: (err) => {
      console.error('Failed to save voice DTU:', err);
    },
  });

  const handleSaveDTU = () => {
    if (activeTake?.transcript) {
      saveMutation.mutate({ transcript: activeTake.transcript });
    }
  };

  // Stats
  const totalDuration = takes.reduce((s, t) => s + t.duration, 0);
  const estimatedStorage = takes.reduce((s, t) => s + t.duration * 176, 0);
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };


  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }
  return (
    <div data-lens-theme="voice" className="h-[calc(100vh-4rem)] flex flex-col bg-gradient-to-b from-purple-900/10 to-black">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-lattice-border bg-black/40">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-neon-pink/20 flex items-center justify-center">
            <Mic className="w-5 h-5 text-neon-pink" />
          </div>
          <div>
            <h1 className="text-lg font-bold">Recording Booth</h1>
            <p className="text-xs text-gray-500">Voice capture and processing studio</p>
          </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="voice" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
        </div>
        <div className="flex items-center gap-4">
          {/* Input selector */}
          <div className="flex items-center gap-2">
            <Mic className="w-3.5 h-3.5 text-gray-400" />
            <select
              value={selectedInput}
              onChange={(e) => setSelectedInput(e.target.value)}
              className="bg-white/5 border border-lattice-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-neon-cyan/50"
            >
              {DEFAULT_INPUTS.map((inp) => (
                <option key={inp.id} value={inp.id} className="bg-lattice-surface">
                  {inp.label}
                </option>
              ))}
            </select>
          </div>
          {/* Session timer */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 rounded-lg">
            <Clock className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-mono text-gray-300">Session {formatTime(sessionTime)}</span>
          </div>
        </div>
      </header>

      {/* Main three-column layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar - Take management */}
        <aside className="w-72 flex-shrink-0 border-r border-lattice-border bg-black/30 flex flex-col">
          <div className="px-4 py-3 border-b border-lattice-border flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-300">Takes</h2>
            <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Select two takes to compare' })} className="text-xs text-neon-cyan hover:text-neon-cyan/80 flex items-center gap-1">
              <GitCompare className="w-3 h-3" />
              Compare
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {takes.map((take) => (
              <div
                key={take.id}
                onClick={() => setActiveTakeId(take.id)}
                className={cn(
                  'px-4 py-3 border-b border-white/5 cursor-pointer transition-colors group',
                  activeTakeId === take.id
                    ? 'bg-neon-cyan/5 border-l-2 border-l-neon-cyan'
                    : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                )}
              >
                <div className="flex items-center justify-between mb-1.5">
                  {renamingId === take.id ? (
                    <div className="flex items-center gap-1 flex-1 mr-2">
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && confirmRename()}
                        className="flex-1 bg-white/10 border border-lattice-border rounded px-2 py-0.5 text-xs focus:outline-none"
                        autoFocus
                      />
                      <button onClick={confirmRename} className="text-neon-cyan">
                        <Check className="w-3 h-3" />
                      </button>
                      <button onClick={() => setRenamingId(null)} className="text-gray-500">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-medium truncate">{take.name}</span>
                      {take.isBest && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-neon-pink/15 text-neon-pink text-[10px] rounded-full font-semibold whitespace-nowrap">
                          <Award className="w-2.5 h-2.5" />
                          Best
                        </span>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleStar(take.id); }}
                      className={cn('p-1 rounded', take.starred ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400')}
                    >
                      <Star className={cn('w-3 h-3', take.starred && 'fill-current')} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); startRename(take); }}
                      className="p-1 rounded text-gray-600 hover:text-gray-300"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); markBest(take.id); }}
                      className="p-1 rounded text-gray-600 hover:text-neon-pink"
                    >
                      <Award className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteTake(take.id); }}
                      className="p-1 rounded text-gray-600 hover:text-red-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-2">
                  <span>{formatTime(take.duration)}</span>
                  <span>{formatTimestamp(take.timestamp)}</span>
                </div>
                {/* Waveform thumbnail */}
                <div className="flex items-end gap-[2px] h-5">
                  {take.waveformHeights.map((h, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex-1 rounded-sm transition-colors',
                        activeTakeId === take.id ? 'bg-neon-cyan/60' : 'bg-gray-700'
                      )}
                      style={{ height: `${h * 100}%` }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {takes.length === 0 && (
              <div className="p-6 text-center text-gray-600 text-sm">
                No takes yet. Press record to begin.
              </div>
            )}
          </div>
        </aside>

        {/* Center - Main recording area */}
        <main className="flex-1 flex flex-col items-center justify-between py-6 px-4 overflow-y-auto">
          {/* Status indicator */}
          <div className="flex items-center gap-2 mb-4">
            <div
              className={cn(
                'w-2.5 h-2.5 rounded-full',
                status === 'ready' && 'bg-green-500',
                status === 'recording' && 'bg-red-500 animate-pulse',
                status === 'processing' && 'bg-yellow-500 animate-pulse'
              )}
            />
            <span
              className={cn(
                'text-sm font-medium uppercase tracking-wider',
                status === 'ready' && 'text-green-400',
                status === 'recording' && 'text-red-400',
                status === 'processing' && 'text-yellow-400'
              )}
            >
              {status === 'ready' ? 'Ready' : status === 'recording' ? 'Recording' : 'Processing'}
            </span>
          </div>

          {/* Record button */}
          <motion.button
            onClick={status === 'recording' ? handleStop : handleRecord}
            disabled={status === 'processing'}
            className={cn(
              'relative w-28 h-28 rounded-full flex items-center justify-center transition-colors mb-6',
              status === 'recording'
                ? 'bg-red-500/20 border-2 border-red-500'
                : status === 'processing'
                  ? 'bg-yellow-500/10 border-2 border-yellow-500/50 cursor-not-allowed'
                  : 'bg-red-500/10 border-2 border-red-500/60 hover:bg-red-500/20'
            )}
            whileTap={status !== 'processing' ? { scale: 0.95 } : undefined}
          >
            {status === 'recording' && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-red-500/40"
                animate={{ scale: [1, 1.3, 1], opacity: [0.6, 0, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
            {status === 'recording' ? (
              <Square className="w-10 h-10 text-red-400 fill-red-400" />
            ) : status === 'processing' ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              >
                <Activity className="w-10 h-10 text-yellow-400" />
              </motion.div>
            ) : (
              <div className="w-14 h-14 rounded-full bg-red-500" />
            )}
          </motion.button>

          {/* Recording timer */}
          <div className="text-4xl font-mono text-white mb-6">
            {status === 'recording' ? (
              <span className="text-red-400">{formatTime(recordingTime)}</span>
            ) : (
              <span className="text-gray-500">{formatTime(activeTake?.duration || 0)}</span>
            )}
          </div>

          {/* Waveform visualization */}
          <div className="w-full max-w-2xl h-28 flex items-center justify-center gap-[3px] mb-6 px-4">
            {waveformBars.map((h, i) => (
              <motion.div
                key={i}
                className={cn(
                  'w-[6px] rounded-full',
                  status === 'recording' ? 'bg-neon-cyan' : 'bg-gray-700'
                )}
                animate={{ height: `${h * 100}%` }}
                transition={{ duration: 0.08, ease: 'easeOut' }}
                style={{ minHeight: 4 }}
              />
            ))}
          </div>

          {/* Level meters */}
          <div className="flex items-center gap-4 mb-6">
            <span className="text-[10px] text-gray-500 font-mono w-4 text-right">L</span>
            <div className="w-48 h-3 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
                animate={{ width: `${levelL * 100}%` }}
                transition={{ duration: 0.06 }}
              />
            </div>
            <div className="w-48 h-3 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-purple"
                animate={{ width: `${levelR * 100}%` }}
                transition={{ duration: 0.06 }}
              />
            </div>
            <span className="text-[10px] text-gray-500 font-mono w-4">R</span>
          </div>

          {/* Transport controls */}
          <div className="flex items-center gap-3 mb-8">
            <button
              onClick={() => {
                if (takes.length === 0) return;
                const currentIdx = takes.findIndex(t => t.id === activeTakeId);
                const prevIdx = currentIdx > 0 ? currentIdx - 1 : takes.length - 1;
                setActiveTakeId(takes[prevIdx].id);
              }}
              disabled={takes.length === 0}
              className={cn('p-2.5 rounded-full bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors', takes.length === 0 && 'opacity-40 cursor-not-allowed')}
            >
              <SkipBack className="w-5 h-5" />
            </button>
            <button
              onClick={status === 'recording' ? handleStop : status === 'processing' ? undefined : handleRecord}
              disabled={status === 'processing'}
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
                status === 'recording'
                  ? 'bg-white/10 text-white hover:bg-white/20'
                  : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
              )}
            >
              {status === 'recording' ? (
                <Square className="w-5 h-5 fill-current" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-red-500" />
              )}
            </button>
            <button
              onClick={handlePlayPause}
              disabled={status === 'recording'}
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center transition-colors',
                'bg-white/10 text-white hover:bg-white/20',
                status === 'recording' && 'opacity-40 cursor-not-allowed'
              )}
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            <button
              onClick={() => {
                if (takes.length === 0) return;
                const currentIdx = takes.findIndex(t => t.id === activeTakeId);
                const nextIdx = currentIdx < takes.length - 1 ? currentIdx + 1 : 0;
                setActiveTakeId(takes[nextIdx].id);
              }}
              disabled={takes.length === 0}
              className={cn('p-2.5 rounded-full bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors', takes.length === 0 && 'opacity-40 cursor-not-allowed')}
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>

          {/* Hidden VoiceRecorder - keeps functional hook available */}
          <div className="hidden">
            <VoiceRecorder onTranscribe={handleTranscribe} maxDuration={600} />
          </div>
        </main>

        {/* Right sidebar - Processing chain */}
        <aside className="w-72 flex-shrink-0 border-l border-lattice-border bg-black/30 flex flex-col">
          <div className="px-4 py-3 border-b border-lattice-border">
            <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <Sliders className="w-3.5 h-3.5" />
              Processing Chain
            </h2>
          </div>

          {/* Presets */}
          <div className="px-4 py-3 border-b border-white/5">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider block mb-2">Preset</label>
            <div className="grid grid-cols-2 gap-1.5">
              {(['raw', 'podcast', 'vocal', 'broadcast'] as ProcessingPreset[]).map((preset) => (
                <button
                  key={preset}
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors',
                    activePreset === preset
                      ? 'bg-neon-purple/20 text-neon-purple border border-neon-purple/30'
                      : 'bg-white/5 text-gray-400 hover:text-white border border-transparent'
                  )}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>

          {/* Effect chain */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {effects.map((fx, idx) => (
              <div key={fx.id} className="bg-white/[0.03] border border-white/5 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-600 font-mono">{idx + 1}</span>
                    <span className="text-sm font-medium">{fx.name}</span>
                  </div>
                  <button
                    onClick={() => toggleEffect(fx.id)}
                    className={cn(
                      'w-9 h-5 rounded-full transition-colors relative',
                      fx.enabled ? 'bg-neon-cyan' : 'bg-gray-700'
                    )}
                  >
                    <motion.div
                      className="w-4 h-4 rounded-full bg-white absolute top-0.5"
                      animate={{ left: fx.enabled ? 18 : 2 }}
                      transition={{ duration: 0.15 }}
                    />
                  </button>
                </div>
                <AnimatePresence>
                  {fx.enabled && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="pt-1">
                        <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                          <span>{fx.paramLabel}</span>
                          <span className="font-mono">
                            {fx.paramValue}{fx.paramUnit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={fx.paramMin}
                          max={fx.paramMax}
                          value={fx.paramValue}
                          onChange={(e) => setEffectParam(fx.id, Number(e.target.value))}
                          className="w-full h-1 accent-neon-cyan"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          {/* Apply processing */}
          <div className="px-4 py-3 border-t border-lattice-border">
            <button onClick={() => useUIStore.getState().addToast({ type: 'success', message: 'Processing applied to current take' })} className="w-full py-2 bg-neon-purple/20 text-neon-purple rounded-lg text-sm font-medium hover:bg-neon-purple/30 transition-colors flex items-center justify-center gap-2">
              <Zap className="w-4 h-4" />
              Apply Processing
            </button>
          </div>
        </aside>
      </div>

      {/* Bottom section - Transcription + Export */}
      <div className="border-t border-lattice-border bg-black/40">
        <div className="flex items-stretch">
          {/* Transcription panel */}
          <div className="flex-1 p-4 border-r border-white/5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                Transcription
              </h3>
              {activeTake?.transcript && (
                <button
                  onClick={() => {
                    if (editingTranscript) {
                      setTakes((prev) =>
                        prev.map((t) =>
                          t.id === activeTakeId ? { ...t, transcript: transcriptDraft } : t
                        )
                      );
                      setEditingTranscript(false);
                    } else {
                      setTranscriptDraft(activeTake.transcript || '');
                      setEditingTranscript(true);
                    }
                  }}
                  className="text-xs text-neon-cyan hover:text-neon-cyan/80 flex items-center gap-1"
                >
                  {editingTranscript ? <Check className="w-3 h-3" /> : <Edit3 className="w-3 h-3" />}
                  {editingTranscript ? 'Save' : 'Edit'}
                </button>
              )}
            </div>
            {activeTake ? (
              editingTranscript ? (
                <textarea
                  value={transcriptDraft}
                  onChange={(e) => setTranscriptDraft(e.target.value)}
                  className="w-full h-16 bg-white/5 border border-lattice-border rounded-lg p-2 text-xs text-gray-300 resize-none focus:outline-none focus:border-neon-cyan/50"
                />
              ) : activeTake.transcript ? (
                <p className="text-xs text-gray-400 line-clamp-3">{activeTake.transcript}</p>
              ) : (
                <p className="text-xs text-gray-600 italic">No transcript available. Process take to generate.</p>
              )
            ) : (
              <p className="text-xs text-gray-600 italic">Select a take to view its transcription.</p>
            )}
          </div>

          {/* Export + Save */}
          <div className="flex items-center gap-3 px-4">
            <button
              onClick={handleSaveDTU}
              disabled={!activeTake?.transcript || saveMutation.isPending}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-colors',
                activeTake?.transcript
                  ? 'bg-neon-cyan/20 text-neon-cyan hover:bg-neon-cyan/30'
                  : 'bg-white/5 text-gray-600 cursor-not-allowed'
              )}
            >
              <Save className="w-3.5 h-3.5" />
              {saveMutation.isPending ? 'Saving...' : 'Save as DTU'}
            </button>
            <div className="h-8 w-px bg-white/10" />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-500 mr-1">Export:</span>
              {(['wav', 'mp3', 'flac'] as ExportFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => useUIStore.getState().addToast({ type: 'success', message: `Exporting as ${fmt.toUpperCase()}...` })}
                  className="px-2.5 py-1.5 bg-white/5 rounded text-[10px] font-mono uppercase text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Voice Actions Panel */}
      <div className="px-4 py-3 border-t border-lattice-border bg-black/40">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-3 h-3 text-neon-purple" />
            Voice Actions
          </h3>
          {voiceActionResult && (
            <button onClick={() => setVoiceActionResult(null)} className="p-0.5 rounded hover:bg-lattice-elevated text-gray-400">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-2">
          {(['transcriptAnalyze', 'speakerDiarize', 'sentimentScore', 'keywordSpot'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleVoiceAction(action)}
              disabled={!takeItems[0]?.id || voiceActiveAction !== null}
              className="px-2.5 py-1 text-xs rounded-lg bg-neon-purple/10 text-neon-purple border border-neon-purple/30 hover:bg-neon-purple/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {voiceActiveAction === action ? (
                <div className="w-2.5 h-2.5 border border-neon-purple border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'transcriptAnalyze' ? 'Transcript' : action === 'speakerDiarize' ? 'Diarize' : action === 'sentimentScore' ? 'Sentiment' : 'Keywords'}
            </button>
          ))}
        </div>
        {voiceActionResult && (
          <div className="bg-lattice-surface border border-lattice-border rounded p-2 space-y-1 text-xs">
            {voiceActionResult.action === 'transcriptAnalyze' && (() => {
              const r = voiceActionResult.result;
              return (
                <div className="flex flex-wrap gap-3">
                  <span className="text-gray-400">Words: <span className="text-white">{String(r.wordCount ?? 0)}</span></span>
                  <span className="text-gray-400">WPM: <span className="text-white">{String(r.wpm ?? 0)}</span></span>
                  <span className="text-gray-400">Sentences: <span className="text-white">{String(r.sentences ?? 0)}</span></span>
                  <span className="text-gray-400">Filler Words: <span className="text-white">{String(r.fillerWords ?? 0)}</span></span>
                  <span className="text-gray-400">Duration: <span className="text-white">{String(r.durationSeconds ?? 0)}s</span></span>
                </div>
              );
            })()}
            {voiceActionResult.action === 'speakerDiarize' && (() => {
              const r = voiceActionResult.result;
              const speakers = Array.isArray(r.speakers) ? r.speakers as Array<Record<string, unknown>> : [];
              return (
                <div className="space-y-1">
                  <span className="text-gray-400">Speakers: <span className="text-white">{String(r.speakerCount ?? 0)}</span></span>
                  {speakers.slice(0, 3).map((s, i) => (
                    <div key={i} className="flex justify-between bg-lattice-elevated px-2 py-0.5 rounded">
                      <span className="text-gray-300">{String(s.label ?? `Speaker ${i + 1}`)}</span>
                      <span className="text-gray-400">{String(s.duration ?? 0)}s ({String(s.share ?? 0)}%)</span>
                    </div>
                  ))}
                </div>
              );
            })()}
            {voiceActionResult.action === 'sentimentScore' && (() => {
              const r = voiceActionResult.result;
              const score = Number(r.score ?? 0);
              const scoreColor = score > 0.3 ? 'text-neon-green' : score < -0.3 ? 'text-red-400' : 'text-gray-300';
              return (
                <div className="flex flex-wrap gap-3">
                  <span className="text-gray-400">Overall: <span className={`font-semibold ${scoreColor}`}>{String(r.label ?? 'neutral')}</span></span>
                  <span className="text-gray-400">Score: <span className="text-white">{score.toFixed(2)}</span></span>
                  <span className="text-gray-400">Confidence: <span className="text-white">{String(r.confidence ?? 0)}</span></span>
                </div>
              );
            })()}
            {voiceActionResult.action === 'keywordSpot' && (() => {
              const r = voiceActionResult.result;
              const keywords = Array.isArray(r.keywords) ? r.keywords as Array<Record<string, unknown>> : [];
              return (
                <div className="flex flex-wrap gap-1">
                  {keywords.slice(0, 8).map((kw, i) => (
                    <span key={i} className="bg-neon-purple/20 text-neon-purple px-1.5 py-0.5 rounded text-xs">
                      {String(kw.word ?? kw)} ({String(kw.count ?? kw.frequency ?? 1)})
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Stats bar */}
      <div className="flex items-center justify-between px-6 py-2 border-t border-lattice-border bg-black/60 text-[11px] text-gray-500">
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-1.5">
            <Radio className="w-3 h-3" />
            {takes.length} take{takes.length !== 1 ? 's' : ''} recorded
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            {formatTime(totalDuration)} total
          </span>
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3 h-3" />
            {formatBytes(estimatedStorage)} est.
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Activity className="w-3 h-3" />
          <span>48kHz / 24-bit</span>
        </div>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <>
          <UniversalActions domain="voice" artifactId={null} compact />
          <RealtimeDataPanel
            domain="voice"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </>
      )}
      </div>
    </div>
  );
}
