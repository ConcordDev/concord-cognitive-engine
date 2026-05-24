'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  Square,
  Trash2,
  Upload,
  Loader2,
  CheckCircle,
  AlertCircle,
  Volume2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { showToast } from '@/components/common/Toasts';

interface VoiceRecorderProps {
  onTranscribe?: (audioBlob: Blob) => Promise<string>;
  onSave?: (audioBlob: Blob, transcript?: string) => void;
  maxDuration?: number; // seconds
  className?: string;
}

type RecordingState = 'idle' | 'recording' | 'paused' | 'stopped' | 'transcribing';

export function VoiceRecorder({
  onTranscribe,
  onSave,
  maxDuration = 300, // 5 minutes default
  className
}: VoiceRecorderProps) {
  const [state, setState] = useState<RecordingState>('idle');
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioBlobRef = useRef<Blob | null>(null);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Close any previous AudioContext before creating a new one
      if (audioContextRef.current) {
        audioContextRef.current.close().catch((e) => { console.error('[VoiceRecorder] Failed to close AudioContext:', e); showToast('error', 'Audio error'); });
      }

      // Set up audio analyzer for visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Visualize audio level
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average / 255);
          animationFrameRef.current = requestAnimationFrame(updateLevel);
        }
      };
      updateLevel();

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        audioBlobRef.current = blob;
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        stream.getTracks().forEach(track => track.stop());
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (audioContextRef.current) {
          audioContextRef.current.close().catch((e) => { console.error('[VoiceRecorder] Failed to close AudioContext:', e); showToast('error', 'Audio error'); });
          audioContextRef.current = null;
        }
        setAudioLevel(0);
      };

      mediaRecorder.start(100);
      setState('recording');
      setDuration(0);

      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(prev => {
          if (prev >= maxDuration) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      setError('Could not access microphone. Please check permissions.');
      console.error('Recording error:', err);
    }
  };

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('stopped');
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [state]);

  const discardRecording = () => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }
    setAudioUrl(null);
    setTranscript(null);
    audioBlobRef.current = null;
    setState('idle');
    setDuration(0);
  };

  const handleTranscribe = async () => {
    if (!audioBlobRef.current || !onTranscribe) return;

    setState('transcribing');
    try {
      const text = await onTranscribe(audioBlobRef.current);
      setTranscript(text);
      setState('stopped');
    } catch {
      setError('Transcription failed. Please try again.');
      setState('stopped');
    }
  };

  const handleSave = () => {
    if (audioBlobRef.current && onSave) {
      onSave(audioBlobRef.current, transcript || undefined);
      discardRecording();
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (audioContextRef.current) {
        audioContextRef.current.close().catch((e) => { console.error('[VoiceRecorder] Failed to close AudioContext:', e); showToast('error', 'Audio error'); });
        audioContextRef.current = null;
      }
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  return (
    <div className={cn('bg-lattice-surface border border-lattice-border rounded-xl p-6', className)}>
      {/* Waveform visualization */}
      <div className="h-24 mb-6 flex items-center justify-center">
        {state === 'recording' ? (
          <div className="flex items-end gap-1 h-full">
            {Array.from({ length: 20 }).map((_, i) => (
              <motion.div
                key={i}
                className="w-1.5 bg-neon-cyan rounded-full"
                animate={{
                  height: `${Math.max(10, audioLevel * 100 * (0.5 + Math.random() * 0.5))}%`
                }}
                transition={{ duration: 0.1 }}
              />
            ))}
          </div>
        ) : state === 'transcribing' ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-neon-cyan animate-spin" />
            <span className="text-sm text-gray-400">Transcribing...</span>
          </div>
        ) : audioUrl ? (
          <audio src={audioUrl} controls className="w-full max-w-md" />
        ) : (
          <div className="text-center">
            <Mic className="w-12 h-12 text-gray-600 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Click to start recording</p>
          </div>
        )}
      </div>

      {/* Duration */}
      <div className="text-center mb-6">
        <span className={cn(
          'text-3xl font-mono',
          state === 'recording' ? 'text-red-400' : 'text-white'
        )}>
          {formatTime(duration)}
        </span>
        {state === 'recording' && (
          <span className="text-xs text-gray-400 block mt-1">
            / {formatTime(maxDuration)} max
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        {state === 'idle' && (
          <button
            onClick={startRecording}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center"
          aria-label="Microphone">
            <Mic className="w-8 h-8 text-white" />
          </button>
        )}

        {state === 'recording' && (
          <button
            onClick={stopRecording}
            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 transition-colors flex items-center justify-center animate-pulse"
          aria-label="Stop">
            <Square className="w-6 h-6 text-white" />
          </button>
        )}

        {state === 'stopped' && (
          <>
            <button
              onClick={discardRecording}
              className="p-3 bg-lattice-bg border border-lattice-border rounded-full text-gray-400 hover:text-red-400 hover:border-red-400 transition-colors"
              title="Discard"
            >
              <Trash2 className="w-5 h-5" />
            </button>

            {onTranscribe && !transcript && (
              <button
                onClick={handleTranscribe}
                className="px-4 py-2 bg-neon-purple text-white rounded-lg hover:bg-neon-purple/90 transition-colors flex items-center gap-2"
              >
                <Volume2 className="w-4 h-4" />
                Transcribe
              </button>
            )}

            {onSave && (
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-neon-cyan text-black font-medium rounded-lg hover:bg-neon-cyan/90 transition-colors flex items-center gap-2"
              >
                <Upload className="w-4 h-4" />
                Save
              </button>
            )}
          </>
        )}
      </div>

      {/* Transcript */}
      <AnimatePresence>
        {transcript && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-6 overflow-hidden"
          >
            <div className="bg-lattice-bg border border-lattice-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-4 h-4 text-green-400" />
                <span className="text-sm font-medium text-white">Transcript</span>
              </div>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{transcript}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-sm text-red-400">{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
