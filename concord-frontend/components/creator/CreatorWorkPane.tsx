'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { CrtAudiencePanel } from './CrtAudiencePanel';
import { CrtCalendarPanel } from './CrtCalendarPanel';
import { CrtCommentsPanel } from './CrtCommentsPanel';
import { CrtDemographicsPanel } from './CrtDemographicsPanel';
import { CrtMembershipPanel } from './CrtMembershipPanel';
import { CrtPayoutPanel } from './CrtPayoutPanel';
import { CrtPerformancePanel } from './CrtPerformancePanel';
import { CrtPipelinePanel } from './CrtPipelinePanel';
import { CrtRevenueChartPanel } from './CrtRevenueChartPanel';
import { CrtRevenuePanel } from './CrtRevenuePanel';
import { CrtScheduledPanel } from './CrtScheduledPanel';
import { CascadeTreePanel } from './CascadeTreePanel';
import { FollowersPanel } from './FollowersPanel';
import { ListingsPanel } from './ListingsPanel';
import { OverviewPanel } from './OverviewPanel';
import { ProfilePanel } from './ProfilePanel';
import { useCreator } from './CreatorProvider';
import type { CreatorView } from './types';

function Pane({ view }: { view: CreatorView }) {
  const { refreshStudio } = useCreator();
  switch (view) {
    case 'home': return <OverviewPanel />;
    case 'pipeline': return <CrtPipelinePanel onChange={refreshStudio} />;
    case 'listings': return <ListingsPanel />;
    case 'scheduled': return <CrtScheduledPanel />;
    case 'calendar': return <CrtCalendarPanel />;
    case 'comments': return <CrtCommentsPanel />;
    case 'audience': return <CrtAudiencePanel onChange={refreshStudio} />;
    case 'demographics': return <CrtDemographicsPanel />;
    case 'performance': return <CrtPerformancePanel />;
    case 'trends': return <CrtRevenueChartPanel />;
    case 'followers': return <FollowersPanel />;
    case 'revenue': return <CrtRevenuePanel onChange={refreshStudio} />;
    case 'membership': return <CrtMembershipPanel onChange={refreshStudio} />;
    case 'payouts': return <CrtPayoutPanel />;
    case 'cascade': return <CascadeTreePanel />;
    case 'profile': return <ProfilePanel />;
  }
}

export function CreatorWorkPane() {
  const { view } = useCreator();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={view}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        className="min-w-0 flex-1"
      >
        <Pane view={view} />
      </motion.div>
    </AnimatePresence>
  );
}
