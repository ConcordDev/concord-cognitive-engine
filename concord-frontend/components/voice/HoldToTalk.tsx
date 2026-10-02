'use client';

/** Voice north star — the booth. Take count is the persisted take list. */

import { useEffect, useRef, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, northPage } from '@/components/lens/NorthStarChrome';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

const SILENCE_MS = 1200;
const SILENCE_LEVEL = 8;

export function HoldToTalk({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('voice');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const { items, isLoading, isError, error, create, refetch } = useLensData<Record<string, unknown>>('voice', 'take', { noSeed: true, limit: 100 });
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [localError, setLocalError] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef(0);
  const silentSince = useRef<number | null>(null);

  const stop = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close();
  }, []);

  const record = async () => {
    if (recording) {
      stop();
      return;
    }
    const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if (!getUserMedia || typeof MediaRecorder === 'undefined') {
      setLocalError('No microphone on this device.');
      return;
    }
    setLocalError('');
    try {
      const stream = await getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const duration = Math.max(0, Math.round((Date.now() - startedAt.current) / 1000));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        cancelAnimationFrame(rafRef.current);
        void audioCtxRef.current?.close();
        audioCtxRef.current = null;
        setLevel(0);
        setRecording(false);
        const number = items.length + 1;
        void create({
          title: `Take ${number}`,
          data: { number, name: `Take ${number}`, duration, timestamp: new Date().toISOString() },
        }).then(() => refetch()).catch((err: unknown) => {
          setLocalError(err instanceof Error ? err.message : 'The take was not saved.');
        });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = String(reader.result || '').split(',')[1];
          if (!base64) return;
          void api.post('/api/media/upload', {
            title: `Take ${number}`,
            mediaType: 'audio',
            mimeType: blob.type || 'audio/webm',
            fileSize: blob.size,
            originalFilename: `voice-take-${number}.webm`,
            tags: ['voice', 'recording'],
            privacy: 'private',
            duration,
            data: base64,
          }).catch(() => { /* the take artifact is the count; upload failure stays quiet */ });
        };
        reader.readAsDataURL(blob);
      };
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        const bins = new Uint8Array(analyser.frequencyBinCount);
        const tick = (now: number) => {
          analyser.getByteFrequencyData(bins);
          let sum = 0;
          for (const n of bins) sum += n;
          const avg = bins.length ? sum / bins.length : 0;
          setLevel(Math.min(1, avg / 64));
          if (avg < SILENCE_LEVEL) {
            if (silentSince.current == null) silentSince.current = now;
            else if (now - silentSince.current > SILENCE_MS) {
              stop();
              return;
            }
          } else {
            silentSince.current = null;
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        silentSince.current = null;
        rafRef.current = requestAnimationFrame(tick);
      }
      startedAt.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Microphone access denied.');
    }
  };

  const loadError = isError ? (error instanceof Error ? error.message : 'The takes did not answer.') : '';
  const count = items.length;

  return (
    <LensShell lensId="voice" asMain={false} disableAgentFab>
      <div data-lens-theme="voice" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Voice" title={who ? `Hold to talk, ${who}` : 'Hold to talk'} />
          <QuietMore
            items={[
              { id: 'booth', label: 'Booth' },
              { id: 'transcripts', label: 'Transcripts' },
              { id: 'meetings', label: 'Meetings' },
              { id: 'library', label: 'Library' },
              { id: 'analyze', label: 'Analyze' },
            ]}
            onPick={onOpenDesk}
          />
        </div>
        <FamilyPill
          label="Voice"
          active="voice"
          items={[
            { id: 'chat', label: 'Chat', href: '/lenses/chat' },
            { id: 'voice', label: 'Voice', href: '/lenses/voice' },
            { id: 'daily', label: 'Daily', href: '/lenses/daily' },
          ]}
        />

        {(loadError || localError) && <NorthError message={localError || loadError} />}

        {!isLoading && !isError && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-center" data-testid="voice-booth">
            <span className="inline-flex rounded-full border border-white/10 px-2.5 py-0.5 text-[12px] text-zinc-300">
              Built-in microphone · {count} {count === 1 ? 'take' : 'takes'}
            </span>
            <div className="mx-auto mt-4 h-1.5 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden>
              <div className="h-full bg-teal-400" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <p className="mt-4 text-[14px] text-zinc-400">The meter moves when the mic does. Silence pauses it.</p>
          </div>
        )}

        <button type="button" className={northCtaClass} onClick={() => void record()}>{recording ? 'Stop' : 'Record'}</button>
      </div>
    </LensShell>
  );
}
