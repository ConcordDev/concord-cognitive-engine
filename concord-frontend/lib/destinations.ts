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
  { id: 'finance', name: 'Finance', icon: Wallet, group: 'work' },
  { id: 'accounting', name: 'Accounting', icon: Calculator, group: 'work' },
  { id: 'healthcare', name: 'Healthcare', icon: HeartPulse, group: 'work' },
  { id: 'legal', name: 'Legal', icon: Scale, group: 'work' },
  { id: 'projects', name: 'Projects', icon: FolderKanban, group: 'work' },
  { id: 'analytics', name: 'Analytics', icon: BarChart3, group: 'work' },
  { id: 'marketplace', name: 'Marketplace', icon: ShoppingBag, group: 'work' },
  { id: 'trades', name: 'Trades', icon: Hammer, group: 'work' },
  // Create
  { id: 'music', name: 'Music', icon: Music, group: 'create' },
  { id: 'whiteboard', name: 'Whiteboard', icon: PenSquare, group: 'create' },
  { id: 'creator', name: 'Creator', icon: Megaphone, group: 'create' },
  { id: 'crypto', name: 'Crypto', icon: Coins, group: 'create' },
  // Knowledge
  { id: 'research', name: 'Research', icon: BookOpen, group: 'knowledge' },
  { id: 'lab', name: 'Lab', icon: FlaskConical, group: 'knowledge' },
  { id: 'calendar', name: 'Calendar', icon: CalendarDays, group: 'knowledge' },
  { id: 'agents', name: 'Agents', icon: Bot, group: 'knowledge' },
  // Comms
  { id: 'message', name: 'Messages', icon: Mail, group: 'comms' },
  { id: 'social', name: 'Social', icon: Users, group: 'comms' },
  { id: 'council', name: 'Council', icon: Landmark, group: 'comms' },
];

export const DESTINATION_ID_SET: ReadonlySet<string> = new Set(DESTINATIONS.map((d) => d.id));

export function isDestination(id: string): boolean {
  return DESTINATION_ID_SET.has(id);
}

export function getDestinationsByGroup(): { group: DestinationGroup; label: string; color: string; items: DestinationDef[] }[] {
  return DESTINATION_GROUPS.map((g) => ({
    group: g.id,
    label: g.label,
    color: g.color,
    items: DESTINATIONS.filter((d) => d.group === g.id),
  })).filter((g) => g.items.length > 0);
}
