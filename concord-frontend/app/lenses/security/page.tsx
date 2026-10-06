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
import { Bug, Radar, Shield, ShieldAlert, Siren, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { SessionRail } from '@/components/lens/SessionRail';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
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
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
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
      <NorthStarFrame
        lensId="security"
        crumb="Security"
        title={`Watch the perimeter${active === 'soc' && who ? `, ${who}` : ''}`}
        subtitle="SIEM, cases, advisories, scanner and vulnerability management."
        actions={
          <>
            <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
            <DTUExportButton domain="security" data={realtimeData || {}} compact />
            {realtimeAlerts.length > 0 && (
              <span className="rounded-full bg-yellow-500/10 px-2.5 py-1 text-xs text-yellow-400">
                {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
              </span>
            )}
          </>
        }
        tabs={VIEWS.map((v) => ({ id: v.id, label: v.label, icon: v.icon, keys: v.keys, hint: v.hint }))}
        activeTab={active}
        onTab={(id) => setActive(id as SecurityView)}
        tabsLabel="Security views"
        cta={{ label: 'Open a case', icon: Plus, onClick: () => setActive('ops') }}
      >
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
      </NorthStarFrame>
    </LensShell>
  );
}
