'use client';

/**
 * UtilityPageShell — shared chrome for cross-app utility pages
 * (settings, save status, world travel, AR preview, mobile companion,
 * accessibility). NOT for lens pages — those have their own visual
 * languages and own chrome (chat lens looks like a chat app, world
 * lens looks like a game, etc.).
 *
 * What this owns:
 *   - Page-level dark gradient surface (lattice-void → lattice-deep)
 *   - Animated header strip with icon tile + title + optional subtitle
 *   - Optional back button
 *   - Optional belowHeader slot for nav/action-bar widgets
 *   - Body section with max-width container
 *
 * Why a shell exists for THESE pages but not for individual lens
 * pages: settings/save/travel/AR/mobile/accessibility are all
 * cross-app utility surfaces — same audience, same task tier (manage
 * the platform, not engage with a specific app's content). They
 * benefit from looking like one cohesive set. Lens pages benefit
 * from looking like real apps in their genre.
 */

import { motion } from 'framer-motion';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ds } from '@/lib/design-system';

interface UtilityPageShellProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Render an explicit back button on the left; uses router.back() */
  showBackButton?: boolean;
  /** Optional content rendered below the icon/title row (nav, action bar, etc.) */
  belowHeader?: React.ReactNode;
  /** Tailwind max-width class for the body container; defaults to max-w-screen-md */
  maxWidth?: string;
}

export function UtilityPageShell({
  icon: Icon,
  title,
  subtitle,
  children,
  showBackButton = false,
  belowHeader,
  maxWidth = 'max-w-screen-md',
}: UtilityPageShellProps) {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-gradient-to-br from-lattice-void via-lattice-deep to-cyan-950/10 text-slate-100">
      <motion.header
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="border-b border-lattice-border bg-lattice-deep/60 px-4 py-3 backdrop-blur sm:px-6"
      >
        <div className={`mx-auto flex ${maxWidth} items-center gap-3`}>
          {showBackButton ? (
            <button
              type="button"
              onClick={() => router.back()}
              className={`${ds.focusRing} rounded-lg border border-lattice-border bg-lattice-elevated p-2 transition hover:border-white/20 hover:bg-white/[0.08]`}
              aria-label="Go back"
            >
              <ArrowLeft className="h-5 w-5 text-neon-cyan" aria-hidden="true" />
            </button>
          ) : (
            <div className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 p-2">
              <Icon className="h-5 w-5 text-neon-cyan" aria-hidden="true" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight sm:text-lg">
              {showBackButton && <Icon className="h-4 w-4 text-neon-cyan" aria-hidden="true" />}
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-0.5 hidden truncate text-xs text-slate-400 sm:block">{subtitle}</p>
            ) : null}
          </div>
        </div>
        {belowHeader ? (
          <div className={`mx-auto mt-3 ${maxWidth}`}>{belowHeader}</div>
        ) : null}
      </motion.header>

      <section className={`mx-auto ${maxWidth} px-3 py-4 sm:px-6 sm:py-5`}>{children}</section>
    </main>
  );
}
