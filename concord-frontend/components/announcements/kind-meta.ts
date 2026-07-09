import { Sparkles, Bell, Wrench, CalendarDays, Map } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { AnnouncementKind } from './types';

export const KIND_META: Record<AnnouncementKind, { label: string; icon: LucideIcon; color: string; ring: string }> = {
  feature_drop:   { label: 'Feature drop',   icon: Sparkles,     color: 'text-emerald-300', ring: 'border-emerald-500/30 bg-emerald-500/10' },
  balance_change: { label: 'Balance change', icon: Wrench,       color: 'text-amber-300',   ring: 'border-amber-500/30 bg-amber-500/10' },
  event:          { label: 'Event',          icon: CalendarDays, color: 'text-sky-300',     ring: 'border-sky-500/30 bg-sky-500/10' },
  news:           { label: 'News',           icon: Bell,         color: 'text-slate-300',   ring: 'border-slate-500/30 bg-slate-500/10' },
  roadmap:        { label: 'Roadmap',        icon: Map,          color: 'text-violet-300',  ring: 'border-violet-500/30 bg-violet-500/10' },
};
