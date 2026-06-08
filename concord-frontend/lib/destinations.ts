// concord-frontend/lib/destinations.ts
//
// The "concentrated 25" model: 6 core workspaces (lib/lens-registry CORE_LENSES,
// rendered prominently) + these ~19 promoted DESTINATIONS, grouped, shown in a
// collapsible "Destinations" sidebar section. Together they are the "full version"
// lenses the primary UI reflects.
//
// CRITICAL: every id here is a REAL lens (validated by tests/lib/panel-registry.test.ts
// via getLensById) with a page under app/lenses/<id>. Promotion is presentation only —
// nothing is removed from the lens registry, so ConKay (which operates lenses by
// pathname → getLensById → /api/lens-actions) and the macro system still reach every
// one. The other ~234 lenses remain available via the Hub, sub-lens tree, Extensions,
// and ⌘K. Depth per destination = its own page + cross-mounted panels (lib/panel-affinity).

import {
  Wallet, Calculator, HeartPulse, Scale, FolderKanban, BarChart3, ShoppingBag,
  Hammer, Music, PenSquare, Megaphone, Coins, BookOpen, FlaskConical,
  CalendarDays, Bot, Mail, Users, Landmark, type LucideIcon,
} from 'lucide-react';

export type DestinationGroup = 'work' | 'create' | 'knowledge' | 'comms';

export interface DestinationDef {
  /** Real lens id (app/lenses/<id> + lib/lens-registry entry). */
  id: string;
  name: string;
  icon: LucideIcon;
  group: DestinationGroup;
  /** Lens ids grouped UNDER this destination — surfaced as expandable nav
   *  children in the sidebar so the grouping is actually navigable. Every id is
   *  a real lens; the sidebar skips any that don't resolve / are core-absorbed. */
  absorbs?: string[];
}

export const DESTINATION_GROUPS: { id: DestinationGroup; label: string; color: string }[] = [
  { id: 'work', label: 'Work', color: 'text-neon-blue' },
  { id: 'create', label: 'Create', color: 'text-neon-pink' },
  { id: 'knowledge', label: 'Knowledge', color: 'text-neon-cyan' },
  { id: 'comms', label: 'Comms', color: 'text-neon-purple' },
];

// The 19 promoted destinations (Core 6 live in lens-registry CORE_LENSES).
export const DESTINATIONS: DestinationDef[] = [
  // Work
  { id: 'finance', name: 'Finance', icon: Wallet, group: 'work',
    absorbs: ['markets', 'market', 'wallet', 'staking', 'insurance', 'billing', 'ledger'] },
  { id: 'accounting', name: 'Accounting', icon: Calculator, group: 'work' },
  { id: 'healthcare', name: 'Healthcare', icon: HeartPulse, group: 'work',
    absorbs: ['pharmacy', 'mental-health', 'fitness', 'wellness', 'veterinary', 'organ', 'meditation'] },
  { id: 'legal', name: 'Legal', icon: Scale, group: 'work',
    absorbs: ['law', 'disputes', 'ethics', 'audit', 'privacy'] },
  { id: 'projects', name: 'Projects', icon: FolderKanban, group: 'work',
    absorbs: ['consulting', 'careers', 'hr', 'services', 'supplychain', 'manufacturing', 'ops'] },
  { id: 'analytics', name: 'Analytics', icon: BarChart3, group: 'work',
    absorbs: ['forecast', 'inference', 'ml', 'hypothesis', 'attention'] },
  { id: 'marketplace', name: 'Marketplace', icon: ShoppingBag, group: 'work',
    absorbs: ['auction', 'retail', 'black-market', 'sponsorship', 'marketing', 'realestate', 'housing'] },
  { id: 'trades', name: 'Trades', icon: Hammer, group: 'work',
    absorbs: ['carpentry', 'plumbing', 'electrical', 'hvac', 'welding', 'masonry', 'construction'] },
  // Create
  { id: 'music', name: 'Music', icon: Music, group: 'create' },
  { id: 'whiteboard', name: 'Whiteboard', icon: PenSquare, group: 'create' },
  { id: 'creator', name: 'Creator', icon: Megaphone, group: 'create',
    absorbs: ['fashion', 'photography', 'gallery', 'photos'] },
  { id: 'crypto', name: 'Crypto', icon: Coins, group: 'create' },
  // Knowledge
  { id: 'research', name: 'Research', icon: BookOpen, group: 'knowledge',
    absorbs: ['paper', 'science', 'philosophy', 'linguistics', 'history', 'mentorship', 'debate', 'answers', 'reasoning', 'grounding'] },
  { id: 'lab', name: 'Lab', icon: FlaskConical, group: 'knowledge',
    absorbs: ['physics', 'chem', 'quantum', 'materials', 'math', 'engineering', 'robotics', 'astronomy', 'space', 'geology', 'ocean', 'environment', 'energy', 'aviation', 'mining', 'forestry', 'agriculture', 'landscaping'] },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, group: 'knowledge',
    absorbs: ['events', 'event-timeline', 'sessions'] },
  { id: 'agents', name: 'Agents', icon: Bot, group: 'knowledge',
    absorbs: ['personas'] },
  // Comms
  { id: 'message', name: 'Messages', icon: Mail, group: 'comms',
    absorbs: ['mail'] },
  { id: 'social', name: 'Social', icon: Users, group: 'comms',
    absorbs: ['feed'] },
  { id: 'council', name: 'Council', icon: Landmark, group: 'comms',
    absorbs: ['vote', 'governance', 'government', 'alliance', 'federation', 'civic-bonds'] },
];

export const DESTINATION_ID_SET: ReadonlySet<string> = new Set(DESTINATIONS.map((d) => d.id));

export function isDestination(id: string): boolean {
  return DESTINATION_ID_SET.has(id);
}

export function getDestinationById(id: string): DestinationDef | undefined {
  return DESTINATIONS.find((d) => d.id === id);
}

/** The destination whose workspace the given lens belongs to — either the
 *  destination itself, or a destination that grouped (absorbs) this lens. Used
 *  to render the destination's workspace nav while you're on any of its lenses. */
export function getDestinationForLens(lensId: string): DestinationDef | undefined {
  const direct = getDestinationById(lensId);
  if (direct) return direct;
  return DESTINATIONS.find((d) => d.absorbs?.includes(lensId));
}

export function getDestinationsByGroup(): { group: DestinationGroup; label: string; color: string; items: DestinationDef[] }[] {
  return DESTINATION_GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    color: g.color,
    items: DESTINATIONS.filter((d) => d.group === g.id),
  })).filter((g) => g.items.length > 0);
}
