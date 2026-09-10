'use client';

/**
 * Voice lens — one Otter/Descript recording + transcript app.
 *
 * Single view union. Accordion booleans for repos/transcripts/otter/actions
 * are folded into `active`. Transcript analysis macros live only in
 * VoiceActionPanel. Booth owns MediaRecorder + take artifacts.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FileText, Mic, Radio, Sliders, Sparkles } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VoiceBoothPanel } from '@/components/voice/VoiceBoothPanel';
import { VoiceTranscripts } from '@/components/voice/VoiceTranscripts';
import { VoiceOtterSuite } from '@/components/voice/VoiceOtterSuite';
import { VoiceRepos } from '@/components/voice/VoiceRepos';
import { VoiceAnalyzeView } from '@/components/voice/VoiceAnalyzeView';

type VoiceView = 'booth' | 'transcripts' | 'meetings' | 'library' | 'analyze';

const VIEWS: { id: VoiceView; label: string; keys: string; hint: string; icon: typeof Mic }[] = [
  { id: 'booth', label: 'Booth', keys: '1', hint: 'Descript recorder', icon: Mic },
  { id: 'transcripts', label: 'Transcripts', keys: '2', hint: 'Otter workspace', icon: FileText },
  { id: 'meetings', label: 'Meetings', keys: '3', hint: 'Live + studio + bot', icon: Radio },
  { id: 'library', label: 'Library', keys: '4', hint: 'Voice tooling repos', icon: Sparkles },
  { id: 'analyze', label: 'Analyze', keys: '5', hint: 'Diarize · sentiment', icon: Sliders },
];

const PANELS: Record<VoiceView, ComponentType> = {
  booth: VoiceBoothPanel,
  transcripts: VoiceTranscripts,
  meetings: VoiceOtterSuite,
  library: VoiceRepos,
  analyze: VoiceAnalyzeView,
};

export default function VoiceLensPage() {
  useLensNav('voice');
  useLensIdentity('voice');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('voice');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<VoiceView>('booth');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'voice' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () =>
      reduceMotion
        ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
        : {
            initial: { opacity: 0, y: 8 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: -6 },
            transition: { duration: 0.16 },
          },
    [reduceMotion],
  );

  return (
    <LensShell lensId="voice" asMain={false}>
      <FirstRunTour lensId="voice" />
      <DepthBadge lensId="voice" size="sm" className="ml-2" />
      <div data-lens-theme="voice" className={ds.pageContainer}>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Mic className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Voice</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="voice" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                Otter transcripts + Descript booth — capture, label, summarize.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Voice views"
        >
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors',
                  on
                    ? 'border-[var(--lens-accent)] text-white'
                    : 'border-transparent text-gray-400 hover:text-white hover:border-gray-600',
                )}
                aria-current={on ? 'page' : undefined}
              >
                <Icon className="w-4 h-4" />
                {v.label}
                <kbd className="hidden sm:inline-block text-[10px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5 font-mono">
                  {v.keys}
                </kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps} className="pt-4">
            <Panel />
          </motion.div>
        </AnimatePresence>

        {realtimeData && (
          <RealtimeDataPanel
            domain="voice"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
        <SessionRail lensId="voice" hideWhenEmpty />
        <CrossLensRecentsPanel lensId="voice" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
