'use client';

/**
 * Privacy — one OneTrust/GitHub-settings consent desk.
 *
 * Single view union (consent | dpo | controls | feed). Accordion booleans
 * for DPO / Data Controls / PrivacyFeed are gone. Page is a thin shell.
 */

import { useMemo, useState, type ComponentType } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Shield, Scale, Database, MessageCircle } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ConsentPanel } from '@/components/privacy/ConsentPanel';
import { DpoStudioPanel } from '@/components/privacy/DpoStudioPanel';
import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';
import { PrivacyFeed } from '@/components/privacy/PrivacyFeed';

type PrivacyView = 'consent' | 'dpo' | 'controls' | 'feed';

const VIEWS: { id: PrivacyView; label: string; keys: string; hint: string; icon: typeof Shield }[] = [
  { id: 'consent', label: 'Consent', keys: '1', hint: 'Sharing toggles · save ⌘S', icon: Shield },
  { id: 'dpo', label: 'DPO studio', keys: '2', hint: 'Inventory · DPIA · breach', icon: Scale },
  { id: 'controls', label: 'Data controls', keys: '3', hint: 'DSAR · export · retention', icon: Database },
  { id: 'feed', label: 'Discussion', keys: '4', hint: 'External privacy reference', icon: MessageCircle },
];

const PANELS: Record<PrivacyView, ComponentType> = {
  consent: ConsentPanel,
  dpo: DpoStudioPanel,
  controls: DataControlsPanel,
  feed: PrivacyFeed,
};

export default function PrivacySharingPage() {
  useLensNav('privacy');
  useLensIdentity('privacy');
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<PrivacyView>('consent');

  useLensCommand(
    VIEWS.map((v) => ({
      id: `view-${v.id}`,
      keys: v.keys,
      description: `${v.label} — ${v.hint}`,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'privacy' },
  );

  const Panel = PANELS[active];
  const motionProps = useMemo(
    () => (reduceMotion
      ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1 }, transition: { duration: 0 } }
      : {
          initial: { opacity: 0, y: 8 },
          animate: { opacity: 1, y: 0 },
          exit: { opacity: 0, y: -6 },
          transition: { duration: 0.16 },
        }),
    [reduceMotion],
  );

  return (
    <LensShell lensId="privacy" asMain={false}>
      <FirstRunTour lensId="privacy" />
      <DepthBadge lensId="privacy" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="privacy"
        crumb="Privacy"
        title={`What you share${who ? `, ${who}` : ''}`}
        subtitle="Consent, DPO studio and data controls in one privacy desk"
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => setActive(id as PrivacyView)}
        tabsLabel="Privacy views"
        cta={{ label: 'Request my data', icon: Database, onClick: () => setActive('controls'), title: 'Open data controls: DSAR, export, retention' }}
      >
      <AnimatePresence mode="wait">
        <motion.div key={active} {...motionProps}>
          <Panel />
        </motion.div>
      </AnimatePresence>

      </NorthStarFrame>
    </LensShell>
  );
}
