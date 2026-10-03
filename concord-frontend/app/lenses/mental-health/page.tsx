'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrisisPanel } from '@/components/mental-health/CrisisPanel';
import { MentalHealthSection } from '@/components/mental-health/MentalHealthSection';
import { MentalHealthActionPanel } from '@/components/mental-health/MentalHealthActionPanel';
import { MedlinePlusPanel } from '@/components/health/MedlinePlusPanel';
import { PipingProvider } from '@/components/panel-polish';
import { lensRun } from '@/lib/api/client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Brain, Heart, Shield, AlertTriangle, Sparkles, Loader2, LifeBuoy, Sun, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';

// `copingStrategies` and `wellnessScore` (server/domains/mentalhealth.js) are
// the two real macros in this domain with no other bespoke home — every other
// macro (mood/sleep/breathing/gratitude/companion/factors/calendar/reminders/
// worksheets/safety-plan/therapist-report, crisis-hotlines, cdc stats,
// moodTracker, journalPrompt) is already wired into MentalHealthSection /
// CrisisPanel / MentalHealthActionPanel below. Both are stateless
// pure-compute handlers — no persisted artifact needed, so they're called
// directly via `lensRun` per the lens.run virtual-artifact contract
// (POST /api/lens/run builds `artifact.data` straight from the input body).
const TRIGGER_OPTIONS = ['anxiety', 'depression', 'stress', 'anger', 'grief'] as const;

interface CopingResult { triggers: number; strategies: string[]; categories: string[]; note?: string }
interface WellnessResult { wellnessScore: number; breakdown: Record<string, string>; areas: string[] }

type MhView = 'today' | 'analysis' | 'toolkit' | 'support';

const VIEWS: { id: MhView; label: string; keys: string; title: string; hint: string; icon: typeof Sun }[] = [
  { id: 'today', label: 'Today', keys: '1', title: 'How are you feeling', hint: 'Check-ins, mood, sleep, breathing and practice', icon: Sun },
  { id: 'analysis', label: 'Analysis', keys: '2', title: 'Make sense of it', hint: 'Coping strategies and your wellness score', icon: Brain },
  { id: 'toolkit', label: 'Toolkit', keys: '3', title: 'Everything in reach', hint: 'Worksheets, safety plan, reminders and therapist report', icon: Wrench },
  { id: 'support', label: 'Support', keys: '4', title: 'You are not alone', hint: 'Crisis lines and trusted health information', icon: LifeBuoy },
];

