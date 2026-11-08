'use client';

/**
 * MeditationStudio — Calm / Headspace 2026-shape session studio: a
 * curated library (guided / breathwork / sleep stories / soundscapes /
 * SOS), a breathwork pacer, a mood check-in + trend and a streak
 * dashboard. Wires the meditation.library, meditation.play,
 * meditation.streak, meditation.breathwork, meditation.mood-checkin,
 * meditation.mood-history and meditation.meditation-dashboard macros.
 *
 * A library click SAVES the session for later (play is an intent,
 * S-MED-1): it never credits the practice record — minutes and
 * streaks are written only by sessions actually sat.
 */

import { useCallback, useEffect, useState } from 'react';
import { Sparkles, Play, Wind, Flame, Loader2, Smile, TrendingUp } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Session { id: string; title: string; category: string; durationMin: number; narrator?: string; goal: string; pattern?: string }
interface Dash { totalSessions: number; totalMinutes: number; currentStreak: number; byCategory: Record<string, number> }
interface Breath { pattern: string; name: string; phases: { label: string; sec: number }[]; cycleSeconds: number }
interface MoodEntry { id: string; mood: number; note: string; at: string }
interface MoodHist { moods: MoodEntry[]; averageMood: number | null; count: number }

const CAT_LABEL: Record<string, string> = {
  guided: 'Guided', breathwork: 'Breathwork', sleep_story: 'Sleep Stories', soundscape: 'Soundscapes', sos: 'SOS',
};
const MOODS = ['😣', '😕', '😐', '🙂', '😌'];

