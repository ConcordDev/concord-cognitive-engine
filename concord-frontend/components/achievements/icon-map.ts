/**
 * Resolves an achievement catalog `icon` field — a lucide-react export
 * name authored in content/achievements/*.json (e.g. "Swords",
 * "Snowflake", "Beer") — to its actual icon component.
 *
 * Same idiom as components/system/DomainProbeCard.tsx#resolveIcon:
 * a bulk `import *` namespace indexed by string, falling back safely
 * when the authored name doesn't match an installed icon (content is
 * hand-authored JSON, not statically checked against the icon library).
 */

import * as LucideIcons from 'lucide-react';
import type { ComponentType } from 'react';

type LucideIconComponent = ComponentType<{ className?: string }>;

const LIB = LucideIcons as unknown as Record<string, LucideIconComponent>;

export function resolveAchievementIcon(name?: string | null): LucideIconComponent {
  return (name && LIB[name]) || LIB.Trophy;
}