export default function MentalHealthLensPage() {
  useLensNav('mental-health');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<MhView>('today');
  useLensCommand([
    ...VIEWS.map((v) => ({
      id: `mental-health-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setView(v.id),
    })),
  ], { lensId: 'mental-health' });
  const current = VIEWS.find((v) => v.id === view)!;

  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('mental-health');

  // ── Coping strategies ──────────────────────────────────────────────
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);
  const [copingBusy, setCopingBusy] = useState(false);
  const [copingResult, setCopingResult] = useState<CopingResult | null>(null);
  const [copingError, setCopingError] = useState<string | null>(null);

  const toggleTrigger = (t: string) =>
    setSelectedTriggers((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const runCoping = async () => {
    if (selectedTriggers.length === 0) { setCopingError('Pick at least one trigger.'); return; }
    setCopingBusy(true); setCopingError(null);
    try {
      const r = await lensRun<CopingResult>('mental-health', 'copingStrategies', { triggers: selectedTriggers });
      if (r.data?.ok === false || !r.data?.result) { setCopingError(r.data?.error || 'Request failed.'); setCopingResult(null); }
      else setCopingResult(r.data.result);
    } catch (e) {
      setCopingError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setCopingBusy(false);
    }
  };

  // ── Wellness score ─────────────────────────────────────────────────
  const [sleepHours, setSleepHours] = useState('7');
  const [exerciseMinutes, setExerciseMinutes] = useState('0');
  const [socialInteractions, setSocialInteractions] = useState('0');
  const [moodScore, setMoodScore] = useState('5');
  const [wellnessBusy, setWellnessBusy] = useState(false);
  const [wellnessResult, setWellnessResult] = useState<WellnessResult | null>(null);
  const [wellnessError, setWellnessError] = useState<string | null>(null);

  const runWellness = async () => {
    setWellnessBusy(true); setWellnessError(null);
    try {
      const r = await lensRun<WellnessResult>('mental-health', 'wellnessScore', {
        sleepHours: Number(sleepHours) || 0,
        exerciseMinutes: Number(exerciseMinutes) || 0,
        socialInteractions: Number(socialInteractions) || 0,
        moodScore: Number(moodScore) || 0,
      });
      if (r.data?.ok === false || !r.data?.result) { setWellnessError(r.data?.error || 'Request failed.'); setWellnessResult(null); }
      else setWellnessResult(r.data.result);
    } catch (e) {
      setWellnessError(e instanceof Error ? e.message : 'Request failed.');
    } finally {
      setWellnessBusy(false);
    }
  };

  return (
    <LensShell lensId="mental-health" asMain={false}>
      <FirstRunTour lensId="mental-health" />
      <DepthBadge lensId="mental-health" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="mental-health"
        crumb="Mental health"
        title={`${current.title}${view === 'today' && who ? `, ${who}` : ''}`}
        subtitle="Mood tracking, journaling, coping strategies and crisis support. For self-reflection, not treatment."
        actions={(
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="mental-health" data={{}} compact />
          </>
        )}
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={view}
        onTab={(id) => setView(id as MhView)}
        tabsLabel="Mental health views"
        cta={{ label: 'Find a coping strategy', icon: Sparkles, onClick: () => setView('analysis'), title: 'Pick what you are dealing with and get strategies' }}
      >
        <div data-lens-theme="mental-health" className="space-y-5">
      {/* Disclaimer */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm text-amber-200">
            Not medical advice. This tool is for self-reflection and tracking only. It is not a substitute for professional mental health care. If you are in crisis, contact a mental health professional or call 988 (Suicide &amp; Crisis Lifeline).
          </p>
        </div>
      </div>


          {view === 'today' && (
            <>
              <MentalHealthSection />
      <RealtimeDataPanel domain="mental-health" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

            </>
          )}
          {view === 'analysis' && (
            <>
      {/* ── Coping strategies + wellness score ── */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 rounded-2xl border border-white/10 bg-[#111] p-4">
        <div className="flex items-center gap-2 mb-1">
          <Brain className="w-4 h-4 text-neon-purple" />
          <h2 className="font-semibold text-sm">Wellness Analysis</h2>
          <span className="text-xs text-gray-400 ml-auto">Coping strategies · Wellness score</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Coping Strategies */}
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 space-y-3">
            <span className="text-xs font-semibold text-neon-cyan uppercase tracking-wider flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> Coping Strategies
            </span>
            <p className="text-xs text-gray-400">What are you dealing with right now?</p>
            <div className="flex flex-wrap gap-1.5">
              {TRIGGER_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleTrigger(t)}
                  aria-pressed={selectedTriggers.includes(t)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-xs border transition-colors capitalize',
                    selectedTriggers.includes(t)
                      ? 'bg-neon-cyan/20 border-neon-cyan/40 text-neon-cyan'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10'
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={runCoping}
              disabled={copingBusy}
              className="px-3 py-1.5 text-xs bg-neon-cyan/20 border border-neon-cyan/30 rounded-lg hover:bg-neon-cyan/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {copingBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Get strategies
            </button>
            {copingError && <p className="text-xs text-red-400">{copingError}</p>}
            {copingResult && (
              <div className="space-y-1.5 pt-1">
                {copingResult.note && <p className="text-xs text-amber-400/80 bg-amber-500/10 rounded p-2">{copingResult.note}</p>}
                {copingResult.strategies.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-gray-300 bg-white/5 rounded p-1.5">
                    <Heart className="w-3 h-3 text-neon-pink shrink-0" /> {s}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Wellness Score */}
          <div className="rounded-lg border border-pink-500/20 bg-pink-500/5 p-4 space-y-3">
            <span className="text-xs font-semibold text-pink-400 uppercase tracking-wider flex items-center gap-1.5">
              <Heart className="w-3.5 h-3.5" /> Wellness Score
            </span>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-400">
                Sleep (hrs)
                <input
                  type="number" min={0} max={24} step={0.5} value={sleepHours}
                  onChange={(e) => setSleepHours(e.target.value)}
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Exercise (min)
                <input
                  type="number" min={0} max={600} value={exerciseMinutes}
                  onChange={(e) => setExerciseMinutes(e.target.value)}
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Social interactions
                <input
                  type="number" min={0} max={50} value={socialInteractions}
                  onChange={(e) => setSocialInteractions(e.target.value)}
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </label>
              <label className="text-xs text-gray-400">
                Mood (1-10)
                <input
                  type="number" min={1} max={10} value={moodScore}
                  onChange={(e) => setMoodScore(e.target.value)}
                  className="mt-1 w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={runWellness}
              disabled={wellnessBusy}
              className="px-3 py-1.5 text-xs bg-pink-500/20 border border-pink-500/30 rounded-lg hover:bg-pink-500/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {wellnessBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Compute score
            </button>
            {wellnessError && <p className="text-xs text-red-400">{wellnessError}</p>}
            {wellnessResult && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-4">
                  <div className="relative w-16 h-16 shrink-0">
                    {(() => {
                      const score = wellnessResult.wellnessScore;
                      const radius = 28;
                      const circumference = 2 * Math.PI * radius;
                      const offset = circumference - (score / 100) * circumference;
                      const color = score >= 75 ? '#4ade80' : score >= 50 ? '#22d3ee' : score >= 25 ? '#facc15' : '#f87171';
                      return (
                        <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                          <circle cx="32" cy="32" r={radius} fill="none" stroke="#27272a" strokeWidth="6" />
                          <motion.circle
                            cx="32" cy="32" r={radius} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
                            strokeDasharray={circumference}
                            initial={{ strokeDashoffset: circumference }}
                            animate={{ strokeDashoffset: offset }}
                            transition={{ duration: 0.8 }}
                          />
                          <text x="32" y="37" textAnchor="middle" fill="white" fontSize="12" fontWeight="bold" className="rotate-90 origin-center">{score}</text>
                        </svg>
                      );
                    })()}
                  </div>
                  <div className="flex-1 space-y-1">
                    {Object.entries(wellnessResult.breakdown || {}).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-xs">
                        <span className="text-gray-400 capitalize">{key}</span>
                        <span className="text-gray-300 font-mono">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {Array.isArray(wellnessResult.areas) && wellnessResult.areas.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {wellnessResult.areas.map((a, i) => (
                      <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-pink-500/15 text-pink-300">{a}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>

            </>
          )}
          {view === 'toolkit' && (
            <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
              <PipingProvider>
                <MentalHealthActionPanel />
              </PipingProvider>
            </section>
          )}
          {view === 'support' && (
            <>
      {/* Bespoke 988 + national crisis hotline reference with Save-as-DTU */}
      <section className="rounded-2xl border border-white/10 bg-[#111] p-4">
        <CrisisPanel />
      </section>

              <MedlinePlusPanel initialQuery="" />
            </>
          )}
        </div>
      </NorthStarFrame>
    </LensShell>
  );
}
