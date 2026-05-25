'use client';

/**
 * AtlasShell — Google Maps + Felt-shape sidebar chrome for the
 * geographic atlas lens. Left rail nav, map on the right.
 */

import React from 'react';
import { MapPin, Bookmark, ListChecks, Route, Navigation, History, Sparkles, Compass } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AtlasNav = 'explore' | 'places' | 'lists' | 'trips' | 'directions' | 'planner' | 'recent';

interface NavItem { id: AtlasNav; label: string; icon: typeof MapPin; badge?: number | string }

const NAV: NavItem[] = [
  { id: 'explore',    label: 'Explore',     icon: Compass },
  { id: 'places',     label: 'Saved places', icon: Bookmark },
  { id: 'lists',      label: 'Lists',       icon: ListChecks },
  { id: 'trips',      label: 'Trips',       icon: Route },
  { id: 'directions', label: 'Directions',  icon: Navigation },
  { id: 'planner',    label: 'AI planner',  icon: Sparkles },
  { id: 'recent',     label: 'Recent',      icon: History },
];

export interface AtlasShellProps {
  activeNav: AtlasNav;
  onNavChange: (n: AtlasNav) => void;
  badges?: Partial<Record<AtlasNav, number | string>>;
  panel: React.ReactNode;
  map: React.ReactNode;
}

export function AtlasShell({ activeNav, onNavChange, badges = {}, panel, map }: AtlasShellProps) {
  return (
    <div className="flex h-[calc(100vh-180px)] min-h-[640px] bg-[#0d1117] border border-teal-500/15 rounded-lg overflow-hidden">
      {/* Activity bar */}
      <nav className="w-14 bg-[#0a0c10] border-r border-white/5 flex flex-col items-center py-2 flex-shrink-0">
        {NAV.map(n => {
          const Icon = n.icon;
          const active = activeNav === n.id;
          const badge = badges[n.id];
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onNavChange(n.id)}
              title={n.label}
              className={cn(
                'relative w-12 h-12 m-0.5 rounded flex items-center justify-center transition-colors',
                active ? 'bg-teal-500/15 text-teal-200' : 'text-gray-400 hover:text-white hover:bg-white/[0.04]',
              )}
            >
              <Icon className="w-5 h-5" />
              {badge !== undefined && badge !== 0 && (
                <span className="absolute top-1 right-1 px-1 py-0.5 rounded-full bg-teal-500 text-white text-[8px] font-mono">{badge}</span>
              )}
            </button>
          );
        })}
      </nav>
      {/* Panel */}
      <aside className="w-80 bg-[#0a0c10] border-r border-white/5 overflow-hidden flex flex-col flex-shrink-0">
        {panel}
      </aside>
      {/* Map */}
      <main className="flex-1 overflow-hidden">{map}</main>
    </div>
  );
}

export default AtlasShell;
