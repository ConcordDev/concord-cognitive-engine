'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Heart, Shield, Activity, Smile, Frown, Meh, AlertTriangle, Plus, Trash2, Layers, ChevronDown, Calendar, Clock, Sparkles, Search, Loader2, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type MoodLevel = 'great' | 'good' | 'neutral' | 'low' | 'crisis';

interface MoodEntry {
  date: string;
  mood: MoodLevel;
  score: number;
  notes: string;
  triggers: string[];
  copingUsed: string[];
}

interface JournalEntry {
  date: string;
  content: string;
  sentiment: number;
  tags: string[];
}

const MOOD_CONFIG: Record<MoodLevel, { label: string; color: string; icon: React.ElementType }> = {
  great: { label: 'Great', color: 'text-green-400', icon: Smile },
  good: { label: 'Good', color: 'text-neon-cyan', icon: Smile },
  neutral: { label: 'Neutral', color: 'text-yellow-400', icon: Meh },
  low: { label: 'Low', color: 'text-orange-400', icon: Frown },
  crisis: { label: 'Crisis', color: 'text-red-400', icon: AlertTriangle },
};

export default function MentalHealthLensPage() {
  useLensNav('mental-health');

  const [activeTab, setActiveTab] = useState<'mood' | 'journal' | 'coping' | 'resources'>('mood');
  const [showFeatures, setShowFeatures] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('mental-health');

  const { items: moodItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('mental-health', 'mood', { seed: [] });
  const { items: journalItems, create: createJournal, remove: removeJournal } = useLensData<Record<string, unknown>>('mental-health', 'journal', { seed: [] });
  const { items: copingItems, create: createCoping } = useLensData<Record<string, unknown>>('mental-health', 'coping', { seed: [] });
  const runAction = useRunArtifact('mental-health');

  const moods = moodItems.map(i => ({ id: i.id, ...(i.data || {}) })) as unknown as (MoodEntry & { id: string })[];
  const journals = journalItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (JournalEntry & { id: string; title: string })[];

  const [newMood, setNewMood] = useState<MoodLevel>('neutral');
  const [newNotes, setNewNotes] = useState('');
  const [journalText, setJournalText] = useState('');

  // --- Domain action state ---
  const [mhActionRunning, setMhActionRunning] = useState<string | null>(null);
  const [moodTrackerResult, setMoodTrackerResult] = useState<Record<string, unknown> | null>(null);
  const [copingResult, setCopingResult] = useState<Record<string, unknown> | null>(null);
  const [wellnessResult, setWellnessResult] = useState<Record<string, unknown> | null>(null);
  const [journalPromptResult, setJournalPromptResult] = useState<Record<string, unknown> | null>(null);

  const handleMhAction = async (
    action: string,
    setter: (val: Record<string, unknown> | null) => void
  ) => {
    setMhActionRunning(action);
    try {
      const artifactId = moodItems[0]?.id || 'mental-health';
      const res = await runAction.mutateAsync({ id: artifactId, action });
      if (res.ok === false) { setter({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` } as Record<string, unknown>); } else { setter((res.result as Record<string, unknown>) || null); }
    } catch (e) {
      console.error(`Mental-health action ${action} failed:`, e);
    }
    setMhActionRunning(null);
  };

  const logMood = () => {
    create({
      title: `Mood: ${newMood}`,
      data: {
        date: new Date().toISOString(),
        mood: newMood,
        score: { great: 5, good: 4, neutral: 3, low: 2, crisis: 1 }[newMood],
        notes: newNotes,
        triggers: [],
        copingUsed: [],
      },
    });
    setNewNotes('');
  };

  const saveJournal = () => {
    if (!journalText.trim()) return;
    createJournal({
      title: `Journal ${new Date().toLocaleDateString()}`,
      data: {
        date: new Date().toISOString(),
        content: journalText,
        sentiment: 0,
        tags: [],
      },
    });
    setJournalText('');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-purple border-t-transparent rounded-full animate-spin mx-auto" />
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
    <div data-lens-theme="mental-health" className="p-6 space-y-6">
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-amber-200">
            Not medical advice. This tool is for self-reflection and tracking only. It is not a substitute for professional mental health care. If you are in crisis, contact a mental health professional or call 988 (Suicide & Crisis Lifeline).
          </p>
        </div>
      </div>

      <motion.header initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-8 h-8 text-neon-purple" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Mental Health & Wellbeing</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">Mood tracking, journaling, and coping strategies</p>
          </div>
        </div>
        <button
          onClick={() => { runAction.mutate({ id: 'mental-health', action: 'wellnessScore' }, { onError: (e) => { console.error('Action failed:', e); } }); }}
          className="px-3 py-1.5 text-xs bg-neon-purple/20 border border-neon-purple/30 rounded-lg hover:bg-neon-purple/30 flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" /> Insights
        </button>
      </motion.header>

      {/* Search */}
      <div className="relative">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search moods, journals, strategies..."
          className="w-full bg-black/30 border border-white/10 rounded-lg pl-3 pr-8 py-2 text-sm placeholder:text-gray-500 focus:outline-none focus:border-neon-purple/30"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
            <Plus className="w-4 h-4 rotate-45" />
          </button>
        )}
      </div>

      {/* Stat Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(() => {
          const totalEntries = moods.length;
          const journalCount = journals.length;
          const avgScore = totalEntries > 0 ? (moods.reduce((s, m) => s + (m.score || 3), 0) / totalEntries) : 0;
          const recentMood = moods.length > 0 ? (MOOD_CONFIG[moods[0]?.mood] || MOOD_CONFIG.neutral) : MOOD_CONFIG.neutral;
          return [
            { icon: Activity, label: 'Mood Entries', value: totalEntries, color: 'text-purple-400', bg: 'bg-purple-400/10' },
            { icon: Heart, label: 'Journal Entries', value: journalCount, color: 'text-pink-400', bg: 'bg-pink-400/10' },
            { icon: recentMood.icon, label: 'Recent Mood', value: recentMood.label, color: recentMood.color, bg: 'bg-cyan-400/10' },
            { icon: Calendar, label: 'Avg Score', value: avgScore > 0 ? avgScore.toFixed(1) : '—', color: 'text-green-400', bg: 'bg-green-400/10' },
          ].map((stat, i) => (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.35 }}
              className="panel p-3 flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${stat.bg}`}>
                <stat.icon className={`w-5 h-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-xl font-bold text-white">{stat.value}</p>
                <p className="text-xs text-gray-400">{stat.label}</p>
              </div>
            </motion.div>
          ));
        })()}
      </div>

      {/* Wellness Score Ring */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="panel p-4">
        <h3 className="font-semibold mb-3 flex items-center gap-2"><Activity className="w-4 h-4 text-neon-purple" /> Wellness Score</h3>
        <div className="flex items-center gap-6">
          {/* SVG Ring Indicator */}
          <div className="relative w-24 h-24">
            {(() => {
              const avgScore = moods.length > 0 ? moods.reduce((s, m) => s + (m.score || 3), 0) / moods.length : 0;
              const pct = (avgScore / 5) * 100;
              const radius = 40;
              const circumference = 2 * Math.PI * radius;
              const offset = circumference - (pct / 100) * circumference;
              const ringColor = pct >= 80 ? '#4ade80' : pct >= 60 ? '#22d3ee' : pct >= 40 ? '#facc15' : pct >= 20 ? '#fb923c' : '#f87171';
              return (
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r={radius} fill="none" stroke="#27272a" strokeWidth="8" />
                  <motion.circle cx="50" cy="50" r={radius} fill="none" stroke={ringColor} strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: 1, delay: 0.5 }} />
                  <text x="50" y="55" textAnchor="middle" fill="white" fontSize="18" fontWeight="bold" className="rotate-90 origin-center">{Math.round(pct)}%</text>
                </svg>
              );
            })()}
          </div>
          {/* Mood Color Tracker (last 7 entries) */}
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-2">Recent Mood Trend</p>
            <div className="flex gap-1">
              {moods.slice(0, 14).reverse().map((entry, i) => {
                const cfg = MOOD_CONFIG[entry.mood] || MOOD_CONFIG.neutral;
                const colorMap: Record<string, string> = { 'text-green-400': 'bg-green-400', 'text-neon-cyan': 'bg-cyan-400', 'text-yellow-400': 'bg-yellow-400', 'text-orange-400': 'bg-orange-400', 'text-red-400': 'bg-red-400' };
                return <motion.div key={entry.id || i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: i * 0.05 }}
                  className={cn('w-4 h-8 rounded-sm', colorMap[cfg.color] || 'bg-gray-600')}
                  style={{ height: `${(entry.score || 3) * 8}px`, minHeight: '8px' }}
                  title={`${cfg.label} - ${entry.date ? new Date(entry.date).toLocaleDateString() : ''}`} />;
              })}
              {moods.length === 0 && <p className="text-xs text-gray-600">No entries yet</p>}
            </div>
          </div>
        </div>
      </motion.div>

      {/* Session History Timeline */}
      {moods.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.45 }} className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Clock className="w-4 h-4 text-neon-cyan" /> Session Timeline</h3>
          <div className="relative border-l-2 border-zinc-700 ml-3 space-y-3">
            {moods.slice(0, 5).map((entry) => {
              const cfg = MOOD_CONFIG[entry.mood] || MOOD_CONFIG.neutral;
              const Icon = cfg.icon;
              return (
                <div key={entry.id} className="flex items-start gap-3 pl-4 relative">
                  <div className={cn('absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-zinc-900', cfg.color === 'text-green-400' ? 'bg-green-400' : cfg.color === 'text-neon-cyan' ? 'bg-cyan-400' : cfg.color === 'text-yellow-400' ? 'bg-yellow-400' : cfg.color === 'text-orange-400' ? 'bg-orange-400' : 'bg-red-400')} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Icon className={cn('w-4 h-4', cfg.color)} />
                      <span className={cn('text-sm font-medium', cfg.color)}>{cfg.label}</span>
                      <span className="text-xs text-gray-500">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</span>
                    </div>
                    {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      <RealtimeDataPanel domain="mental-health" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      {/* ── Mental Health Domain Action Panel ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="panel space-y-4 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-neon-purple" />
          <h2 className="font-semibold text-sm">Wellness Analysis Engine</h2>
          <span className="text-xs text-gray-500 ml-auto">Track • Strategize • Score • Reflect</span>
        </div>

        {/* Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { action: 'moodTracker', label: 'Mood Tracker', setter: setMoodTrackerResult, icon: Activity, color: 'text-purple-400' },
            { action: 'copingStrategies', label: 'Coping Tips', setter: setCopingResult, icon: Shield, color: 'text-neon-cyan' },
            { action: 'wellnessScore', label: 'Wellness Score', setter: setWellnessResult, icon: Heart, color: 'text-pink-400' },
            { action: 'journalPrompt', label: 'Journal Prompt', setter: setJournalPromptResult, icon: Sparkles, color: 'text-yellow-400' },
          ].map(({ action, label, setter, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleMhAction(action, setter)}
              disabled={mhActionRunning !== null}
              className={cn('px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1.5 justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed')}
            >
              {mhActionRunning === action
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Icon className={cn('w-3.5 h-3.5', color)} />}
              {mhActionRunning === action ? 'Running…' : label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Mood Tracker Result */}
          {moodTrackerResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" /> Mood Analysis
              </span>
              {'message' in moodTrackerResult ? (
                <p className="text-xs text-gray-400">{String(moodTrackerResult.message)}</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Entries', value: String(moodTrackerResult.entries ?? '—') },
                      { label: 'Avg Mood', value: String(moodTrackerResult.avgMood ?? '—') },
                      { label: 'Variance', value: String(moodTrackerResult.variance ?? '—') },
                    ].map(({ label, value }) => (
                      <div key={label} className="lens-card text-center">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className="text-sm font-bold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Lowest', value: String(moodTrackerResult.lowest ?? '—'), color: 'text-red-400' },
                      { label: 'Highest', value: String(moodTrackerResult.highest ?? '—'), color: 'text-green-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="lens-card text-center">
                        <p className="text-xs text-gray-500">{label}</p>
                        <p className={cn('text-sm font-bold', color)}>{value}</p>
                      </div>
                    ))}
                  </div>
                  {'trend' in moodTrackerResult && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">Trend:</span>
                      <span className={cn('flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                        String(moodTrackerResult.trend) === 'improving' ? 'bg-green-500/20 text-green-400' :
                        String(moodTrackerResult.trend) === 'declining' ? 'bg-red-500/20 text-red-400' :
                        'bg-gray-500/20 text-gray-400'
                      )}>
                        {String(moodTrackerResult.trend) === 'improving' ? <TrendingUp className="w-3 h-3" /> : String(moodTrackerResult.trend) === 'declining' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                        {String(moodTrackerResult.trend)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Coping Strategies Result */}
          {copingResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" /> Coping Strategies
              </span>
              {'message' in copingResult ? (
                <p className="text-xs text-gray-400">{String(copingResult.message)}</p>
              ) : (
                <>
                  {'note' in copingResult && (
                    <p className="text-xs text-amber-400/80 bg-amber-500/10 rounded p-2">{String(copingResult.note)}</p>
                  )}
                  {Array.isArray(copingResult.strategies) && (
                    <div className="space-y-1.5">
                      {(copingResult.strategies as string[]).map((s, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs text-gray-300 bg-white/5 rounded p-1.5">
                          <Heart className="w-3 h-3 text-neon-pink shrink-0" />
                          {s}
                        </div>
                      ))}
                    </div>
                  )}
                  {'triggers' in copingResult && (
                    <p className="text-xs text-gray-500">Based on {String(copingResult.triggers)} trigger(s)</p>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Wellness Score Result */}
          {wellnessResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-4 space-y-3">
              <span className="text-xs font-semibold text-pink-400 uppercase tracking-wider flex items-center gap-1.5">
                <Heart className="w-3.5 h-3.5" /> Wellness Score
              </span>
              {'wellnessScore' in wellnessResult && (
                <>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16">
                      {(() => {
                        const score = Number(wellnessResult.wellnessScore);
                        const radius = 28;
                        const circumference = 2 * Math.PI * radius;
                        const offset = circumference - (score / 100) * circumference;
                        const color = score >= 75 ? '#4ade80' : score >= 50 ? '#22d3ee' : score >= 25 ? '#facc15' : '#f87171';
                        return (
                          <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                            <circle cx="32" cy="32" r={radius} fill="none" stroke="#27272a" strokeWidth="6" />
                            <motion.circle cx="32" cy="32" r={radius} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
                              strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: offset }} transition={{ duration: 0.8 }} />
                            <text x="32" y="37" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" className="rotate-90 origin-center">{score}</text>
                          </svg>
                        );
                      })()}
                    </div>
                    <div className="flex-1 space-y-1">
                      {'breakdown' in wellnessResult && typeof wellnessResult.breakdown === 'object' && wellnessResult.breakdown !== null && Object.entries(wellnessResult.breakdown as Record<string, string>).map(([key, val]) => (
                        <div key={key} className="flex justify-between text-xs">
                          <span className="text-gray-500 capitalize">{key}</span>
                          <span className="text-gray-300 font-mono">{val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {Array.isArray(wellnessResult.areas) && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Focus Areas</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(wellnessResult.areas as string[]).map((a, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* Journal Prompt Result */}
          {journalPromptResult && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> Journal Prompts
                </span>
                {'mood' in journalPromptResult && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 capitalize">
                    {String(journalPromptResult.mood)}
                  </span>
                )}
              </div>
              {Array.isArray(journalPromptResult.prompts) && (
                <div className="space-y-2">
                  {(journalPromptResult.prompts as string[]).map((p, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs p-2 rounded bg-white/5">
                      <span className="w-5 h-5 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">{i + 1}</span>
                      <span className="text-gray-300">{p}</span>
                    </div>
                  ))}
                </div>
              )}
              {'instruction' in journalPromptResult && (
                <p className="text-xs text-gray-500 italic">{String(journalPromptResult.instruction)}</p>
              )}
              {'reminder' in journalPromptResult && (
                <p className="text-xs text-yellow-400/70">{String(journalPromptResult.reminder)}</p>
              )}
            </motion.div>
          )}
        </div>
      </motion.div>

      <UniversalActions domain="mental-health" artifactId={undefined} compact />
      <DTUExportButton domain="mental-health" data={{}} compact />

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['mood', 'journal', 'coping', 'resources'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-neon-purple/20 text-neon-purple border-b-2 border-neon-purple' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Mood Tab */}
      {activeTab === 'mood' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Log Mood</h3>
            <div className="flex gap-2 mb-3">
              {(Object.keys(MOOD_CONFIG) as MoodLevel[]).map(level => {
                const cfg = MOOD_CONFIG[level];
                const Icon = cfg.icon;
                return (
                  <button
                    key={level}
                    onClick={() => setNewMood(level)}
                    className={`flex-1 p-3 rounded-lg text-center transition-all ${
                      newMood === level ? 'bg-white/10 ring-1 ring-neon-purple' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <Icon className={`w-6 h-6 mx-auto mb-1 ${cfg.color}`} />
                    <span className="text-xs">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
            <textarea
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              placeholder="How are you feeling? (optional)"
              className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm resize-none h-20"
            />
            <button onClick={logMood} className="mt-2 px-4 py-2 bg-neon-purple/20 text-neon-purple rounded-lg text-sm hover:bg-neon-purple/30">
              <Plus className="w-4 h-4 inline mr-1" /> Log Mood
            </button>
          </div>

          {/* Mood History */}
          <div className="panel p-4 space-y-2">
            <h3 className="font-semibold mb-3">Mood History</h3>
            {moods.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No mood entries yet. Log your first mood above.</p>
            ) : (
              moods.filter(e => !searchQuery || (e.notes || '').toLowerCase().includes(searchQuery.toLowerCase()) || (e.mood || '').toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 20).map(entry => {
                const cfg = MOOD_CONFIG[entry.mood] || MOOD_CONFIG.neutral;
                const Icon = cfg.icon;
                return (
                  <div key={entry.id} className="flex items-center gap-3 p-2 rounded-lg bg-white/5">
                    <Icon className={`w-5 h-5 ${cfg.color}`} />
                    <div className="flex-1">
                      <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                      {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                    </div>
                    <span className="text-xs text-gray-500">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</span>
                    <button onClick={() => update(entry.id, { data: { ...entry, notes: (entry.notes || '') + ' (updated)' } as unknown as Record<string, unknown> })} className="text-gray-500 hover:text-neon-cyan" title="Edit"><Search className="w-3 h-3" /></button>
                    <button onClick={() => remove(entry.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Journal Tab */}
      {activeTab === 'journal' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">New Journal Entry</h3>
            <textarea
              value={journalText}
              onChange={e => setJournalText(e.target.value)}
              placeholder="Write your thoughts..."
              className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm resize-none h-32"
            />
            <button onClick={saveJournal} className="mt-2 px-4 py-2 bg-neon-purple/20 text-neon-purple rounded-lg text-sm hover:bg-neon-purple/30">
              Save Entry
            </button>
          </div>
          <div className="space-y-2">
            {journals.filter(e => !searchQuery || (e.content || '').toLowerCase().includes(searchQuery.toLowerCase()) || (e.title || '').toLowerCase().includes(searchQuery.toLowerCase())).map(entry => (
              <div key={entry.id} className="panel p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{entry.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{entry.date ? new Date(entry.date).toLocaleDateString() : ''}</span>
                    <button onClick={() => removeJournal(entry.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
                  </div>
                </div>
                <p className="text-sm text-gray-300">{entry.content}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coping Tab */}
      {activeTab === 'coping' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-neon-cyan" /> Coping Strategies</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {['Deep breathing', 'Grounding (5-4-3-2-1)', 'Progressive muscle relaxation', 'Journaling', 'Physical exercise', 'Mindful meditation', 'Social connection', 'Creative expression'].map(strategy => (
                <button key={strategy} onClick={() => createCoping({ title: strategy, data: { strategy, createdAt: new Date().toISOString() } })} className="lens-card flex items-center gap-2 hover:border-neon-cyan/30 transition-colors text-left">
                  <Heart className="w-4 h-4 text-neon-pink" />
                  <span className="text-sm">{strategy}</span>
                  <Plus className="w-3 h-3 ml-auto text-gray-500" />
                </button>
              ))}
            </div>
          </div>
          {/* Saved coping strategies */}
          {copingItems.length > 0 && (
            <div className="panel p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-neon-green" /> My Saved Strategies ({copingItems.length})</h3>
              <div className="space-y-2">
                {copingItems.map(item => (
                  <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                    <Heart className="w-4 h-4 text-neon-cyan" />
                    <span className="text-sm flex-1">{item.title}</span>
                    <span className="text-xs text-gray-500">{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resources Tab */}
      {activeTab === 'resources' && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Shield className="w-4 h-4 text-green-400" /> Crisis Resources</h3>
          <div className="space-y-2">
            {[
              { name: '988 Suicide & Crisis Lifeline', detail: 'Call or text 988' },
              { name: 'Crisis Text Line', detail: 'Text HOME to 741741' },
              { name: 'SAMHSA Helpline', detail: '1-800-662-4357' },
              { name: 'NAMI Helpline', detail: '1-800-950-6264' },
            ].map(r => (
              <div key={r.name} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                <span className="text-sm font-medium">{r.name}</span>
                <span className="text-sm text-neon-cyan">{r.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="mental-health" /></div>}
      </div>
    </div>
  );
}
