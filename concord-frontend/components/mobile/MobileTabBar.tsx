'use client';

/**
 * MobileTabBar — fixed-bottom tab bar for touch viewports. Hides itself
 * on desktop so it never crowds a mouse layout.
 *
 * Phase 5 mobile track (UX completeness sprint).
 *
 * Usage:
 *   <MobileTabBar
 *     tabs={[
 *       { id: 'list', label: 'List', icon: List },
 *       { id: 'create', label: 'Create', icon: Plus },
 *       { id: 'detail', label: 'Detail', icon: Eye },
 *     ]}
 *     active={view}
 *     onSelect={setView}
 *   />
 */

import { useViewport } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

export interface MobileTab {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeCount?: number;
}

export interface MobileTabBarProps {
  tabs: MobileTab[];
  active: string;
  onSelect: (id: string) => void;
  className?: string;
}

export function MobileTabBar({ tabs, active, onSelect, className }: MobileTabBarProps) {
  const { isMobile, isTouch } = useViewport();
  if (!isMobile && !isTouch) return null;
  if (tabs.length === 0) return null;

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 border-t border-zinc-800 backdrop-blur',
        'flex items-stretch justify-around safe-area-bottom',
        className,
      )}
      role="navigation"
      aria-label="Lens tabs"
    >
      {tabs.map(t => {
        const Icon = t.icon;
        const isActive = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative transition-colors',
              isActive ? 'text-indigo-300' : 'text-zinc-400 hover:text-zinc-300',
            )}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
            <span className="text-[10px]">{t.label}</span>
            {typeof t.badgeCount === 'number' && t.badgeCount > 0 && (
              <span className="absolute top-1 right-[calc(50%-1rem)] min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-mono flex items-center justify-center">
                {t.badgeCount > 99 ? '99+' : t.badgeCount}
              </span>
            )}
            {isActive && (
              <span className="absolute top-0 left-1/3 right-1/3 h-0.5 bg-indigo-400 rounded-full" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export default MobileTabBar;
