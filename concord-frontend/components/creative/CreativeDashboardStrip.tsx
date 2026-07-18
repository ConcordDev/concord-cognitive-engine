'use client';

/**
 * CreativeDashboardStrip — a real KPI strip for the creative lens home,
 * sourced entirely from the ProductionSuite + Boards macros (creative-
 * dashboard, review-asset-list, callsheet-list, deliverable-list,
 * calendar-list, prooflink-list). Replaces the prior fabricated
 * "Project/Asset/Revision/..." dashboard, which computed its numbers off
 * a client-invented generic artifact store that matched none of the 62
 * real `creative` macros.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, ListChecks, Film, ClipboardList, Layers, CalendarClock, Link2, Loader2,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui';

interface Stats {
  boards: number; cards: number; openTasks: number; doneTasks: number;
  reviewAssets: number; openReviewComments: number;
  callSheets: number;
  deliverablesInReview: number; deliverablesTotal: number;
  eventsUpcoming: number; eventsOverdue: number;
  proofLinksActive: number; externalComments: number;
}

const EMPTY: Stats = {
  boards: 0, cards: 0, openTasks: 0, doneTasks: 0,
  reviewAssets: 0, openReviewComments: 0,
  callSheets: 0,
  deliverablesInReview: 0, deliverablesTotal: 0,
  eventsUpcoming: 0, eventsOverdue: 0,
  proofLinksActive: 0, externalComments: 0,
};

export function CreativeDashboardStrip() {
  const [stats, setStats] = useState<Stats>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [board, assets, sheets, deliverables, cal, links] = await Promise.all([
      lensRun('creative', 'creative-dashboard', {}),
      lensRun('creative', 'review-asset-list', {}),
      lensRun('creative', 'callsheet-list', {}),
      lensRun('creative', 'deliverable-list', {}),
      lensRun('creative', 'calendar-list', {}),
      lensRun('creative', 'prooflink-list', {}),
    ]);
    const failed = [board, assets, sheets, deliverables, cal, links].find((x) => x.data?.ok === false);
    if (failed) {
      setLoadError(failed.data?.error || 'Could not load the creative dashboard.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    const d = board.data?.result || {};
    const assetList = (assets.data?.result?.assets || []) as { openCount?: number }[];
    const deliverableList = (deliverables.data?.result?.deliverables || []) as { status?: string }[];
    const linkList = (links.data?.result?.links || []) as { active?: boolean; externalCommentCount?: number }[];
    setStats({
      boards: Number(d.boards || 0),
      cards: Number(d.cards || 0),
      openTasks: Number(d.openTasks || 0),
      doneTasks: Number(d.doneTasks || 0),
      reviewAssets: Number(assets.data?.result?.count || 0),
      openReviewComments: assetList.reduce((s, a) => s + (a.openCount || 0), 0),
      callSheets: Number(sheets.data?.result?.count || 0),
      deliverablesInReview: deliverableList.filter((x) => x.status === 'in_review').length,
      deliverablesTotal: Number(deliverables.data?.result?.count || 0),
      eventsUpcoming: Number(cal.data?.result?.upcoming || 0),
      eventsOverdue: Number(cal.data?.result?.overdue || 0),
      proofLinksActive: linkList.filter((l) => l.active).length,
      externalComments: linkList.reduce((s, l) => s + (l.externalCommentCount || 0), 0),
    });
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-zinc-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return <ErrorState message={loadError} onRetry={refresh} variant="inline" />;
  }

  const tiles = [
    { label: 'Boards', value: stats.boards, sub: `${stats.cards} cards`, icon: LayoutDashboard, accent: 'text-amber-400' },
    { label: 'Open tasks', value: stats.openTasks, sub: `${stats.doneTasks} done`, icon: ListChecks, accent: 'text-emerald-400' },
    { label: 'Review assets', value: stats.reviewAssets, sub: `${stats.openReviewComments} open notes`, icon: Film, accent: 'text-violet-400' },
    { label: 'Call sheets', value: stats.callSheets, sub: 'shoot days scheduled', icon: ClipboardList, accent: 'text-sky-400' },
    { label: 'Deliverables in review', value: stats.deliverablesInReview, sub: `${stats.deliverablesTotal} total`, icon: Layers, accent: 'text-blue-400' },
    { label: 'Calendar', value: stats.eventsUpcoming, sub: stats.eventsOverdue > 0 ? `${stats.eventsOverdue} overdue` : 'upcoming', icon: CalendarClock, accent: stats.eventsOverdue > 0 ? 'text-red-400' : 'text-zinc-400' },
    { label: 'Proof links', value: stats.proofLinksActive, sub: `${stats.externalComments} client notes`, icon: Link2, accent: 'text-pink-400' },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
          <t.icon className={`w-4 h-4 mb-1.5 ${t.accent}`} />
          <p className="text-xl font-bold text-zinc-100 leading-none">{t.value}</p>
          <p className="text-[10px] text-zinc-500 mt-1 leading-tight">{t.label}</p>
          <p className="text-[10px] text-zinc-600 leading-tight">{t.sub}</p>
        </div>
      ))}
    </div>
  );
}
