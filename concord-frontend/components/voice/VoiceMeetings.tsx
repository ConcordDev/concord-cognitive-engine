'use client';

/**
 * VoiceMeetings — calendar / meeting-bot integration. Schedule meetings;
 * a recorder bot "joins" (opens a live transcription session the browser
 * streams ASR words into) and finalizes the meeting into a recording.
 * Wires voice.meeting-schedule, voice.meeting-list, voice.meeting-cancel,
 * voice.meeting-bot-join, voice.meeting-bot-finalize, voice.live-append.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CalendarClock, Bot, Square, Trash2, Loader2, FileCheck2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Meeting {
  id: string; title: string; startAt: string; durationMin: number;
  meetingUrl: string; attendees: string[]; botStatus: string;
  liveSessionId: string | null; recordingId: string | null;
}

// SpeechRecognition typing (subset).
interface SRResultItem { transcript: string }
interface SRResult { isFinal: boolean; 0: SRResultItem; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SpeechRecognitionLike {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function VoiceMeetings({ onRecorded }: { onRecorded?: () => void }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState({ title: '', startAt: '', durationMin: 30, meetingUrl: '', attendees: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeBot, setActiveBot] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const botStartRef = useRef<number>(0);

  const refresh = useCallback(async () => {
    const r = await lensRun('voice', 'meeting-list', {});
    if (r.data?.ok) {
      const list = ((r.data.result?.meetings as Meeting[]) || []).slice().sort((a, b) => b.startAt.localeCompare(a.startAt));
      setMeetings(list);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => () => { recRef.current?.stop(); recRef.current = null; }, []);

  const schedule = useCallback(async () => {
    if (!draft.title.trim() || !draft.startAt) return;
    setError(null);
    setBusy(true);
    const r = await lensRun('voice', 'meeting-schedule', {
      title: draft.title.trim(),
      startAt: new Date(draft.startAt).toISOString(),
      durationMin: draft.durationMin,
      meetingUrl: draft.meetingUrl.trim() || undefined,
      attendees: draft.attendees.split(',').map(s => s.trim()).filter(Boolean),
    });
    setBusy(false);
    if (r.data?.ok) {
      setDraft({ title: '', startAt: '', durationMin: 30, meetingUrl: '', attendees: '' });
      setShowNew(false);
      await refresh();
    } else {
      setError(r.data?.error || 'Could not schedule meeting');
    }
  }, [draft, refresh]);

  const cancel = useCallback(async (id: string) => {
    await lensRun('voice', 'meeting-cancel', { id });
    await refresh();
  }, [refresh]);

  // Start the recorder bot: open the live session, then stream ASR into it.
  const startBot = useCallback(async (meeting: Meeting) => {
    setError(null);
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) { setError('SpeechRecognition unsupported in this browser'); return; }
    setBusy(true);
    const r = await lensRun('voice', 'meeting-bot-join', { id: meeting.id });
    setBusy(false);
    if (!r.data?.ok) { setError(r.data?.error || 'Bot could not join'); return; }
    const sessionId = (r.data.result?.session as { id: string })?.id;
    sessionIdRef.current = sessionId;
    botStartRef.current = Date.now();

    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: SREvent) => {
      const atSec = Math.round((Date.now() - botStartRef.current) / 1000);
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const text = e.results[i][0]?.transcript?.trim();
        const sid = sessionIdRef.current;
        if (text && sid) void lensRun('voice', 'live-append', { sessionId: sid, text, isFinal: true, atSec });
      }
    };
    rec.onerror = (ev: { error: string }) => {
      if (ev.error !== 'no-speech' && ev.error !== 'aborted') setError(`Bot error: ${ev.error}`);
    };
    rec.onend = () => { if (recRef.current) { try { rec.start(); } catch { /* restart race */ } } };
    recRef.current = rec;
    try { rec.start(); setActiveBot(meeting.id); await refresh(); }
    catch { setError('Microphone unavailable'); }
  }, [refresh]);

  const stopBot = useCallback(async (meeting: Meeting) => {
    recRef.current?.stop();
    recRef.current = null;
    setBusy(true);
    const r = await lensRun('voice', 'meeting-bot-finalize', { id: meeting.id });
    setBusy(false);
    setActiveBot(null);
    sessionIdRef.current = null;
    if (r.data?.ok) { await refresh(); onRecorded?.(); }
    else setError(r.data?.error || 'Could not finalize meeting');
  }, [refresh, onRecorded]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <CalendarClock className="w-4 h-4 text-sky-400" />
        <span className="text-xs text-zinc-400">Schedule meetings — the bot joins and records.</span>
        <button onClick={() => setShowNew(v => !v)}
          className="ml-auto px-2.5 py-1 text-xs rounded bg-sky-600 hover:bg-sky-500 text-white">
          {showNew ? 'Cancel' : 'Schedule'}
        </button>
      </div>

      {showNew && (
        <div className="bg-zinc-900/70 border border-sky-800/40 rounded-lg p-3 space-y-2">
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="Meeting title"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-sm text-zinc-100" />
          <div className="flex flex-wrap gap-2">
            <input type="datetime-local" value={draft.startAt} onChange={e => setDraft({ ...draft, startAt: e.target.value })}
              className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <input type="number" min={5} value={draft.durationMin}
              onChange={e => setDraft({ ...draft, durationMin: Number(e.target.value) })}
              className="w-20 bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
            <span className="text-[11px] text-zinc-400 self-center">min</span>
          </div>
          <input value={draft.meetingUrl} onChange={e => setDraft({ ...draft, meetingUrl: e.target.value })} placeholder="Meeting URL (optional)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <input value={draft.attendees} onChange={e => setDraft({ ...draft, attendees: e.target.value })} placeholder="Attendees (comma separated)"
            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200" />
          <button onClick={schedule} disabled={!draft.title.trim() || !draft.startAt || busy}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40">
            Add to calendar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {meetings.length === 0 ? (
        <p className="text-xs text-zinc-400 italic">No meetings scheduled yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {meetings.map(m => (
            <li key={m.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{m.title}</p>
                  <p className="text-[10px] text-zinc-400">
                    {new Date(m.startAt).toLocaleString()} · {m.durationMin} min
                    {m.attendees.length > 0 && ` · ${m.attendees.length} attendee${m.attendees.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <span className={cn('px-1.5 py-0.5 rounded text-[10px] capitalize',
                  m.botStatus === 'recorded' ? 'bg-emerald-900/40 text-emerald-300'
                    : m.botStatus === 'joined' ? 'bg-rose-900/40 text-rose-300'
                      : 'bg-zinc-800 text-zinc-400')}>
                  {m.botStatus}
                </span>
                {m.botStatus === 'scheduled' && (
                  <>
                    <button onClick={() => startBot(m)} disabled={busy || !!activeBot}
                      className="px-2 py-1 text-[11px] rounded bg-violet-600 hover:bg-violet-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
                      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}Bot join
                    </button>
                    <button onClick={() => cancel(m.id)} className="p-1 text-rose-400 hover:text-rose-300" aria-label="Cancel meeting">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
                {m.botStatus === 'joined' && activeBot === m.id && (
                  <button onClick={() => stopBot(m)} disabled={busy}
                    className="px-2 py-1 text-[11px] rounded bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 disabled:opacity-40">
                    {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileCheck2 className="w-3 h-3" />}End &amp; save
                  </button>
                )}
                {m.botStatus === 'joined' && activeBot !== m.id && (
                  <span className="text-[10px] text-zinc-400 inline-flex items-center gap-1"><Square className="w-2.5 h-2.5" />bot in another tab</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
