'use client';

/**
 * Parenting lens: north-star chrome over baby and child tracking (feeds,
 * sleep, diapers, growth, milestones, immunizations, caregiver sharing), the
 * shared family calendar, developmental brief and community / recall feeds.
 * Not medical advice.
 */

import { useState } from 'react';
import { ListChecks, Wand2, Users2, CalendarRange, Plus } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { LensFeedButton } from '@/components/lens/LensFeedButton';
import { ParentingSection } from '@/components/parenting/ParentingSection';
import { ChildBriefPanel } from '@/components/parenting/ChildBriefPanel';
import { ParentingFeed } from '@/components/parenting/ParentingFeed';
import { CommunityRedditSlot } from '@/lib/community/CommunityRedditSlot';
import { PgFamilyCalendarPanel } from '@/components/parenting/PgFamilyCalendarPanel';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';

type Destination = 'care' | 'calendar' | 'brief' | 'community';

const DESTINATIONS: { id: Destination; label: string; icon: typeof ListChecks; hotkey: string; description: string }[] = [
  { id: 'care', label: 'Baby Care', icon: ListChecks, hotkey: '1', description: 'Children, one-touch logging, growth, milestones, appointments, caregiver sharing' },
  { id: 'calendar', label: 'Family Calendar', icon: CalendarRange, hotkey: '2', description: 'Shared family events: activities, school, travel, family-wide or tagged to a child' },
  { id: 'brief', label: 'Quick Actions & Brief', icon: Wand2, hotkey: '3', description: 'Milestone/routine calculator, snapshot DTU, caregiver DM, agent developmental brief' },
  { id: 'community', label: 'Community & Safety', icon: Users2, hotkey: '4', description: 'Real-world parenting chatter and child-product safety recalls' },
];

export default function ParentingLensPage() {
  useLensNav('parenting');
  const [destination, setDestination] = useState<Destination>('care');

  useLensCommand(
    [
      ...DESTINATIONS.map((d) => ({
        id: `dest-${d.id}`,
        keys: d.hotkey,
        description: d.label,
        category: 'navigation' as const,
        action: () => setDestination(d.id),
      })),
      { id: 'parenting-log', keys: 'n', description: 'Log care', category: 'actions' as const, action: () => setDestination('care') },
    ],
    { lensId: 'parenting' },
  );


  return (
    <LensShell lensId="parenting" asMain={false}>

      <DepthBadge lensId="parenting" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="parenting"
        crumb="Parenting"
        subtitle="Feeds, sleep, diapers, growth, milestones, immunizations and caregiver coordination. Not medical advice."
        actions={<DTUExportButton domain="parenting" data={{}} compact />}
        tabs={DESTINATIONS.map((d) => ({ id: d.id, label: d.label, keys: d.hotkey, hint: d.description, icon: d.icon }))}
        activeTab={destination}
        onTab={(id) => setDestination(id as Destination)}
        tabsLabel="Parenting destinations"
        cta={{ label: 'Log care', icon: Plus, onClick: () => setDestination('care'), title: 'Log care (N)' }}
      >
        {destination === 'care' && <ParentingSection />}
        {destination === 'calendar' && <PgFamilyCalendarPanel />}
        {destination === 'brief' && <ChildBriefPanel />}
        {destination === 'community' && (
          <div className="space-y-4">
            <LensFeedButton domain="parenting" label="Child-safety product recalls (CPSC)" />
            <CommunityRedditSlot>
              <div className="rounded-2xl border border-white/10 bg-[#111] p-4">
                <ParentingFeed />
              </div>
            </CommunityRedditSlot>
          </div>
        )}
      </NorthStarFrame>
    </LensShell>
  );
}
