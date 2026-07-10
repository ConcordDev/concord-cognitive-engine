'use client';

/**
 * RoadmapRail — "What's coming" side panel.
 *
 * Not a separate feature: per `server/lib/announcements.js`'s own header
 * comment, "Roadmap is just kind='roadmap' rows — same surface." This rail
 * pulls that slice out of the same fetched list so upcoming-work items stay
 * visible while a user is filtered to a different kind, instead of forcing
 * a tab switch to see them. Real data only — same rows the main feed reads,
 * never a second source.
 */

import { Map } from 'lucide-react';
import { KIND_META } from './kind-meta';
import { timeAgo, type Announcement } from './types';

export interface RoadmapRailProps {
  items: Announcement[];
}

export function RoadmapRail({ items }: RoadmapRailProps) {
  if (items.length === 0) return null;
  const meta = KIND_META.roadmap;

  return (
    <aside aria-label="Roadmap" className="rounded-xl border border-violet-500/20 bg-zinc-950/40 p-3">
      <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-300">
        <Map size={13} aria-hidden="true" />
        What&apos;s coming
      </h2>
      <ol className="space-y-2.5">
        {items.map((a) => (
          <li key={a.id} className="border-l-2 border-violet-500/30 pl-2.5">
            <p className={`text-[12px] font-medium leading-snug ${meta.color}`}>{a.title}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-400">{a.body_md}</p>
            <p className="mt-0.5 text-[10px] text-slate-600">{timeAgo(a.published_at)}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}
