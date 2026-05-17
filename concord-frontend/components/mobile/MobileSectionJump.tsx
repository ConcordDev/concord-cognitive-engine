'use client';

/**
 * MobileSectionJump — fixed-bottom mini-nav that scrolls a long
 * dashboard to anchored sections. Sibling of MobileTabBar for surfaces
 * that don't have an active-tab enum but DO have several distant
 * sections a thumb needs to reach quickly (admin, settings dashboards).
 *
 * Phase 12. Hides itself on desktop. Uses scrollIntoView with
 * 'smooth' + 'start' so the section header lands near the top of the
 * viewport; pair the target with `scroll-mt-20` so the sticky topbar
 * doesn't cover it.
 */

import { useViewport } from '@/hooks/useViewport';
import { cn } from '@/lib/utils';

export interface SectionJumpItem {
  /** DOM id of the target element. */
  id: string;
  /** Short label (≤7 chars). */
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export interface MobileSectionJumpProps {
  sections: SectionJumpItem[];
  className?: string;
}

export function MobileSectionJump({ sections, className }: MobileSectionJumpProps) {
  const { isMobile, isTouch } = useViewport();
  if (!isMobile && !isTouch) return null;
  if (sections.length === 0) return null;

  return (
    <nav
      className={cn(
        'fixed bottom-0 left-0 right-0 z-40 bg-zinc-950/95 border-t border-zinc-800 backdrop-blur',
        'flex items-stretch overflow-x-auto safe-area-bottom',
        className,
      )}
      role="navigation"
      aria-label="Jump to section"
    >
      {sections.map((s) => {
        const Icon = s.icon;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              const el = typeof document !== 'undefined' ? document.getElementById(s.id) : null;
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="flex-1 min-w-[64px] flex flex-col items-center justify-center py-2 gap-0.5 text-zinc-400 hover:text-zinc-100"
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
            <span className="text-[10px]">{s.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default MobileSectionJump;
