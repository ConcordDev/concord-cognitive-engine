'use client';

import Link from 'next/link';

/**
 * Reusable legal footer with links to Terms, Privacy, and DMCA pages.
 * Drop this into any page layout to provide standard legal navigation.
 *
 * @example
 *   import { LegalFooter } from '@/components/legal/LegalFooter';
 *   <LegalFooter />
 */
export function LegalFooter() {
  return (
    <footer className="border-t border-lattice-border bg-lattice-void px-6 py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-xs text-gray-400">
          &copy; {new Date().getFullYear()} Concord OS. All rights reserved.
        </p>

        {/* flex-wrap: at 375-414 px the three links + separators do not fit
            one row next to nothing — they wrap instead of clipping. */}
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <Link
            href="/legal/terms"
            className="text-xs text-gray-400 transition-colors hover:text-neon-cyan"
          >
            Terms of Service
          </Link>
          <span className="text-gray-600">|</span>
          <Link
            href="/legal/privacy"
            className="text-xs text-gray-400 transition-colors hover:text-neon-cyan"
          >
            Privacy Policy
          </Link>
          <span className="text-gray-600">|</span>
          <Link
            href="/legal/dmca"
            className="text-xs text-gray-400 transition-colors hover:text-neon-cyan"
          >
            DMCA
          </Link>
        </nav>
      </div>
    </footer>
  );
}

export default LegalFooter;
