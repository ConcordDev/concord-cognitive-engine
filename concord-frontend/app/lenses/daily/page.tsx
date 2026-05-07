'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { api, apiHelpers } from '@/lib/api/client';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, Plus, Sparkles, CheckCircle2, Clock, Play, Pause, Square, RotateCcw,
  Coffee, CheckSquare, BookOpen, Target, TrendingUp, Flame, ChevronLeft,
  ChevronRight, FileText, ListChecks, Loader2, XCircle,
} from 'lucide-react';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { ErrorState } from '@/components/common/EmptyState';
import { showToast } from '@/components/common/Toasts';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// -- Types ------------------------------------------------------------------
interface JournalEntry { id: string; date: string; mood: number | null; notes: string; workedOn: string; learned: string; goals: string }
interface SessionLog { id: string; project: string; duration: number; category: string; startedAt: string }
interface AudioClip { id: string; name: string; duration: number; waveform: number[]; recordedAt: string }
interface Reminder { id: string; title: string; dueAt: string; completed: boolean }
interface PracticeSession { id: string; skill: string; duration: number; completedAt: string }
interface HabitEntry { habit: string; currentStreak: number; status: string }

// -- Demo data --------------------------------------------------------------
const QUOTES = [
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: 'Creativity is intelligence having fun.', author: 'Albert Einstein' },
  { text: 'The best way to predict the future is to create it.', author: 'Peter Drucker' },
  { text: 'Every artist was first an amateur.', author: 'Ralph Waldo Emerson' },
  { text: 'What gets measured gets managed.', author: 'Peter Drucker' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe' },
  { text: 'Art is not what you see, but what you make others see.', author: 'Edgar Degas' },
];

const INITIAL_ENTRIES: JournalEntry[] = [];

const INITIAL_SESSIONS: SessionLog[] = [];

const _INITIAL_CLIPS: AudioClip[] = [];

const INITIAL_REMINDERS: Reminder[] = [];

const SKILLS = ['Finger drumming', 'Chord voicings', 'Sound design', 'Ear training', 'Mixing technique', 'Rhythm exercises'];
const MOODS = ['😤', '😕', '😐', '🙂', '🔥'];
const MOOD_LABELS = ['Frustrated', 'Meh', 'Neutral', 'Good vibes', 'On fire'];

// -- Helpers ----------------------------------------------------------------
const fmtTime = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;
const fmtDur = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h > 0 ? `${h}h ${m}m` : `${m}m`; };
const dayName = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
const shortDate = (d: string) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// -- Circular Timer SVG -----------------------------------------------------
function CircularTimer({ progress, timeLeft, size = 160 }: { progress: number; timeLeft: number; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" className="text-lattice-border" strokeWidth={8} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#timerGrad)" strokeWidth={8}
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - progress)} className="transition-all duration-300" />
      <defs>
        <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
        className="fill-white text-2xl font-mono font-bold transform rotate-90" style={{ transformOrigin: 'center' }}>
        {fmtTime(timeLeft)}
      </text>
    </svg>
  );
}

// -- Mini Waveform ----------------------------------------------------------
function MiniWaveform({ data, playing }: { data: number[]; playing: boolean }) {
  return (
    <div className="flex items-end gap-px h-8">
      {data.map((v, i) => (
        <div key={i} className={`w-1 rounded-full transition-colors ${playing ? 'bg-neon-cyan' : 'bg-gray-600'}`}
          style={{ height: `${v * 100}%` }} />
      ))}
    </div>
  );
}

