'use client';

/**
 * Unified Self Lens — quantified-self surface.
 * Thin shell + one `active` union; panels own substrate pulls.
 */

import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { SelfFeed } from '@/components/self/SelfFeed';
import { LogMetricForm } from '@/components/self/LogMetricForm';
import { OverviewDashboard } from '@/components/self/OverviewDashboard';
import { TrendPanel } from '@/components/self/TrendPanel';
import { CorrelationPanel } from '@/components/self/CorrelationPanel';
import { GoalsPanel } from '@/components/self/GoalsPanel';
import { DigestPanel } from '@/components/self/DigestPanel';
import { StreaksPanel } from '@/components/self/StreaksPanel';
import { ImportPanel } from '@/components/self/ImportPanel';
import { FitnessSubstratePanel } from '@/components/self/FitnessSubstratePanel';
import { MoodSubstratePanel } from '@/components/self/MoodSubstratePanel';
import { SleepRedirectPanel } from '@/components/self/SleepRedirectPanel';
import { JournalRedirectPanel } from '@/components/self/JournalRedirectPanel';
import { RitualsTabPanel } from '@/components/self/RitualsTabPanel';
import { AchievementsTabPanel } from '@/components/self/AchievementsTabPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Moon, Smile, BookOpen, Activity, TrendingUp,
  Sun, Trophy, Award, Calendar, Link2, Target, ScrollText, Flame, Upload,
  type LucideIcon,
} from 'lucide-react';
import dynamic from 'next/dynamic';

const ProgressionPanelExt = dynamic(() => import('@/components/world-lens/ProgressionPanel'), { ssr: false });
const SeasonalContent = dynamic(() => import('@/components/world-lens/SeasonalContent'), { ssr: false });

type TabKey =
  | 'overview' | 'trends' | 'correlations' | 'goals' | 'digest' | 'streaks' | 'import'
  | 'fitness' | 'sleep' | 'mood' | 'journal'
  | 'rituals' | 'achievements' | 'milestones' | 'season';

const TABS: { id: TabKey; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview',     icon: TrendingUp },
  { id: 'trends', label: 'Trends',       icon: Activity },
  { id: 'correlations', label: 'Correlations', icon: Link2 },
  { id: 'goals', label: 'Goals',        icon: Target },
  { id: 'digest', label: 'Digest',       icon: ScrollText },
  { id: 'streaks', label: 'Streaks',      icon: Flame },
  { id: 'import', label: 'Import',       icon: Upload },
  { id: 'fitness', label: 'Fitness',      icon: Activity },
  { id: 'sleep', label: 'Sleep',        icon: Moon },
  { id: 'mood', label: 'Mood',         icon: Smile },
  { id: 'journal', label: 'Journal',      icon: BookOpen },
  { id: 'rituals', label: 'Rituals',      icon: Sun },
  { id: 'achievements', label: 'Achievements', icon: Trophy },
  { id: 'milestones', label: 'Milestones',   icon: Award },
  { id: 'season', label: 'Season',       icon: Calendar },
];

export default function UnifiedSelfLensPage() {
  useLensNav('self');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<TabKey>('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      { id: 'goto-overview', keys: 'o', description: 'Overview', category: 'navigation', action: () => setActive('overview') },
      { id: 'goto-trends', keys: 't', description: 'Trends', category: 'navigation', action: () => setActive('trends') },
      { id: 'goto-correlations', keys: 'c', description: 'Correlations', category: 'navigation', action: () => setActive('correlations') },
      { id: 'goto-goals', keys: 'g', description: 'Goals', category: 'navigation', action: () => setActive('goals') },
      { id: 'goto-streaks', keys: 'k', description: 'Streaks', category: 'navigation', action: () => setActive('streaks') },
      { id: 'goto-import', keys: 'i', description: 'Import', category: 'navigation', action: () => setActive('import') },
    ],
    { lensId: 'self' }
  );

  return (
    <LensShell lensId="self" asMain={false}>
      <FirstRunTour lensId="self" />
      <DepthBadge lensId="self" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="self"
        crumb="Self"
        title={`${active === 'overview' ? 'How you are doing' : (TABS.find((t) => t.id === active)?.label ?? 'Self')}${active === 'overview' && who ? `, ${who}` : ''}`}
        subtitle="Quantified-self ledger: trends, correlations, goals and streaks"
        tabs={TABS}
        activeTab={active}
        onTab={(id) => setActive(id as TabKey)}
        tabsLabel="Self sections"
        cta={{ label: 'Log a metric', icon: Plus, onClick: () => setActive('overview'), title: 'Log a reading on the overview' }}
      >
          <AnimatePresence mode="wait">
            <motion.section
              key={active}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {active === 'overview' && (
                <>
                  <div className="mb-4"><LogMetricForm onLogged={bump} /></div>
                  <OverviewDashboard refreshKey={refreshKey} onChanged={bump} />
                </>
              )}
              {active === 'trends' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Trend charts</h2><TrendPanel refreshKey={refreshKey} /></>)}
              {active === 'correlations' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Cross-metric correlations</h2><CorrelationPanel refreshKey={refreshKey} /></>)}
              {active === 'goals' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Goals &amp; targets</h2><GoalsPanel refreshKey={refreshKey} /></>)}
              {active === 'digest' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Your recap</h2><DigestPanel refreshKey={refreshKey} /></>)}
              {active === 'streaks' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Streaks</h2><StreaksPanel refreshKey={refreshKey} /></>)}
              {active === 'import' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Health-data import</h2><ImportPanel onImported={bump} /></>)}
              {active === 'fitness' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Fitness</h2><FitnessSubstratePanel /></>)}
              {active === 'sleep' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Sleep</h2><SleepRedirectPanel onLogSleep={() => setActive('overview')} /></>)}
              {active === 'mood' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Mood</h2><MoodSubstratePanel /></>)}
              {active === 'journal' && (<><h2 className="mb-3 text-base font-semibold text-rose-200">Journal</h2><JournalRedirectPanel /></>)}
              {active === 'rituals' && <RitualsTabPanel refreshKey={refreshKey} />}
              {active === 'achievements' && <AchievementsTabPanel />}
              {active === 'milestones' && <ProgressionPanelExt />}
              {active === 'season' && <SeasonalContent />}
            </motion.section>
          </AnimatePresence>

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#111] p-4">
          <h2 className="text-sm font-semibold text-white">Self-improvement discussion (external reference)</h2>
          <div className="mt-3"><SelfFeed /></div>
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
