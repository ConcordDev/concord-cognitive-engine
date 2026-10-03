'use client';

/**
 * Sentinel Lens — a security threat console (CrowdStrike Falcon analog).
 *
 * Six operator surfaces over the `shield` / `intel` / `semantic` substrate
 * plus the `sentinel` workflow domain:
 *   Shield   — live threat board + on-demand scan, promote to triage
 *   Triage   — case state machine, assign / note / intel-correlate
 *   Monitors — continuous-monitoring configs + alert inbox
 *   Metrics  — time-bucketed charts + the append-only threat timeline
 *   Rules    — configurable scan scope + custom detection rules
 *   Semantic — corpus search with saved queries + result export
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Shield, GitBranch, Radio, BarChart3, Settings2, Search, FlaskConical,
  type LucideIcon,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SentinelCves } from '@/components/sentinel/SentinelCves';
import { SentinelShield } from '@/components/sentinel/SentinelShield';
import { SentinelTriage } from '@/components/sentinel/SentinelTriage';
import { SentinelMonitors } from '@/components/sentinel/SentinelMonitors';
import { SentinelMetrics } from '@/components/sentinel/SentinelMetrics';
import { SentinelScanConfig } from '@/components/sentinel/SentinelScanConfig';
import { SentinelIntel } from '@/components/sentinel/SentinelIntel';
import { SentinelSemantic } from '@/components/sentinel/SentinelSemantic';
import { SentinelResearchAccess } from '@/components/sentinel/SentinelResearchAccess';

type TabKey = 'shield' | 'triage' | 'monitors' | 'metrics' | 'rules' | 'semantic' | 'research';

export default function SentinelLensPage() {
  useLensNav('sentinel');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [activeTab, setActiveTab] = useState<TabKey>('shield');
  // Bumped whenever a triage / monitor / intel action mutates state so the
  // metrics + timeline surface refetches.
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  useLensCommand(
    [
      { id: 'tab-shield', keys: 's', description: 'Shield', category: 'navigation', action: () => setActiveTab('shield') },
      { id: 'tab-triage', keys: 't', description: 'Triage', category: 'navigation', action: () => setActiveTab('triage') },
      { id: 'tab-monitors', keys: 'o', description: 'Monitors', category: 'navigation', action: () => setActiveTab('monitors') },
      { id: 'tab-metrics', keys: 'g', description: 'Metrics', category: 'navigation', action: () => setActiveTab('metrics') },
      { id: 'tab-rules', keys: 'r', description: 'Rules', category: 'navigation', action: () => setActiveTab('rules') },
      { id: 'tab-semantic', keys: 'm', description: 'Semantic', category: 'navigation', action: () => setActiveTab('semantic') },
      { id: 'tab-research', keys: 'a', description: 'Research access', category: 'navigation', action: () => setActiveTab('research') },
    ],
    { lensId: 'sentinel' },
  );

  const tabs: { id: TabKey; label: string; icon: LucideIcon }[] = [
    { id: 'shield', label: 'Shield', icon: Shield },
    { id: 'triage', label: 'Triage', icon: GitBranch },
    { id: 'monitors', label: 'Monitors', icon: Radio },
    { id: 'metrics', label: 'Metrics', icon: BarChart3 },
    { id: 'rules', label: 'Rules', icon: Settings2 },
    { id: 'semantic', label: 'Semantic', icon: Search },
    { id: 'research', label: 'Research', icon: FlaskConical },
  ];

  return (
    <LensShell lensId="sentinel" asMain={false}>
      <FirstRunTour lensId="sentinel" />      <DepthBadge lensId="sentinel" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="sentinel"
        crumb="Sentinel"
        title={`Threat console${who ? `, ${who}` : ''}`}
        subtitle="Shield, triage, monitor and intel in one console"
        tabs={tabs}
        activeTab={activeTab}
        onTab={(id) => setActiveTab(id as TabKey)}
        tabsLabel="Sentinel sections"
        cta={{ label: 'Open triage', icon: GitBranch, onClick: () => setActiveTab('triage'), title: 'Go to the triage queue' }}
      >
          <AnimatePresence mode="wait">
            <motion.section
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === 'shield' && <SentinelShield onTriageOpened={bump} />}
              {activeTab === 'triage' && <SentinelTriage onChanged={bump} />}
              {activeTab === 'monitors' && <SentinelMonitors onChanged={bump} />}
              {activeTab === 'metrics' && <SentinelMetrics refreshKey={refreshKey} />}
              {activeTab === 'rules' && <SentinelScanConfig />}
              {activeTab === 'semantic' && (
                <div className="space-y-5">
                  <SentinelIntel onChanged={bump} />
                  <SentinelSemantic />
                </div>
              )}
              {activeTab === 'research' && <SentinelResearchAccess onChanged={bump} />}
            </motion.section>
          </AnimatePresence>
        <section className="mt-6 rounded-2xl border border-white/10 bg-[#111] p-4">
          <SentinelCves />
        </section>
      </NorthStarFrame>
    </LensShell>
  );
}
