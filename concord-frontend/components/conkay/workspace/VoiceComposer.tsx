'use client';

/**
 * VoiceComposer — the workspace's bottom bar: one input for typing or
 * speaking to ConKay. The mic state shown is the recogniser's real state
 * (useConKayVoice), the waveform is the microphone's measured level
 * (useMicAmplitude), and "Listening…" appears only while it is listening.
 */

import { useEffect, useRef, useState } from 'react';
import { Loader2, Mic, MicOff, Send } from 'lucide-react';
import { useConKayVoice } from '@/components/conkay/useConKayVoice';
import { useMicAmplitude } from '@/components/conkay/useMicAmplitude';

interface Props {
  busy: boolean;
  onSend: (text: string) => void;
  /** Reply text to speak aloud while voice is on; changes trigger speech. */
  speakText: { id: string; text: string } | null;
}

function Waveform({ levelRef, active }: { levelRef: React.MutableRefObject<number>; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const g = c.getContext('2d');
    if (!g) return;
    const history: number[] = new Array(48).fill(0);
    let raf = 0;
    const draw = () => {
      history.push(active ? levelRef.current : 0);
      history.shift();
      const { width, height } = c;
      g.clearRect(0, 0, width, height);
      const bw = width / history.length;
      for (let i = 0; i < history.length; i++) {
        const h = Math.max(2, Math.min(1, history[i] * 3) * height);
        g.fillStyle = `rgba(56, 189, 248, ${0.35 + 0.65 * (i / history.length)})`;
        g.fillRect(i * bw + 1, (height - h) / 2, Math.max(1, bw - 2), h);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [levelRef, active]);
  return <canvas ref={canvasRef} width={192} height={36} className="h-9 w-32 shrink-0 sm:w-48" aria-hidden />;
}

export function VoiceComposer({ busy, onSend, speakText }: Props) {
  const [text, setText] = useState('');
  const [voiceOn, setVoiceOn] = useState(false);
  const sendRef = useRef(onSend);
  useEffect(() => { sendRef.current = onSend; }, [onSend]);
  const voice = useConKayVoice({
    enabled: voiceOn,
    muted: false,
    onFinalTranscript: (t) => { if (t.trim()) sendRef.current(t.trim()); },
  });
  const level = useMicAmplitude(voiceOn && voice.listening);
  const spokenRef = useRef('');

  useEffect(() => {
    if (!voiceOn || !speakText || spokenRef.current === speakText.id) return;
    spokenRef.current = speakText.id;
    voice.speak(speakText.text);
  }, [voiceOn, speakText, voice]);

  // Space toggles the mic when focus is not in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      if (!voice.supported) return;
      e.preventDefault();
      setVoiceOn((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice.supported]);

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    onSend(t);
    setText('');
  };

  let status: string;
  if (!voice.supported) status = 'Voice input is not available in this browser — type instead.';
  else if (voice.voiceUnavailable) status = 'Voice transcription is unavailable right now — type instead.';
  else if (voiceOn && voice.speaking) status = 'ConKay is speaking…';
  else if (voiceOn && voice.listening) status = voice.interim ? `“${voice.interim}”` : 'Listening… (tap mic or press Space to stop)';
  else if (voiceOn) status = 'Starting microphone…';
  else status = 'Type, or tap the mic and speak. Reference dimensions, loads, supports or materials.';

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-sky-400/20 bg-[#071222]/90 p-2 shadow-[0_0_24px_rgba(56,189,248,0.08)] sm:gap-3 sm:p-3">
      <button
        type="button"
        onClick={() => setVoiceOn((v) => !v)}
        disabled={!voice.supported}
        aria-pressed={voiceOn}
        aria-label={voiceOn ? 'Stop voice input' : 'Start voice input'}
        title={voiceOn ? 'Stop voice input' : 'Start voice input'}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors sm:h-14 sm:w-14 ${
          voiceOn && voice.listening
            ? 'border-sky-300/70 bg-sky-400/20 text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.45)]'
            : 'border-sky-400/30 text-sky-200 hover:bg-sky-400/10'
        } disabled:opacity-40`}
      >
        {voice.supported ? <Mic className="h-5 w-5" aria-hidden /> : <MicOff className="h-5 w-5" aria-hidden />}
      </button>
      <div className="min-w-0 flex-1">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message ConKay — e.g. “t_w = 8 mm and re-run”"
            aria-label="Message ConKay"
            className="w-full min-w-0 bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none sm:text-base"
          />
        </form>
        <p className="mt-0.5 truncate text-[11px] text-slate-400" aria-live="polite">{status}</p>
      </div>
      <div className="hidden md:block"><Waveform levelRef={level} active={voiceOn && voice.listening} /></div>
      <button
        type="button"
        onClick={submit}
        disabled={busy || !text.trim()}
        aria-label="Send"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-sky-400/40 bg-sky-500/20 text-sky-100 hover:bg-sky-500/30 disabled:opacity-40 sm:h-14 sm:w-14"
      >
        {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
      </button>
    </div>
  );
}
