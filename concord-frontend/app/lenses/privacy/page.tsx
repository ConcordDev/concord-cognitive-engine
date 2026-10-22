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
import { DepthBadge } from '@/components/lens/DepthBadge';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { ConsentPanel } from '@/components/privacy/ConsentPanel';
import { DpoStudioPanel } from '@/components/privacy/DpoStudioPanel';
import { DataControlsPanel } from '@/components/privacy/DataControlsPanel';
import { PrivacyFeed } from '@/components/privacy/PrivacyFeed';
import { omitCommunityRedditViews } from '@/lib/community/reddit-flag';

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
  const [active, setActive] = useState<PrivacyView>('controls');
  const navViews = omitCommunityRedditViews(VIEWS, ['feed']);

  useLensCommand(
    navViews.map((v) => ({
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

      <DepthBadge lensId="privacy" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="privacy"
        crumb="Privacy"
        subtitle="Download what is yours. Requests, sharing and flows sit in the other tabs."
        tabs={navViews}
        activeTab={active}
        onTab={(id) => setActive(id as PrivacyView)}
        tabsLabel="Privacy views"
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