export function MeditationStudio({ onPractice }: { onPractice?: () => void }) {
  const [library, setLibrary] = useState<Session[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState('guided');
  const [dash, setDash] = useState<Dash | null>(null);
  const [moodHist, setMoodHist] = useState<MoodHist | null>(null);
  const [loading, setLoading] = useState(true);
  const [savedTitle, setSavedTitle] = useState<string | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [breath, setBreath] = useState<Breath | null>(null);
  // No mood is pre-selected (F5): a check-in records only a feeling
  // the user actually chose — the button stays disabled until then.
  const [mood, setMood] = useState<number | null>(null);
  const [confirmMoodDeleteId, setConfirmMoodDeleteId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [lib, d, mh, iv] = await Promise.all([
      lensRun('meditation', 'library', {}),
      lensRun('meditation', 'meditation-dashboard', {}),
      lensRun('meditation', 'mood-history', {}),
      lensRun('meditation', 'intents', {}),
    ]);
    setLibrary((lib.data?.result?.sessions as Session[]) || []);
    setCats((lib.data?.result?.categories as string[]) || []);
    setDash((d.data?.result as Dash) || null);
    setMoodHist((mh.data?.result as MoodHist) || null);
    const intents = (iv.data?.result?.intents as { sessionId: string }[]) || [];
    setSavedIds(new Set(intents.map((x) => x.sessionId)));
    setLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function play(s: Session) {
    // Save for later — the click writes an intent, NOT practice.
    setSavedTitle(s.title);
    if (s.category === 'breathwork' && s.pattern) {
      const r = await lensRun('meditation', 'breathwork', { pattern: s.pattern, cycles: 8 });
      setBreath((r.data?.result as Breath) || null);
    } else {
      setBreath(null);
    }
    await lensRun('meditation', 'play', { sessionId: s.id });
    await refresh();
  }
  async function checkin() {
    if (mood == null) return;
    await lensRun('meditation', 'mood-checkin', { mood });
    setMood(null);
    await refresh();
    onPractice?.();
  }
  async function deleteCheckin(id: string) {
    await lensRun('meditation', 'moodDelete', { checkinId: id });
    setConfirmMoodDeleteId(null);
    await refresh();
    onPractice?.();
  }

  if (loading) return <div className="flex items-center justify-center py-6 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>;

  const shown = library.filter(s => s.category === cat);

  return (
    <div className="rounded-2xl border border-indigo-900/40 bg-gradient-to-b from-indigo-950/30 to-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-indigo-300" />
        <h3 className="text-sm font-bold text-zinc-100">Meditation Studio</h3>
      </div>

      {dash && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
          {([['Sessions', dash.totalSessions], ['Minutes', dash.totalMinutes], ['Streak', `${dash.currentStreak}🔥`]] as const).map(([l, v]) => (
            <div key={l} className="bg-zinc-900/60 border border-zinc-800 rounded-lg px-2 py-1.5 text-center">
              <p className="text-sm font-bold text-zinc-100">{v}</p>
              <p className="text-[9px] text-zinc-400 uppercase tracking-wide">{l}</p>
            </div>
          ))}
        </div>
      )}

      {savedTitle && (
        <div className="bg-indigo-900/30 border border-indigo-800/40 rounded-lg p-2.5 mb-3">
          <p className="text-xs text-indigo-200 inline-flex items-center gap-1"><Play className="w-3 h-3" />Saved for later: <strong>{savedTitle}</strong></p>
          <p className="text-[10px] text-indigo-300/80 mt-0.5">Saved sessions sit outside your practice totals — they count when you sit them in the Session view.</p>
          {breath && (
            <div className="mt-2">
              <p className="text-[11px] text-indigo-300 mb-1">{breath.name} — {breath.cycleSeconds}s/cycle</p>
              <div className="flex gap-1">
                {breath.phases.map((p, i) => (
                  <div key={i} className="flex-1 text-center bg-indigo-950/60 rounded py-1">
                    <p className="text-[10px] capitalize text-indigo-200">{p.label}</p>
                    <p className="text-xs font-bold text-indigo-100">{p.sec}s</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 mb-2 overflow-x-auto">
        {cats.map(c => (
          <button key={c} onClick={() => setCat(c)}
            className={cn('px-2.5 py-1 text-[11px] rounded whitespace-nowrap', cat === c ? 'bg-indigo-600 text-white' : 'text-zinc-400 hover:text-zinc-200')}>
            {CAT_LABEL[c] || c}
          </button>
        ))}
      </div>

      {/* Session grid */}
      <div className="grid sm:grid-cols-2 gap-2 mb-3">
        {shown.map(s => (
          <button key={s.id} onClick={() => play(s)}
            className="text-left bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 hover:border-indigo-700 transition-colors group">
            <div className="flex items-center gap-2">
              {s.category === 'breathwork' ? <Wind className="w-3.5 h-3.5 text-indigo-400" />
                : s.category === 'sos' ? <Flame className="w-3.5 h-3.5 text-rose-400" />
                : <Play className="w-3.5 h-3.5 text-indigo-400" />}
              <span className="text-xs font-semibold text-zinc-100 flex-1 truncate">{s.title}</span>
              <span className="text-[10px] text-zinc-400">{s.durationMin}m</span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5">{s.narrator || s.goal}{savedIds.has(s.id) ? ' · saved for later' : ''}</p>
          </button>
        ))}
      </div>

      {/* Mood check-in */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex items-center gap-2">
        <Smile className="w-4 h-4 text-indigo-300" />
        <span className="text-[11px] text-zinc-400">How do you feel?</span>
        <div className="flex gap-0.5">
          {MOODS.map((m, i) => (
            <button key={i} onClick={() => setMood(i + 1)}
              className={cn('text-lg rounded px-1', mood === i + 1 ? 'bg-indigo-600/30' : 'opacity-50 hover:opacity-100')}>{m}</button>
          ))}
        </div>
        <button onClick={checkin} disabled={mood == null}
          className="ml-auto px-2.5 py-1 text-[11px] rounded bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          {mood == null ? 'Pick a mood first' : 'Check in'}
        </button>
      </div>

      {/* Mood trend — meditation.mood-history */}
      {moodHist && moodHist.count > 0 && (
        <div className="mt-2 bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5 text-indigo-300 flex-shrink-0" />
          <span className="text-[11px] text-zinc-400 flex-shrink-0">
            avg {moodHist.averageMood}/5 · {moodHist.count} check-in{moodHist.count === 1 ? '' : 's'}
          </span>
          <div className="flex gap-1 ml-auto overflow-x-auto">
            {moodHist.moods.slice(0, 10).reverse().map((m) => (
              <span key={m.id} className="inline-flex items-center flex-shrink-0">
                <span title={new Date(m.at).toLocaleString()} className="text-sm">
                  {MOODS[m.mood - 1]}
                </span>
                {confirmMoodDeleteId === m.id ? (
                  <button type="button" onClick={() => deleteCheckin(m.id)}
                    className="text-[9px] px-1 py-0.5 rounded bg-rose-600 text-white ml-0.5">Remove?</button>
                ) : (
                  <button type="button" onClick={() => setConfirmMoodDeleteId(m.id)} aria-label="Remove check-in"
                    className="text-[10px] text-zinc-500 hover:text-rose-300 ml-0.5">✕</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
