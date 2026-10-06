'use client';

/**
 * Kingdoms — one realm-ops app (browse / found / decree / CK3 layers).
 *
 * Single active union. REST kingdom routes + realm/dynasty macros preserved
 * via HistoryExplorer / RealmActionPanel / DynastyRealmManager.
 */

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useLensCommand } from '@/hooks/useLensCommand';
import { LensShell } from '@/components/lens/LensShell';
import { NorthStarFrame } from '@/components/lens/NorthStarFrame';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { SessionRail } from '@/components/lens/SessionRail';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { HistoryExplorer } from '@/components/kingdoms/HistoryExplorer';
import { RealmActionPanel } from '@/components/kingdoms/RealmActionPanel';
import { DynastyRealmManager } from '@/components/kingdoms/DynastyRealmManager';
import { KingdomListPanel } from '@/components/kingdoms/KingdomListPanel';
import { KingdomDetailPanel } from '@/components/kingdoms/KingdomDetailPanel';
import { KingdomCreatePanel } from '@/components/kingdoms/KingdomCreatePanel';
import { MobileTabBar } from '@/components/mobile/MobileTabBar';
import { Crown, List, Plus, Eye } from 'lucide-react';
import type { KingdomView } from '@/components/kingdoms/types';

const VIEWS: { id: KingdomView; label: string; keys: string }[] = [
  { id: 'list', label: 'Browse', keys: 'l' },
  { id: 'create', label: 'Found', keys: 'c' },
  { id: 'detail', label: 'Detail', keys: 'd' },
  { id: 'history', label: 'History', keys: 'h' },
  { id: 'realm', label: 'Realm', keys: 'r' },
  { id: 'dynasty', label: 'Dynasty', keys: 'y' },
];

export default function KingdomsPage() {
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [active, setActive] = useState<KingdomView>('list');
  const [activeId, setActiveId] = useState<string | null>(null);

  useLensCommand(
    VIEWS.map((v) => ({
      id: `tab-${v.id}`,
      keys: v.keys,
      description: v.label,
      category: 'navigation' as const,
      action: () => setActive(v.id),
    })),
    { lensId: 'kingdoms' },
  );

  return (
    <LensShell lensId="kingdoms" asMain={false}>
      <FirstRunTour lensId="kingdoms" />
      <DepthBadge lensId="kingdoms" size="sm" className="ml-2" />
      <NorthStarFrame
        lensId="kingdoms"
        crumb="Kingdoms"
        title={`Realms${who ? `, ${who}` : ''}`}
        subtitle="Browse realms, found a kingdom, issue decrees, and trace dynasties"
        tabs={VIEWS}
        activeTab={active}
        onTab={(id) => {
          if (id === 'list') setActiveId(null);
          setActive(id as KingdomView);
        }}
        tabsLabel="Kingdoms views"
        cta={{ icon: Plus, label: 'Claim a realm', onClick: () => setActive('create'), title: 'Found a new kingdom' }}
      >
      <AnimatePresence mode="wait">
        <motion.div
          key={active + (activeId || '')}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
        >
          {active === 'list' && (
            <KingdomListPanel onPick={(id) => { setActiveId(id); setActive('detail'); }} />
          )}
          {active === 'detail' && (
            activeId
              ? <KingdomDetailPanel kingdomId={activeId} />
              : <div className="rounded-lg border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">Pick a kingdom from Browse.</div>
          )}
          {active === 'create' && (
            <KingdomCreatePanel onCreated={(id) => { setActiveId(id); setActive('detail'); }} />
          )}
          {active === 'history' && <HistoryExplorer />}
          {active === 'realm' && <RealmActionPanel />}
          {active === 'dynasty' && <DynastyRealmManager />}
        </motion.div>
      </AnimatePresence>

        <SessionRail lensId="kingdoms" className="mt-6" hideWhenEmpty />
      </NorthStarFrame>
      <MobileTabBar
        tabs={[
          { id: 'list', label: 'Browse', icon: List },
          { id: 'create', label: 'Found', icon: Plus },
          { id: 'detail', label: 'Detail', icon: Eye },
          { id: 'dynasty', label: 'Dynasty', icon: Crown },
        ]}
        active={active}
        onSelect={(id) => setActive(id as KingdomView)}
      />
    </LensShell>
  );
}
