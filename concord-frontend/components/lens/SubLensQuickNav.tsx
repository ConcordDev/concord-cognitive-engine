'use client';

/**
 * SubLensQuickNav — Inline "Sub-Lenses" section for parent lens pages.
 *
 * Drop into any parent lens page (math, physics, chem, code, healthcare,
 * etc.) to render a collapsible grid of SubLensCard entries for each child
 * sub-lens. Fetches children lazily from /api/sub-lens/:lensId/children and
 * gracefully renders nothing when the lens has no sub-lenses.
 *
 * Usage:
 *   <SubLensQuickNav lensId="math" />
 */

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Layers } from 'lucide-react';
import { SubLensCard } from '@/components/lens/SubLensCard';
import { getSubLensChildren } from '@/lib/lens-registry';

export interface SubLensQuickNavProps {
  /** Root lens id — e.g., 'math', 'physics', 'chem'. */
  lensId: string;
  /** Start expanded by default. */
  defaultOpen?: boolean;
  /** Optional extra class names on the outer container. */
  className?: string;
}

export function SubLensQuickNav({
  lensId,
  defaultOpen = false,
  className = '',
}: SubLensQuickNavProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [children, setChildren] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Lazy fetch — only when the section is first opened.
  useEffect(() => {
    if (!open || loaded || !lensId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const c = await getSubLensChildren(lensId);
        if (!cancelled) {
          setChildren(c);
          setLoaded(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loaded, lensId]);

  return (
    <section className={`border border-lattice-border rounded-lg bg-lattice-surface ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-neon-purple" />
          <span className="font-semibold">Sub-Lenses</span>
          {loaded && children && (
            <span className="text-xs text-gray-400 font-mono">({children.length})</span>
          )}
        </span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4">
              {loading && !loaded && (
                <p className="text-xs text-gray-400 italic">Loading sub-lenses&hellip;</p>
              )}
              {loaded && children && children.length === 0 && (
                <p className="text-xs text-gray-400 italic">
                  No sub-lenses registered for this lens.
                </p>
              )}
              {loaded && children && children.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {children.map((id) => (
                    <SubLensCard key={id} id={id} />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default SubLensQuickNav;
