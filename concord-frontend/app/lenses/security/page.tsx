'use client';

/**
 * Security lens — one CrowdStrike/Tenable SOC console.
 *
 * Single view union. Accordion booleans for advisories/scanner/vulns are
 * folded into `active`. Artifact CRUD lives in SecurityOpsPanel; SIEM
 * lives in SOCConsole. Each view owns its hooks.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Bug, Radar, Shield, ShieldAlert, Siren } from 'lucide-react';
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
import { SOCConsole } from '@/components/security/SOCConsole';
import { SecurityOpsPanel } from '@/components/security/SecurityOpsPanel';
import { SecurityAdvisories } from '@/components/security/SecurityAdvisories';
import { ThreatVulnPanel } from '@/components/security/ThreatVulnPanel';
import { VulnManager } from '@/components/security/VulnManager';

type SecurityView = 'soc' | 'ops' | 'advisories' | 'scanner' | 'vulns';

const VIEWS: { id: SecurityView; label: string; keys: string; hint: string; icon: typeof Shield }[] = [
  { id: 'soc', label: 'SOC', keys: '1', hint: 'CrowdStrike-shape SIEM', icon: Siren },
  { id: 'ops', label: 'Cases', keys: '2', hint: 'Incidents · assets · patrols', icon: Shield },
  { id: 'advisories', label: 'Advisories', keys: '3', hint: 'External CVE feed', icon: ShieldAlert },
  { id: 'scanner', label: 'Scanner', keys: '4', hint: 'Threat + vuln scan', icon: Radar },
  { id: 'vulns', label: 'Vulns', keys: '5', hint: 'Tenable/OpenCVE manager', icon: Bug },
];

const PANELS: Record<SecurityView, ComponentType> = {
  soc: SOCConsole,
  ops: SecurityOpsPanel,
  advisories: SecurityAdvisories,
  scanner: ThreatVulnPanel,
  vulns: VulnManager,
};

export default function SecurityLensPage() {
  useLensNav('security');
  useLensIdentity('security');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } =
    useRealtimeLens('security');
  const reduceMotion = useReducedMotion();
  const [active, setActive] = useState<SecurityView>('soc');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'security' },
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
    <LensShell lensId="security" asMain={false}>
      <FirstRunTour lensId="security" />
      <DepthBadge lensId="security" size="sm" className="ml-2" />
      <div data-lens-theme="security" className={ds.pageContainer}>
        <a
          href="#security-skip"
          className="sr-only focus:not-sr-only focus:ring-2 focus:ring-amber-500 focus:outline-none"
        >
          Skip to security content
        </a>
        <header className={ds.sectionHeader}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg border border-[var(--lens-accent)]/40 bg-[var(--lens-gradient)]">
              <Shield className="w-6 h-6" style={{ color: 'var(--lens-accent)' }} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={ds.heading1}>Security</h1>
                <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
                <DTUExportButton domain="security" data={realtimeData || {}} compact />
                {realtimeAlerts.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
                    {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <p className={ds.textMuted}>
                CrowdStrike SOC + Tenable vulns — SIEM, cases, advisories, scanner.
              </p>
            </div>
          </div>
        </header>

        <nav
          className="flex items-center gap-1 border-b border-lattice-border overflow-x-auto"
          aria-label="Security views"
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

        <div id="security-skip">
          <AnimatePresence mode="wait">
            <motion.div key={active} {...motionProps} className="pt-4">
              <Panel />
            </motion.div>
          </AnimatePresence>
        </div>

        {realtimeData && (
          <RealtimeDataPanel
            domain="security"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        )}
        <SessionRail lensId="security" hideWhenEmpty />
        <CrossLensRecentsPanel lensId="security" sinceDays={7} limit={6} hideWhenEmpty className="mt-3" />
      </div>
    </LensShell>
  );
}
