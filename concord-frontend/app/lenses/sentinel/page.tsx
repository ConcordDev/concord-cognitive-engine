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
  Shield, GitBranch, Radio, BarChart3, Settings2, Search,
  type LucideIcon,
} from 'lucide-react';
import { useLensNav } from '@/hooks/useLensNav';
import { LensShell } from '@/components/lens/LensShell';
import { RecentMineCard } from '@/components/lens/RecentMineCard';
import { AutoActionStrip } from '@/components/lens/AutoActionStrip';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { ManifestActionBar } from '@/components/lens/ManifestActionBar';
import { useLensCommand } from '@/hooks/useLensCommand';
import { SentinelCves } from '@/components/sentinel/SentinelCves';
import { SentinelShield } from '@/components/sentinel/SentinelShield';
import { SentinelTriage } from '@/components/sentinel/SentinelTriage';
import { SentinelMonitors } from '@/components/sentinel/SentinelMonitors';
import { SentinelMetrics } from '@/components/sentinel/SentinelMetrics';
import { SentinelScanConfig } from '@/components/sentinel/SentinelScanConfig';
import { SentinelIntel } from '@/components/sentinel/SentinelIntel';
import { SentinelSemantic } from '@/components/sentinel/SentinelSemantic';

type TabKey = 'shield' | 'triage' | 'monitors' | 'metrics' | 'rules' | 'semantic';

export default function SentinelLensPage() {
  useLensNav('sentinel');
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
    ],
    { lensId: 'sentinel' },
  );

  const tabs: { key: TabKey; label: string; icon: LucideIcon }[] = [
    { key: 'shield', label: 'Shield', icon: Shield },
    { key: 'triage', label: 'Triage', icon: GitBranch },
    { key: 'monitors', label: 'Monitors', icon: Radio },
    { key: 'metrics', label: 'Metrics', icon: BarChart3 },
    { key: 'rules', label: 'Rules', icon: Settings2 },
    { key: 'semantic', label: 'Semantic', icon: Search },
  ];

  return (
    <LensShell lensId="sentinel" asMain={false}>
      <FirstRunTour lensId="sentinel" />
      <ManifestActionBar />
      <DepthBadge lensId="sentinel" size="sm" className="ml-2" />
      <div className="min-h-screen bg-black pb-12 text-blue-50">
        <header className="sticky top-0 z-10 border-b border-blue-900/50 bg-black/95 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <Shield className="h-6 w-6 text-blue-400" aria-hidden />
            <div>
              <h1 className="font-mono text-lg font-semibold tracking-wide">Sentinel</h1>
              <p className="text-xs text-blue-700">Threat console — shield · triage · monitor · intel</p>
            </div>
          </div>
        </header>

        <nav className="border-b border-blue-900/30 px-4 md:px-8" aria-label="Sentinel sections">
          <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
                  activeTab === key
                    ? 'border-blue-400 text-blue-200'
                    : 'border-transparent text-blue-700 hover:text-blue-400'
                }`}
                aria-pressed={activeTab === key}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
              </button>
            ))}
          </div>
        </nav>

        <main className="mx-auto max-w-7xl px-4 py-6 md:px-8">
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
            </motion.section>
          </AnimatePresence>
        </main>

        <section className="mx-auto mt-6 max-w-7xl rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 md:px-8">
          <SentinelCves />
        </section>
      </div>

      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <RecentMineCard domain="sentinel" limit={10} hideWhenEmpty className="mt-4" />
        <AutoActionStrip domain="sentinel" hideWhenEmpty className="mt-3" />
        <CrossLensRecentsPanel lensId="sentinel" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