// ===========================================================================
// Main Page Component
// ===========================================================================
export default function DailyLensPage() {
  useLensNav('daily');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('daily');
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split('T')[0];

  // -- State ----------------------------------------------------------------
  const [selectedDate, setSelectedDate] = useState(today);
  const [reminderTitle, setReminderTitle] = useState('');
  const [reminderDue, setReminderDue] = useState('');
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [journalNotes, setJournalNotes] = useState('');
  const [workedOn, setWorkedOn] = useState('');
  const [learned, setLearned] = useState('');
  const [goals, setGoals] = useState('');
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [newProject, setNewProject] = useState('');
  const [newGenre, setNewGenre] = useState('');
  const [newDuration, setNewDuration] = useState('');
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [clips, setClips] = useState<AudioClip[]>([]);
  const [playingClip, setPlayingClip] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStartRef = useRef<number>(0);
  const [timerDuration, setTimerDuration] = useState(15 * 60);
  const [timeLeft, setTimeLeft] = useState(15 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState(SKILLS[0]);
  const [practiceHistory, setPracticeHistory] = useState<PracticeSession[]>([]);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const [localReminders, setLocalReminders] = useState<Reminder[]>([]);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  const [calMonth, setCalMonth] = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() };
  });

  // ── Backend action state ───────────────────────────────────────────────────
  const runAction = useRunArtifact('daily');
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunningAction, setIsRunningAction] = useState(false);

  const { isLoading, isError: isError, error: error, refetch: refetch, items: entryItems, create: createEntry } = useLensData('daily', 'entry', {
    seed: INITIAL_ENTRIES.map(e => ({ title: e.date, data: e as unknown as Record<string, unknown> })),
  });
  const { isError: isError2, error: error2, refetch: refetch2, items: sessionItems, create: createSession } = useLensData('daily', 'session', {
    seed: INITIAL_SESSIONS.map(s => ({ title: s.project, data: s as unknown as Record<string, unknown> })),
  });
  const { isError: isError3, error: error3, refetch: refetch3, items: reminderItems, create: createReminder } = useLensData('daily', 'reminder', {
    seed: INITIAL_REMINDERS.map(r => ({ title: r.title, data: r as unknown as Record<string, unknown> })),
  });

  // Sync backend data into local state when available
  useEffect(() => {
    if (sessionItems.length > 0 && sessions.length === 0) {
      setSessions(sessionItems.map(i => i.data as unknown as SessionLog));
    }
  }, [sessionItems, sessions.length]);

  useEffect(() => {
    if (reminderItems.length > 0 && localReminders.length === 0) {
      setLocalReminders(reminderItems.map(i => i.data as unknown as Reminder));
    }
  }, [reminderItems, localReminders.length]);

  // -- API queries (preserved from original) --------------------------------
  const { data: dailyData, isError: isError4, error: error4, refetch: refetch4,} = useQuery({
    queryKey: ['daily-notes'],
    queryFn: () => apiHelpers.daily.list().then((r) => r.data),
  });
  const isError5 = false as boolean; const error5 = null as Error | null; const refetch5 = () => {};
  const isError6 = false as boolean; const error6 = null as Error | null; const refetch6 = () => {};
  const generateDigest = useMutation({
    mutationFn: () => apiHelpers.daily.digest(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['daily-notes'] }),
    onError: (err) => console.error('generateDigest failed:', err instanceof Error ? err.message : err),
  });
  const createReminderMut = useMutation({
    mutationFn: () => apiHelpers.daily.createReminder({ title: reminderTitle, dueAt: reminderDue }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reminders-due'] }); setReminderTitle(''); setReminderDue(''); },
    onError: (err) => console.error('createReminderMut failed:', err instanceof Error ? err.message : err),
  });
  const completeReminderMut = useMutation({
    mutationFn: (id: string) => apiHelpers.daily.completeReminder(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reminders-due'] }),
    onError: (err) => console.error('completeReminderMut failed:', err instanceof Error ? err.message : err),
  });
  const notes = useMemo(() => {
    const raw = dailyData?.notes || dailyData || [];
    return Array.isArray(raw) ? raw : [];
  }, [dailyData]);

  // -- Practice timer logic -------------------------------------------------
  useEffect(() => {
    if (timerRunning && timeLeft > 0) {
      intervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setTimerRunning(false);
            setPracticeHistory((h) => [
              { id: `p${Date.now()}`, skill: selectedSkill, duration: timerDuration, completedAt: new Date().toISOString() },
              ...h,
            ]);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerRunning, timeLeft, timerDuration, selectedSkill]);

  const startTimer = useCallback(() => setTimerRunning(true), []);
  const stopTimer = useCallback(() => setTimerRunning(false), []);
  const resetTimer = useCallback(() => { setTimerRunning(false); setTimeLeft(timerDuration); }, [timerDuration]);

  const handleRunAction = useCallback(async (action: string) => {
    const targetId = entryItems[0]?.id ?? 'daily-default';
    setIsRunningAction(true);
    setActionResult(null);
    try {
      const result = await runAction.mutateAsync({ id: targetId, action });
      setActionResult(result as Record<string, unknown>);
    } catch (err) {
      setActionResult({ error: err instanceof Error ? err.message : 'Action failed' });
    } finally {
      setIsRunningAction(false);
    }
  }, [runAction, entryItems]);

  // -- Audio recording via MediaRecorder API --------------------------------
  const handleRecordToggle = useCallback(async () => {
    if (isRecording && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const duration = Math.round((Date.now() - recordingStartRef.current) / 1000);
        const waveform = Array.from({ length: 24 }, (_, i) => 0.2 + (Math.sin(i * 0.5) * 0.35 + 0.35 + Math.sin(i * 1.2 + 1) * 0.15));
        const clipId = `clip-${Date.now()}`;
        const newClip: AudioClip = {
          id: clipId,
          name: `Quick Note ${clips.length + 1}`,
          duration,
          waveform,
          recordedAt: new Date().toISOString(),
        };
        setClips(prev => [newClip, ...prev]);
        // Upload actual audio data to backend
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          api.post('/api/media/upload', {
            title: newClip.name,
            mediaType: 'audio',
            mimeType: 'audio/webm',
            fileSize: blob.size,
            originalFilename: `daily-note-${clipId}.webm`,
            tags: ['daily', 'voice-note'],
            privacy: 'private',
            duration,
            data: base64,
          }).catch(err => { console.error('[Daily] Upload failed:', err); showToast('error', 'Upload failed'); });
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorderRef.current = recorder;
      recordingStartRef.current = Date.now();
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.warn('[Daily] Microphone access denied:', err);
    }
  }, [isRecording, clips.length]);

  // -- Add session ----------------------------------------------------------
  const addSession = useCallback(() => {
    if (!newProject.trim()) return;
    const sessionData = {
      id: `s${Date.now()}`, project: newProject, duration: parseInt(newDuration) || 30,
      category: newGenre || 'General', startedAt: new Date().toISOString(),
    };
    setSessions((prev) => [...prev, sessionData]);
    createSession({ title: newProject, data: sessionData as unknown as Record<string, unknown> });
    setNewProject(''); setNewGenre(''); setNewDuration(''); setShowSessionForm(false);
  }, [newProject, newGenre, newDuration, createSession]);

  // -- Calendar helpers -----------------------------------------------------
  const calDays = useMemo(() => {
    const first = new Date(calMonth.year, calMonth.month, 1);
    const daysInMonth = new Date(calMonth.year, calMonth.month + 1, 0).getDate();
    const cells: (number | null)[] = Array(first.getDay()).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [calMonth]);

  const entries: JournalEntry[] = useMemo(() => entryItems.map(i => i.data as unknown as JournalEntry), [entryItems]);

  const entryDates = useMemo(() => new Set(entries.map((e) => e.date)), [entries]);

  const recentDates = useMemo(() => {
    const dates: string[] = [];
    for (let i = 0; i < 14; i++) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); }
    return dates;
  }, []);

  const entriesThisWeek = entries.filter((e) => {
    return (new Date().getTime() - new Date(e.date).getTime()) / 86400000 <= 7;
  }).length;

  // -- Daily digest ----------------------------------------------------------
  const dailyDigest = useMemo(() => {
    const tot = sessions.reduce((s, x) => s + x.duration, 0);
    const categories = [...new Set(sessions.map((s) => s.category))].join(', ');
    const pending = localReminders.filter((r) => !r.completed).length;
    return `You spent ${fmtDur(tot)} across ${sessions.length} sessions today. Categories: ${categories}. You recorded ${clips.length} audio clips and have ${pending} pending reminders.${selectedMood !== null ? ` Mood: ${MOODS[selectedMood]}` : ''}`;
  }, [sessions, clips.length, localReminders, selectedMood]);

  // -- Handlers -------------------------------------------------------------
  const handleCompleteReminder = (id: string) => {
    setLocalReminders((prev) => prev.map((r) => (r.id === id ? { ...r, completed: true } : r)));
    completeReminderMut.mutate(id);
  };
  const handleAddReminder = () => {
    if (!reminderTitle.trim() || !reminderDue) return;
    const reminderData = { id: `r${Date.now()}`, title: reminderTitle, dueAt: reminderDue, completed: false };
    setLocalReminders((prev) => [...prev, reminderData]);
    createReminder({ title: reminderTitle, data: reminderData as unknown as Record<string, unknown> });
    createReminderMut.mutate(); setReminderTitle(''); setReminderDue('');
  };
  const handleSelectDate = (dateStr: string) => {
    setSelectedDate(dateStr);
    const entry = entries.find((e) => e.date === dateStr);
    if (entry) { setSelectedMood(entry.mood); setJournalNotes(entry.notes); setWorkedOn(entry.workedOn); setLearned(entry.learned); setGoals(entry.goals); }
    else { setSelectedMood(null); setJournalNotes(''); setWorkedOn(''); setLearned(''); setGoals(''); }
  };

  // -- Render ---------------------------------------------------------------

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

  if (isError || isError2 || isError3 || isError4 || isError5 || isError6) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message || error5?.message || error6?.message} onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); refetch5(); refetch6(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="daily" className="h-[calc(100vh-4rem)] flex bg-lattice-deep text-white overflow-hidden">
      {/* =================== LEFT SIDEBAR =================== */}
      <aside className="w-72 border-r border-lattice-border bg-lattice-surface/40 flex flex-col shrink-0">
        {/* Mini calendar */}
        <div className="p-4 border-b border-lattice-border">
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setCalMonth((m) => { const p = new Date(m.year, m.month - 1); return { year: p.getFullYear(), month: p.getMonth() }; })}
              className="p-1 hover:bg-white/10 rounded"><ChevronLeft className="w-4 h-4" /></button>
            <span className="text-sm font-semibold">
              {new Date(calMonth.year, calMonth.month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </span>
            <button onClick={() => setCalMonth((m) => { const n = new Date(m.year, m.month + 1); return { year: n.getFullYear(), month: n.getMonth() }; })}
              className="p-1 hover:bg-white/10 rounded"><ChevronRight className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {['S','M','T','W','T','F','S'].map((d, i) => <span key={i} className="text-gray-500 font-medium py-1">{d}</span>)}
            {calDays.map((day, i) => {
              if (day === null) return <span key={`e${i}`} />;
              const ds = `${calMonth.year}-${String(calMonth.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
              const sel = ds === selectedDate, tdy = ds === today, has = entryDates.has(ds);
              return (
                <button key={ds} onClick={() => handleSelectDate(ds)}
                  className={`py-1 rounded text-xs relative transition-colors ${sel ? 'bg-neon-cyan/30 text-neon-cyan font-bold' : tdy ? 'bg-white/10 font-semibold' : 'hover:bg-white/5'}`}>
                  {day}
                  {has && <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-neon-purple" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Date list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">Recent Entries</p>
          {recentDates.map((ds) => {
            const entry = entries.find((e) => e.date === ds);
            return (
              <button key={ds} onClick={() => handleSelectDate(ds)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between transition-colors ${
                  ds === selectedDate ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-white' : 'hover:bg-white/5 text-gray-400'}`}>
                <div>
                  <span className="font-medium text-inherit">{shortDate(ds)}</span>
                  <span className="text-xs text-gray-500 ml-2">{dayName(ds)}</span>
                </div>
                {entry ? <span className="text-sm">{entry.mood !== null ? MOODS[entry.mood] : ''}</span>
                  : ds <= today ? <span className="w-2 h-2 rounded-full bg-gray-700" /> : null}
              </button>
            );
          })}
        </div>

        {/* Stats */}
        <div className="p-4 border-t border-lattice-border space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> This week</span>
            <span className="font-semibold text-neon-cyan">{entriesThisWeek} entries</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400 flex items-center gap-1.5"><Flame className="w-3.5 h-3.5 text-orange-400" /> Streak</span>
            <span className="font-semibold text-orange-400">5 days</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-400 flex items-center gap-1.5"><BookOpen className="w-3.5 h-3.5" /> Total</span>
            <span className="font-semibold">47 entries</span>
          </div>
        </div>
      </aside>

      {/* =================== MAIN CONTENT =================== */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Inspiration quote */}
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            className="text-center py-3 px-4 rounded-lg bg-gradient-to-r from-neon-purple/10 to-neon-cyan/10 border border-lattice-border">
            <p className="text-sm italic text-gray-300">&ldquo;{quote.text}&rdquo;</p>
            <p className="text-xs text-gray-500 mt-1">&mdash; {quote.author}</p>
          </motion.div>

          {/* Date header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </h1>
              <p className="text-sm text-gray-400 mt-0.5">Production Journal</p>
            </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="daily" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
            <button onClick={() => generateDigest.mutate()} disabled={generateDigest.isPending}
              className="btn-neon purple flex items-center gap-2 text-sm">
              <Sparkles className="w-4 h-4" />
              {generateDigest.isPending ? 'Generating...' : 'Generate Digest'}
            </button>
          </div>

          {/* Mood tracker */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="lens-card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">How are you feeling?</h2>
            <div className="flex items-center gap-3">
              {MOODS.map((emoji, idx) => (
                <button key={idx} onClick={() => setSelectedMood(idx)}
                  className={`text-2xl p-2 rounded-xl transition-all ${selectedMood === idx ? 'bg-neon-cyan/20 ring-2 ring-neon-cyan scale-110' : 'hover:bg-white/10 opacity-60 hover:opacity-100'}`}>
                  {emoji}
                </button>
              ))}
              {selectedMood !== null && <span className="ml-3 text-sm text-gray-400">{MOOD_LABELS[selectedMood]}</span>}
            </div>
          </motion.div>

          {/* Journal entry */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="lens-card space-y-5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-neon-purple" /> Journal Entry
            </h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Daily Notes</label>
              <textarea value={journalNotes} onChange={(e) => setJournalNotes(e.target.value)}
                placeholder="How did your day go?" rows={3} className="input-lattice w-full text-sm resize-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <CheckSquare className="w-3 h-3" /> What I worked on today
              </label>
              <textarea value={workedOn} onChange={(e) => setWorkedOn(e.target.value)}
                placeholder="Production log..." rows={2} className="input-lattice w-full text-sm resize-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" /> What I learned
              </label>
              <textarea value={learned} onChange={(e) => setLearned(e.target.value)}
                placeholder="Key takeaways..." rows={2} className="input-lattice w-full text-sm resize-none" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-3 h-3" /> Goals for tomorrow
              </label>
              <textarea value={goals} onChange={(e) => setGoals(e.target.value)}
                placeholder="What do you want to accomplish?" rows={2} className="input-lattice w-full text-sm resize-none" />
            </div>
            <button
              onClick={() => {
                if (!journalNotes.trim() && !workedOn.trim()) return;
                createEntry({ title: selectedDate, data: { date: selectedDate, mood: selectedMood, notes: journalNotes, workedOn, learned, goals } as Record<string, unknown> });
              }}
              className="btn-neon purple text-sm w-full flex items-center justify-center gap-2"
            >
              Save Entry
            </button>
          </motion.div>

          {/* Session log */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="lens-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Clock className="w-4 h-4 text-neon-cyan" /> Session Log
              </h2>
              <button onClick={() => setShowSessionForm((v) => !v)} className="btn-neon text-xs flex items-center gap-1">
                <Plus className="w-3 h-3" /> Log Session
              </button>
            </div>
            <AnimatePresence>
              {showSessionForm && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
                  <div className="p-3 rounded-lg bg-white/5 border border-lattice-border space-y-2">
                    <input type="text" value={newProject} onChange={(e) => setNewProject(e.target.value)}
                      placeholder="Project name..." className="input-lattice w-full text-sm" />
                    <div className="flex gap-2">
                      <input type="text" value={newGenre} onChange={(e) => setNewGenre(e.target.value)}
                        placeholder="Genre..." className="input-lattice flex-1 text-sm" />
                      <input type="number" value={newDuration} onChange={(e) => setNewDuration(e.target.value)}
                        placeholder="Minutes" className="input-lattice w-24 text-sm" />
                    </div>
                    <button onClick={addSession} className="btn-neon purple text-xs w-full">Add</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="space-y-2">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-lattice-border">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{s.project}</p>
                    <p className="text-xs text-gray-500">{s.category}</p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <span className="text-sm font-mono text-neon-cyan">{fmtDur(s.duration)}</span>
                    <p className="text-xs text-gray-500">{new Date(s.startedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                  </div>
                </div>
              ))}
              {sessions.length === 0 && <p className="text-center text-sm text-gray-500 py-4">No sessions logged yet today.</p>}
            </div>
          </motion.div>

          {/* Audio clips */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="lens-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-neon-purple" /> Audio Clips
              </h2>
              <button
                onClick={handleRecordToggle}
                className={`btn-neon text-xs flex items-center gap-1 ${isRecording ? 'bg-red-500/20 text-red-400 border-red-500/50' : 'purple'}`}
                title={isRecording ? 'Stop recording' : 'Record a quick audio note'}
              >
                {isRecording ? <Square className="w-3 h-3" /> : <Coffee className="w-3 h-3" />}
                {isRecording ? 'Stop Recording' : 'Record Quick Note'}
              </button>
            </div>
            <div className="space-y-2">
              {clips.map((clip) => {
                const isPlaying = playingClip === clip.id;
                return (
                  <div key={clip.id} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-lattice-border">
                    <button onClick={() => setPlayingClip(isPlaying ? null : clip.id)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-colors ${isPlaying ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/10 hover:bg-white/20'}`}>
                      {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{clip.name}</p>
                      <p className="text-xs text-gray-500">{new Date(clip.recordedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
                    </div>
                    <MiniWaveform data={clip.waveform} playing={isPlaying} />
                    <span className="text-xs text-gray-500 font-mono shrink-0 ml-2">{fmtTime(clip.duration)}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* Practice timer */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="lens-card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-orange-400" /> Practice Timer
            </h2>
            <div className="flex gap-8 items-start">
              <div className="flex flex-col items-center gap-3">
                <CircularTimer progress={timerDuration > 0 ? (timerDuration - timeLeft) / timerDuration : 0} timeLeft={timeLeft} />
                <div className="flex items-center gap-2">
                  {!timerRunning ? (
                    <button onClick={startTimer} disabled={timeLeft === 0} className="btn-neon flex items-center gap-1.5 text-sm">
                      <Play className="w-3.5 h-3.5" /> Start
                    </button>
                  ) : (
                    <button onClick={stopTimer} className="btn-neon flex items-center gap-1.5 text-sm">
                      <Square className="w-3.5 h-3.5" /> Stop
                    </button>
                  )}
                  <button onClick={resetTimer} className="btn-neon purple flex items-center gap-1.5 text-sm">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset
                  </button>
                </div>
              </div>
              <div className="flex-1 space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Skill</label>
                  <select value={selectedSkill} onChange={(e) => setSelectedSkill(e.target.value)} className="input-lattice w-full text-sm">
                    {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 uppercase tracking-wider">Duration</label>
                  <div className="flex gap-2">
                    {[5, 10, 15, 25, 45].map((m) => (
                      <button key={m} onClick={() => { setTimerDuration(m * 60); setTimeLeft(m * 60); setTimerRunning(false); }}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${timerDuration === m * 60
                          ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/30' : 'bg-white/5 hover:bg-white/10 border border-transparent'}`}>
                        {m}m
                      </button>
                    ))}
                  </div>
                </div>
                {practiceHistory.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Today&apos;s Sessions</p>
                    <div className="space-y-1">
                      {practiceHistory.map((ph) => (
                        <div key={ph.id} className="flex items-center justify-between text-xs p-2 rounded bg-white/5">
                          <span>{ph.skill}</span>
                          <span className="text-neon-cyan font-mono">{fmtTime(ph.duration)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>

          {/* Reminders */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="lens-card">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-4">
              <Bell className="w-4 h-4 text-neon-yellow" /> Reminders
              {localReminders.filter((r) => !r.completed).length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full">
                  {localReminders.filter((r) => !r.completed).length}
                </span>
              )}
            </h2>
            <div className="flex gap-2 mb-4">
              <input type="text" value={reminderTitle} onChange={(e) => setReminderTitle(e.target.value)}
                placeholder="Reminder title..." className="input-lattice flex-1 text-sm" />
              <input type="datetime-local" value={reminderDue} onChange={(e) => setReminderDue(e.target.value)}
                className="input-lattice text-sm" />
              <button onClick={handleAddReminder} disabled={!reminderTitle.trim() || !reminderDue || createReminderMut.isPending}
                className="btn-neon purple text-sm flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed">
                <Plus className="w-3 h-3" /> {createReminderMut.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
            <div className="space-y-2">
              {localReminders.filter((r) => !r.completed).map((r) => (
                <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-lattice-border">
                  <div>
                    <p className="text-sm font-medium">{r.title}</p>
                    <p className="text-xs text-gray-500">
                      Due {new Date(r.dueAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <button onClick={() => handleCompleteReminder(r.id)}
                    className="p-1.5 text-green-400 hover:bg-green-400/20 rounded-lg transition-colors">
                    <CheckCircle2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {localReminders.filter((r) => !r.completed).length === 0 && (
                <p className="text-center text-sm text-gray-500 py-3">All caught up!</p>
              )}
            </div>
          </motion.div>

          {/* Daily digest */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}
            className="lens-card bg-gradient-to-br from-neon-purple/5 to-neon-cyan/5">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-neon-purple" /> Daily Digest
            </h2>
            <p className="text-sm text-gray-300 leading-relaxed">{dailyDigest}</p>
          </motion.div>

          {/* Notes from API */}
          {notes.length > 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="lens-card">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-neon-cyan" /> Notes
              </h2>
              <div className="space-y-2">
                {notes.map((note: { id?: string; title?: string; content?: string; date?: string }, idx: number) => (
                  <div key={note.id || idx} className="p-3 rounded-lg bg-white/5 border border-lattice-border">
                    {note.title && <p className="text-sm font-medium text-white mb-1">{note.title}</p>}
                    {note.content && <p className="text-sm text-gray-300">{note.content}</p>}
                    {note.date && <p className="text-xs text-gray-500 mt-1">{note.date}</p>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          <div className="h-6" />

      {/* Real-time Data Panel */}
      <UniversalActions domain="daily" artifactId={null} compact />
      {realtimeData && (
        <RealtimeDataPanel
          domain="daily"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}

      {/* Backend Actions Panel */}
      <div className="panel p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wider">
          <Sparkles className="w-4 h-4 text-neon-cyan" />
          Daily Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {[
            { action: 'dailySummary', label: 'Daily Summary' },
            { action: 'habitStreak', label: 'Habit Streak' },
            { action: 'focusTimer', label: 'Focus Timer' },
            { action: 'weeklyReview', label: 'Weekly Review' },
          ].map(({ action, label }) => (
            <button
              key={action}
              onClick={() => handleRunAction(action)}
              disabled={isRunningAction}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isRunningAction ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Flame className="w-3.5 h-3.5" />}
              {label}
            </button>
          ))}
        </div>
        {actionResult && (
          <div className="relative rounded-lg bg-lattice-deep border border-lattice-border p-4">
            <button
              onClick={() => setActionResult(null)}
              className="absolute top-2 right-2 text-gray-500 hover:text-white transition-colors"
              aria-label="Dismiss result"
            >
              <XCircle className="w-4 h-4" />
            </button>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Result</p>
            {(() => {
              const r = (actionResult?.['result'] as Record<string, unknown> | undefined) ?? actionResult;
              const errorMsg = typeof actionResult?.['error'] === 'string' ? (actionResult['error'] as string) : null;
              if (!r) return null;
              return (
                <div className="text-xs space-y-3 max-h-72 overflow-y-auto">
                  {/* Error */}
                  {errorMsg != null ? (
                    <p className="text-red-400">{String(errorMsg)}</p>
                  ) : null}
                  {/* Message-only result */}
                  {r?.message != null && !r?.error ? (
                    <p className="text-gray-300">{String(r.message)}</p>
                  ) : null}

                  {/* dailySummary */}
                  {r?.productivityScore !== undefined ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Date:</span>
                        <span className="text-gray-200">{String(r.date)}</span>
                        <span className="ml-auto text-gray-500">Mood: <span className="text-neon-cyan">{String(r.mood)}</span></span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-lg font-bold text-neon-green">{String(r.productivityScore)}</p>
                          <p className="text-[10px] text-gray-500">Productivity Score</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-lg font-bold text-neon-cyan">{String(r.completionRate)}%</p>
                          <p className="text-[10px] text-gray-500">Task Completion</p>
                        </div>
                      </div>
                      <div className="w-full bg-lattice-bg rounded-full h-2">
                        <div className="bg-neon-green h-2 rounded-full" style={{ width: `${Math.min(Number(r.completionRate), 100)}%` }} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-neon-blue">{String(r.tasksCompleted)}/{String(r.totalTasks)}</p>
                          <p className="text-[10px] text-gray-500">Tasks</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-neon-cyan">{String(r.totalFocusMinutes)}m</p>
                          <p className="text-[10px] text-gray-500">Focus</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-gray-300">{String(r.entriesLogged)}</p>
                          <p className="text-[10px] text-gray-500">Entries</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {/* habitStreak */}
                  {r?.habits !== undefined && r?.totalHabits !== undefined ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Active habits:</span>
                        <span className="text-neon-green font-bold">{String(r.activeHabits)}</span>
                        <span className="text-gray-500">/ {String(r.totalHabits)}</span>
                      </div>
                      <div className="space-y-1">
                        {((r.habits as HabitEntry[]) || []).map((h: HabitEntry) => (
                          <div key={h.habit} className="space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-gray-200">{h.habit}</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-neon-cyan font-bold">{h.currentStreak}d</span>
                                <span className={`px-1.5 py-0.5 rounded text-[9px] ${h.status === 'strong' ? 'bg-neon-green/20 text-neon-green' : h.status === 'building' ? 'bg-neon-cyan/20 text-neon-cyan' : h.status === 'starting' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                                  {h.status}
                                </span>
                              </div>
                            </div>
                            <div className="w-full bg-lattice-bg rounded-full h-1.5">
                              <div className="bg-neon-cyan h-1.5 rounded-full" style={{ width: `${Math.min((h.currentStreak / 30) * 100, 100)}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* focusTimer */}
                  {r?.pomodorosCompleted !== undefined ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Date:</span>
                        <span className="text-gray-200">{String(r.date)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-green">{String(r.totalHours)}h</p>
                          <p className="text-[10px] text-gray-500">Focus Today</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-cyan">{String(r.sessionsToday)}</p>
                          <p className="text-[10px] text-gray-500">Sessions</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-yellow-400">{String(r.pomodorosCompleted)}</p>
                          <p className="text-[10px] text-gray-500">Pomodoros</p>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-gray-500">
                          <span>Daily target ({String(r.targetMinutes)}m)</span>
                          <span>{String(r.progress)}%</span>
                        </div>
                        <div className="w-full bg-lattice-bg rounded-full h-2">
                          <div className={`h-2 rounded-full ${Number(r.progress) >= 100 ? 'bg-neon-green' : 'bg-neon-cyan'}`} style={{ width: `${Math.min(Number(r.progress), 100)}%` }} />
                        </div>
                      </div>
                      {Object.keys(r.byCategory as Record<string, unknown> || {}).length > 0 && (
                        <div className="space-y-1">
                          {Object.entries(r.byCategory as Record<string, number>).map(([cat, mins]) => (
                            <div key={cat} className="flex items-center justify-between text-gray-300">
                              <span>{cat}</span>
                              <span className="text-neon-cyan">{mins}m</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* weeklyReview */}
                  {r?.daysTracked !== undefined && r?.totalFocusHours !== undefined ? (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-green">{String(r.totalTasksCompleted)}</p>
                          <p className="text-[10px] text-gray-500">Tasks Done</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="text-sm font-bold text-neon-cyan">{String(r.totalFocusHours)}h</p>
                          <p className="text-[10px] text-gray-500">Focus Hours</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-gray-300">{String(r.daysTracked)}</p>
                          <p className="text-[10px] text-gray-500">Days</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-yellow-400">{String(r.avgTasksPerDay)}</p>
                          <p className="text-[10px] text-gray-500">Avg Tasks/Day</p>
                        </div>
                        <div className="p-2 bg-lattice-bg rounded text-center">
                          <p className="font-bold text-neon-blue">{String(r.avgMood ?? '—')}</p>
                          <p className="text-[10px] text-gray-500">Avg Mood</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-gray-400">
                        <span>Best day:</span>
                        <span className="text-neon-green">{String(r.bestDay)}</span>
                        <span className="ml-auto text-gray-500">{String(r.avgFocusPerDay)}m avg focus</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}
          </div>
        )}
      </div>
        </div>
      </main>
    </div>
  );
}
