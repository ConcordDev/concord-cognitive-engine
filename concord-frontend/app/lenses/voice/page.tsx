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
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { cn } from '@/lib/utils';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { VoiceBoothPanel, requestVoiceRecord } from '@/components/voice/VoiceBoothPanel';
import { VoiceTranscripts } from '@/components/voice/VoiceTranscripts';
import { VoiceOtterSuite } from '@/components/voice/VoiceOtterSuite';
import { VoiceRepos } from '@/components/voice/VoiceRepos';
import { VoiceAnalyzeView } from '@/components/voice/VoiceAnalyzeView';

type VoiceView = 'booth' | 'transcripts' | 'meetings' | 'library' | 'analyze';

const VIEWS: { id: VoiceView; label: string; keys: string; title: string; hint: string; icon: typeof Mic }[] = [
  { id: 'booth', label: 'Booth', title: 'Say something', keys: '1', hint: 'Descript recorder', icon: Mic },
  { id: 'transcripts', label: 'Transcripts', title: 'Everything you said', keys: '2', hint: 'Otter workspace', icon: FileText },
  { id: 'meetings', label: 'Meetings', title: 'Who said what, live', keys: '3', hint: 'Live + studio + bot', icon: Radio },
  { id: 'library', label: 'Library', title: 'Tools for your voice', keys: '4', hint: 'Voice tooling repos', icon: Sparkles },
  { id: 'analyze', label: 'Analyze', title: 'What the voice reveals', keys: '5', hint: 'Diarize · sentiment', icon: Sliders },
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<VoiceView>('booth');
  const record = () => {
    setActive('booth');
    requestVoiceRecord();
  };

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

  const view = VIEWS.find((v) => v.id === active)!;
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
      <div data-lens-theme="voice" className="relative min-h-full px-8 pb-28 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] text-zinc-500">Voice</p>
            <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
              {view.title}{active === 'booth' && who ? `, ${who}` : ''}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-3 pt-2">
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[12px] text-amber-300">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="voice" data={realtimeData || {}} compact />
          </div>
        </div>

        <nav className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1" aria-label="Voice views">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            const on = active === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setActive(v.id)}
                aria-current={on ? 'page' : undefined}
                title={`${v.hint} (${v.keys})`}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
                <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">{v.keys}</kbd>
              </button>
            );
          })}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div key={active} {...motionProps}>
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
        <div className="mt-6"><SessionRail lensId="voice" hideWhenEmpty /></div>
        <CrossLensRecentsPanel lensId="voice" sinceDays={7} limit={6} hideWhenEmpty className="mt-6" />

        <button
          type="button"
          onClick={record}
          title="Start recording"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <Mic className="h-4 w-4" />
          Record
        </button>
      </div>
    </LensShell>
  );
}
