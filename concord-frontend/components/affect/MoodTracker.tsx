'use client';

/**
 * MoodTracker — Daylio-style mood-tracking surface for the affect lens.
 * Surfaces the seven mood-tracking parity macros:
 *   checkin / checkinHistory / trends / activityCorrelation /
 *   journalPrompts / setReminder / nudges / exportReport / getScale / setScale.
 *
 * Every datapoint is a real user check-in fetched from the backend.
 * Nothing is seeded — empty states say "no data yet".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ChartKit } from '@/components/viz/ChartKit';
import {
  Smile,
  Flame,
  TrendingUp,
  Tag,
  BookOpen,
  Bell,
  Download,
  Settings2,
  Plus,
  Check,
  Loader2,
  CalendarDays,
  X,
  Sparkles,
} from 'lucide-react';

// --- Types mirroring the backend macro result shapes ---

interface ScalePoint {
  value: number;
  label: string;
  emoji: string;
}
interface MoodScale {
  points: ScalePoint[];
}
interface CheckinEntry {
  id: string;
  mood: number;
  moodLabel: string;
  moodEmoji: string;
  note: string;
  activities: string[];
  promptId: string | null;
  promptAnswer: string;
  createdAt: string;
  day: string;
}
interface HistoryResult {
  entries: CheckinEntry[];
  totalCheckins: number;
  currentStreak: number;
  checkedInToday: boolean;
  daysLogged: number;
}
interface CheckinResult {
  entry: CheckinEntry;
  currentStreak: number;
  longestStreak: number;
  totalCheckins: number;
  daysLogged: number;
}
interface TrendBucket {
  bucket: string;
  avgMood: number;
  count: number;
  min: number;
  max: number;
}
interface DailyPoint {
  day: string;
  avgMood: number;
  count: number;
}
interface DowPoint {
  label: string;
  avgMood: number | null;
  count: number;
}
interface TrendsResult {
  hasData: boolean;
  granularity?: string;
  buckets: TrendBucket[];
  daily: DailyPoint[];
  dayOfWeek: DowPoint[];
  overallAvg?: number;
  entryCount?: number;
}
interface Correlation {
  activity: string;
  avgMood: number;
  delta: number;
  samples: number;
  effect: 'lifts' | 'lowers' | 'neutral';
}
interface CorrelationResult {
  hasData: boolean;
  baseline: number | null;
  correlations: Correlation[];
  topLift: Correlation | null;
  topDrain: Correlation | null;
}
interface JournalPrompt {
  id: string;
  text: string;
}
interface Reminder {
  id: string;
  time: string;
  condition: string;
  label: string;
  enabled: boolean;
}
interface Nudge {
  reminderId: string;
  type: string;
  message: string;
}
interface NudgesResult {
  reminders: Reminder[];
  due: Nudge[];
  checkedInToday: boolean;
  recentAvg: number | null;
}

type MoodSubTab = 'checkin' | 'trends' | 'activities' | 'reminders' | 'scale';

const SUB_TABS: { id: MoodSubTab; label: string; icon: React.ReactNode }[] = [
  { id: 'checkin', label: 'Check-in', icon: <Smile className="w-4 h-4" /> },
  { id: 'trends', label: 'Trends', icon: <TrendingUp className="w-4 h-4" /> },
  { id: 'activities', label: 'Activities', icon: <Tag className="w-4 h-4" /> },
  { id: 'reminders', label: 'Reminders', icon: <Bell className="w-4 h-4" /> },
  { id: 'scale', label: 'Mood Scale', icon: <Settings2 className="w-4 h-4" /> },
];

const CONDITION_LABEL: Record<string, string> = {
  daily: 'Daily reminder',
  streak_risk: 'Streak at risk',
  low_mood: 'Low mood detected',
};

function moodColor(value: number, max: number): string {
  const frac = max > 1 ? (value - 1) / (max - 1) : value;
  if (frac >= 0.67) return 'text-emerald-400';
  if (frac >= 0.34) return 'text-amber-400';
  return 'text-rose-400';
}

export function MoodTracker() {
  const [subTab, setSubTab] = useState<MoodSubTab>('checkin');

  // Shared data
  const [scale, setScale] = useState<MoodScale | null>(null);
  const [isCustomScale, setIsCustomScale] = useState(false);
  const [history, setHistory] = useState<HistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Check-in form
  const [selectedMood, setSelectedMood] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [activityInput, setActivityInput] = useState('');
  const [activities, setActivities] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<JournalPrompt[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<JournalPrompt | null>(null);
  const [promptAnswer, setPromptAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastResult, setLastResult] = useState<CheckinResult | null>(null);

  // Trends
  const [granularity, setGranularity] = useState<'week' | 'month'>('week');
  const [trends, setTrends] = useState<TrendsResult | null>(null);

  // Activities
  const [correlation, setCorrelation] = useState<CorrelationResult | null>(null);

  // Reminders
  const [nudgeData, setNudgeData] = useState<NudgesResult | null>(null);
  const [newReminderTime, setNewReminderTime] = useState('20:00');
  const [newReminderCond, setNewReminderCond] = useState<'daily' | 'streak_risk' | 'low_mood'>('daily');
  const [newReminderLabel, setNewReminderLabel] = useState('');

  // Scale editor
  const [scaleDraft, setScaleDraft] = useState<ScalePoint[]>([]);
  const [scaleSaving, setScaleSaving] = useState(false);

  // Export
  const [exporting, setExporting] = useState(false);

  const maxMood = useMemo(
    () => (scale ? Math.max(...scale.points.map((p) => p.value)) : 5),
    [scale],
  );

  // --- Data loaders ---

  const loadCore = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [scaleRes, histRes, promptRes] = await Promise.all([
        lensRun('affect', 'getScale', {}),
        lensRun('affect', 'checkinHistory', { limit: 60 }),
        lensRun('affect', 'journalPrompts', { count: 3 }),
      ]);
      if (scaleRes.data?.ok && scaleRes.data.result) {
        const r = scaleRes.data.result as { scale: MoodScale; isCustom: boolean };
        setScale(r.scale);
        setIsCustomScale(r.isCustom);
        setScaleDraft(r.scale.points.map((p) => ({ ...p })));
      }
      if (histRes.data?.ok && histRes.data.result) {
        setHistory(histRes.data.result as HistoryResult);
      }
      if (promptRes.data?.ok && promptRes.data.result) {
        setPrompts((promptRes.data.result as { prompts: JournalPrompt[] }).prompts);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load mood data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrends = useCallback(async () => {
    try {
      const r = await lensRun('affect', 'trends', { granularity });
      if (r.data?.ok && r.data.result) setTrends(r.data.result as TrendsResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load trends');
    }
  }, [granularity]);

  const loadCorrelation = useCallback(async () => {
    try {
      const r = await lensRun('affect', 'activityCorrelation', { minSamples: 2 });
      if (r.data?.ok && r.data.result) setCorrelation(r.data.result as CorrelationResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load correlations');
    }
  }, []);

  const loadNudges = useCallback(async () => {
    try {
      const r = await lensRun('affect', 'nudges', {});
      if (r.data?.ok && r.data.result) setNudgeData(r.data.result as NudgesResult);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load reminders');
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  useEffect(() => {
    if (subTab === 'trends') loadTrends();
  }, [subTab, loadTrends]);

  useEffect(() => {
    if (subTab === 'activities') loadCorrelation();
  }, [subTab, loadCorrelation]);

  useEffect(() => {
    if (subTab === 'reminders') loadNudges();
  }, [subTab, loadNudges]);

  // --- Actions ---

  const addActivity = () => {
    const v = activityInput.trim().toLowerCase();
    if (v && !activities.includes(v) && activities.length < 20) {
      setActivities([...activities, v]);
    }
    setActivityInput('');
  };

  const submitCheckin = async () => {
    if (selectedMood == null) return;
    setSubmitting(true);
    setErr(null);
    try {
      const r = await lensRun('affect', 'checkin', {
        mood: selectedMood,
        note,
        activities,
        promptId: selectedPrompt?.id || null,
        promptAnswer,
      });
      if (r.data?.ok && r.data.result) {
        setLastResult(r.data.result as CheckinResult);
        setSelectedMood(null);
        setNote('');
        setActivities([]);
        setSelectedPrompt(null);
        setPromptAnswer('');
        await loadCore();
      } else {
        setErr(r.data?.error || 'Check-in failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const addReminder = async () => {
    setErr(null);
    try {
      const r = await lensRun('affect', 'setReminder', {
        time: newReminderTime,
        condition: newReminderCond,
        label: newReminderLabel || undefined,
      });
      if (r.data?.ok) {
        setNewReminderLabel('');
        await loadNudges();
      } else {
        setErr(r.data?.error || 'Failed to add reminder');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to add reminder');
    }
  };

  const toggleReminder = async (rem: Reminder) => {
    try {
      await lensRun('affect', 'setReminder', {
        id: rem.id,
        time: rem.time,
        condition: rem.condition,
        enabled: !rem.enabled,
      });
      await loadNudges();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update reminder');
    }
  };

  const saveScale = async () => {
    setScaleSaving(true);
    setErr(null);
    try {
      const r = await lensRun('affect', 'setScale', { points: scaleDraft });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { scale: MoodScale; isCustom: boolean };
        setScale(res.scale);
        setIsCustomScale(res.isCustom);
        setScaleDraft(res.scale.points.map((p) => ({ ...p })));
      } else {
        setErr(r.data?.error || 'Failed to save scale');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save scale');
    } finally {
      setScaleSaving(false);
    }
  };

  const resetScale = async () => {
    setScaleSaving(true);
    try {
      const r = await lensRun('affect', 'setScale', { reset: true });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as { scale: MoodScale; isCustom: boolean };
        setScale(res.scale);
        setIsCustomScale(res.isCustom);
        setScaleDraft(res.scale.points.map((p) => ({ ...p })));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to reset scale');
    } finally {
      setScaleSaving(false);
    }
  };

  const exportReport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setErr(null);
    try {
      const r = await lensRun('affect', 'exportReport', { format });
      if (r.data?.ok && r.data.result) {
        const res = r.data.result as {
          csv: string;
          rows: unknown[];
          summary: Record<string, unknown>;
        };
        const content =
          format === 'json'
            ? JSON.stringify({ rows: res.rows, summary: res.summary }, null, 2)
            : res.csv;
        const blob = new Blob([content], {
          type: format === 'json' ? 'application/json' : 'text/csv',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `affect-emotional-report.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setErr(r.data?.error || 'Export failed');
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-neon-pink" />
      </div>
    );
  }

  const streak = history?.currentStreak ?? 0;
  const checkedToday = history?.checkedInToday ?? false;

  return (
    <div className="space-y-5">
      {/* Streak header */}
      <div className="grid grid-cols-3 gap-3">
        <div className="panel p-4 flex items-center gap-3">
          <Flame className={`w-7 h-7 ${streak > 0 ? 'text-orange-400' : 'text-gray-600'}`} />
          <div>
            <p className="text-2xl font-bold font-mono">{streak}</p>
            <p className="text-xs text-gray-400">day streak</p>
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-3">
          <CalendarDays className="w-7 h-7 text-cyan-400" />
          <div>
            <p className="text-2xl font-bold font-mono">{history?.totalCheckins ?? 0}</p>
            <p className="text-xs text-gray-400">total check-ins</p>
          </div>
        </div>
        <div className="panel p-4 flex items-center gap-3">
          {checkedToday ? (
            <Check className="w-7 h-7 text-emerald-400" />
          ) : (
            <Smile className="w-7 h-7 text-amber-400" />
          )}
          <div>
            <p className="text-sm font-bold">
              {checkedToday ? 'Logged today' : 'Not logged yet'}
            </p>
            <p className="text-xs text-gray-400">today&apos;s ritual</p>
          </div>
        </div>
      </div>

      {err && (
        <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
          {err}
        </div>
      )}

      {/* Sub-tab nav */}
      <div className="flex gap-1 flex-wrap">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              subTab === t.id
                ? 'bg-neon-pink/15 text-neon-pink border border-neon-pink/30'
                : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      {/* === Check-in === */}
      {subTab === 'checkin' && scale && (
        <div className="space-y-5">
          <div className="panel p-4 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Smile className="w-4 h-4 text-neon-pink" />
              How are you feeling?
            </h3>
            {/* Mood selector */}
            <div className="flex flex-wrap gap-2">
              {scale.points.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSelectedMood(p.value)}
                  className={`flex flex-col items-center gap-1 px-4 py-3 rounded-xl border transition-all ${
                    selectedMood === p.value
                      ? 'border-neon-pink bg-neon-pink/10 scale-105'
                      : 'border-gray-700/50 hover:border-gray-500'
                  }`}
                >
                  <span className="text-2xl">{p.emoji || p.value}</span>
                  <span className={`text-xs font-medium ${moodColor(p.value, maxMood)}`}>
                    {p.label}
                  </span>
                </button>
              ))}
            </div>

            {/* Activity tags */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Activities</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={activityInput}
                  onChange={(e) => setActivityInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addActivity();
                    }
                  }}
                  placeholder="e.g. exercise, work, sleep"
                  className="input-lattice flex-1 text-sm"
                />
                <button
                  onClick={addActivity}
                  className="btn-neon flex items-center gap-1 text-sm"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
              {activities.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {activities.map((a) => (
                    <span
                      key={a}
                      className="flex items-center gap-1 text-xs bg-cyan-500/15 text-cyan-400 px-2 py-0.5 rounded-full"
                    >
                      {a}
                      <button
                        onClick={() => setActivities(activities.filter((x) => x !== a))}
                        aria-label={`Remove ${a}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Note */}
            <div>
              <label className="text-xs text-gray-400 block mb-1">Note (optional)</label>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What's on your mind?"
                className="input-lattice w-full text-sm resize-none"
              />
            </div>

            {/* Journal prompt */}
            <div>
              <label className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                <BookOpen className="w-3.5 h-3.5" /> Reflective journaling prompt
              </label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {prompts.map((p) => (
                  <button
                    key={p.id}
                    onClick={() =>
                      setSelectedPrompt(selectedPrompt?.id === p.id ? null : p)
                    }
                    className={`text-xs px-2 py-1 rounded-lg border text-left max-w-xs ${
                      selectedPrompt?.id === p.id
                        ? 'border-neon-purple bg-neon-purple/10 text-neon-purple'
                        : 'border-gray-700/50 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {p.text}
                  </button>
                ))}
              </div>
              {selectedPrompt && (
                <textarea
                  value={promptAnswer}
                  onChange={(e) => setPromptAnswer(e.target.value)}
                  rows={2}
                  placeholder={selectedPrompt.text}
                  className="input-lattice w-full text-sm resize-none"
                />
              )}
            </div>

            <button
              onClick={submitCheckin}
              disabled={selectedMood == null || submitting}
              className="btn-neon purple w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {submitting ? 'Saving...' : 'Log Check-in'}
            </button>

            {lastResult && (
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm text-emerald-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                Logged {lastResult.entry.moodEmoji} {lastResult.entry.moodLabel} —{' '}
                {lastResult.currentStreak}-day streak (longest {lastResult.longestStreak}).
              </div>
            )}
          </div>

          {/* History */}
          <div className="panel p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-3">
              <CalendarDays className="w-4 h-4 text-neon-cyan" />
              Recent Check-ins
            </h3>
            {history && history.entries.length > 0 ? (
              <div className="space-y-1.5 max-h-72 overflow-y-auto">
                {history.entries.map((e) => (
                  <div
                    key={e.id}
                    className="lens-card flex items-start gap-3 text-sm"
                  >
                    <span className="text-xl shrink-0">{e.moodEmoji || e.mood}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${moodColor(e.mood, maxMood)}`}>
                          {e.moodLabel}
                        </span>
                        <span className="text-xs text-gray-400">
                          {new Date(e.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      {e.note && <p className="text-xs text-gray-400 mt-0.5">{e.note}</p>}
                      {e.promptAnswer && (
                        <p className="text-xs text-neon-purple/80 mt-0.5 italic">
                          {e.promptAnswer}
                        </p>
                      )}
                      {e.activities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {e.activities.map((a) => (
                            <span
                              key={a}
                              className="text-[10px] bg-cyan-500/10 text-cyan-400 px-1.5 py-0.5 rounded"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                No check-ins yet. Log your first mood above.
              </p>
            )}
          </div>
        </div>
      )}

      {/* === Trends === */}
      {subTab === 'trends' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-neon-green" />
                Mood Trends
              </h3>
              <div className="flex gap-1">
                {(['week', 'month'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGranularity(g)}
                    className={`text-xs px-2.5 py-1 rounded-lg capitalize ${
                      granularity === g
                        ? 'bg-neon-green/15 text-neon-green'
                        : 'text-gray-400 hover:bg-white/[0.04]'
                    }`}
                  >
                    {g}ly
                  </button>
                ))}
              </div>
            </div>
            {trends?.hasData ? (
              <div className="space-y-4">
                <ChartKit
                  kind="line"
                  data={trends.daily.map((d) => ({
                    day: d.day,
                    avgMood: d.avgMood,
                    count: d.count,
                  }))}
                  xKey="day"
                  series={[{ key: 'avgMood', label: 'Daily avg mood', color: '#22c55e' }]}
                  height={220}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-1">
                      {granularity === 'month' ? 'Monthly' : 'Weekly'} averages
                    </p>
                    <ChartKit
                      kind="bar"
                      data={trends.buckets.map((b) => ({
                        bucket: b.bucket,
                        avgMood: b.avgMood,
                        count: b.count,
                      }))}
                      xKey="bucket"
                      series={[{ key: 'avgMood', label: 'Avg mood', color: '#6366f1' }]}
                      height={180}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Day-of-week pattern</p>
                    <ChartKit
                      kind="bar"
                      data={trends.dayOfWeek
                        .filter((d) => d.avgMood != null)
                        .map((d) => ({ label: d.label, avgMood: d.avgMood }))}
                      xKey="label"
                      series={[{ key: 'avgMood', label: 'Avg mood', color: '#ec4899' }]}
                      height={180}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-gray-400">
                  <span>
                    Overall avg:{' '}
                    <span className="font-mono text-gray-200">{trends.overallAvg}</span>
                  </span>
                  <span>
                    Entries:{' '}
                    <span className="font-mono text-gray-200">{trends.entryCount}</span>
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-center py-8 text-gray-400 text-sm">
                No mood data yet. Log a few check-ins to see trends.
              </p>
            )}
          </div>

          {/* Export */}
          <div className="panel p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-2">
              <Download className="w-4 h-4 text-neon-cyan" />
              Emotional Report Export
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              Download your check-in history for personal records or to share with a clinician.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => exportReport('csv')}
                disabled={exporting || !(history && history.totalCheckins > 0)}
                className="btn-neon flex items-center gap-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {exporting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Download className="w-3.5 h-3.5" />
                )}
                Export CSV
              </button>
              <button
                onClick={() => exportReport('json')}
                disabled={exporting || !(history && history.totalCheckins > 0)}
                className="btn-neon flex items-center gap-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                Export JSON
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Activities === */}
      {subTab === 'activities' && (
        <div className="panel p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-neon-cyan" />
            Activity Correlations
          </h3>
          {correlation?.hasData ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {correlation.topLift && (
                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                    <p className="text-xs text-emerald-400 font-medium">You feel better after</p>
                    <p className="text-lg font-bold capitalize">
                      {correlation.topLift.activity}
                    </p>
                    <p className="text-xs text-gray-400">
                      +{correlation.topLift.delta} vs baseline {correlation.baseline}
                    </p>
                  </div>
                )}
                {correlation.topDrain && (
                  <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                    <p className="text-xs text-rose-400 font-medium">You feel worse after</p>
                    <p className="text-lg font-bold capitalize">
                      {correlation.topDrain.activity}
                    </p>
                    <p className="text-xs text-gray-400">
                      {correlation.topDrain.delta} vs baseline {correlation.baseline}
                    </p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                {correlation.correlations.map((c) => (
                  <div
                    key={c.activity}
                    className="lens-card flex items-center gap-3 text-sm"
                  >
                    <span className="flex-1 capitalize font-medium">{c.activity}</span>
                    <span className="text-xs text-gray-400">{c.samples} logs</span>
                    <div className="w-28 h-2 bg-lattice-deep rounded-full overflow-hidden relative">
                      <div
                        className={`h-full absolute top-0 ${
                          c.delta >= 0
                            ? 'bg-emerald-500 left-1/2'
                            : 'bg-rose-500 right-1/2'
                        }`}
                        style={{
                          width: `${Math.min(50, Math.abs(c.delta) * 25)}%`,
                        }}
                      />
                    </div>
                    <span
                      className={`text-xs font-mono w-14 text-right ${
                        c.effect === 'lifts'
                          ? 'text-emerald-400'
                          : c.effect === 'lowers'
                            ? 'text-rose-400'
                            : 'text-gray-400'
                      }`}
                    >
                      {c.delta > 0 ? '+' : ''}
                      {c.delta}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-center py-8 text-gray-400 text-sm">
              No correlations yet. Tag activities on your check-ins (at least 2 logs per
              activity) to see what lifts your mood.
            </p>
          )}
        </div>
      )}

      {/* === Reminders === */}
      {subTab === 'reminders' && (
        <div className="space-y-4">
          {nudgeData && nudgeData.due.length > 0 && (
            <div className="space-y-1.5">
              {nudgeData.due.map((n) => (
                <div
                  key={n.reminderId + n.type}
                  className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-sm flex items-center gap-2"
                >
                  <Bell className="w-4 h-4 shrink-0" />
                  {n.message}
                </div>
              ))}
            </div>
          )}
          <div className="panel p-4 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-neon-yellow" />
              Mood Reminders &amp; Nudges
            </h3>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Time</label>
                <input
                  type="time"
                  value={newReminderTime}
                  onChange={(e) => setNewReminderTime(e.target.value)}
                  className="input-lattice text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Trigger</label>
                <select
                  value={newReminderCond}
                  onChange={(e) =>
                    setNewReminderCond(
                      e.target.value as 'daily' | 'streak_risk' | 'low_mood',
                    )
                  }
                  className="input-lattice text-sm"
                >
                  <option value="daily">Daily</option>
                  <option value="streak_risk">Streak at risk</option>
                  <option value="low_mood">Low mood detected</option>
                </select>
              </div>
              <input
                type="text"
                value={newReminderLabel}
                onChange={(e) => setNewReminderLabel(e.target.value)}
                placeholder="Label (optional)"
                className="input-lattice text-sm flex-1 min-w-[8rem]"
              />
              <button
                onClick={addReminder}
                className="btn-neon flex items-center gap-1 text-sm"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>

            {nudgeData && nudgeData.reminders.length > 0 ? (
              <div className="space-y-1.5">
                {nudgeData.reminders.map((r) => (
                  <div
                    key={r.id}
                    className="lens-card flex items-center gap-3 text-sm"
                  >
                    <span className="font-mono text-gray-300">{r.time}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-300">{r.label}</p>
                      <p className="text-xs text-gray-400">
                        {CONDITION_LABEL[r.condition] || r.condition}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleReminder(r)}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        r.enabled
                          ? 'bg-emerald-500/20 text-emerald-400'
                          : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {r.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-6 text-gray-400 text-sm">
                No reminders configured. Add one above to get nudged to check in.
              </p>
            )}
          </div>
        </div>
      )}

      {/* === Scale === */}
      {subTab === 'scale' && (
        <div className="panel p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-neon-purple" />
              Customizable Mood Scale
            </h3>
            {isCustomScale && (
              <span className="text-xs bg-neon-purple/15 text-neon-purple px-2 py-0.5 rounded-full">
                Custom
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400">
            Adjust the labels and emoji for each mood level (2&ndash;10 points). Values must
            be unique.
          </p>
          <div className="space-y-2">
            {scaleDraft.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="number"
                  value={p.value}
                  onChange={(e) => {
                    const next = [...scaleDraft];
                    next[i] = { ...p, value: Number(e.target.value) };
                    setScaleDraft(next);
                  }}
                  className="input-lattice w-16 text-sm"
                  aria-label={`Level ${i + 1} value`}
                />
                <input
                  type="text"
                  value={p.emoji}
                  onChange={(e) => {
                    const next = [...scaleDraft];
                    next[i] = { ...p, emoji: e.target.value };
                    setScaleDraft(next);
                  }}
                  className="input-lattice w-16 text-sm text-center"
                  placeholder="emoji"
                  aria-label={`Level ${i + 1} emoji`}
                />
                <input
                  type="text"
                  value={p.label}
                  onChange={(e) => {
                    const next = [...scaleDraft];
                    next[i] = { ...p, label: e.target.value };
                    setScaleDraft(next);
                  }}
                  className="input-lattice flex-1 text-sm"
                  placeholder="label"
                  aria-label={`Level ${i + 1} label`}
                />
                {scaleDraft.length > 2 && (
                  <button
                    onClick={() => setScaleDraft(scaleDraft.filter((_, j) => j !== i))}
                    aria-label={`Remove level ${i + 1}`}
                    className="text-gray-400 hover:text-rose-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap">
            {scaleDraft.length < 10 && (
              <button
                onClick={() =>
                  setScaleDraft([
                    ...scaleDraft,
                    {
                      value:
                        Math.max(0, ...scaleDraft.map((p) => p.value)) + 1,
                      label: `Level ${scaleDraft.length + 1}`,
                      emoji: '',
                    },
                  ])
                }
                className="btn-neon flex items-center gap-1 text-sm"
              >
                <Plus className="w-3.5 h-3.5" /> Add Level
              </button>
            )}
            <button
              onClick={saveScale}
              disabled={scaleSaving || scaleDraft.length < 2}
              className="btn-neon purple flex items-center gap-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {scaleSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Save Scale
            </button>
            {isCustomScale && (
              <button
                onClick={resetScale}
                disabled={scaleSaving}
                className="btn-neon flex items-center gap-1.5 text-sm disabled:opacity-40"
              >
                Reset to Default
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
