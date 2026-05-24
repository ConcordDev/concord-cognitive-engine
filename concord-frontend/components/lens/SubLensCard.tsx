'use client';

/**
 * SubLensCard — Reusable card for displaying a sub-lens in lists.
 *
 * Used in sub-lens indexes, parent lens "Sub-Lenses" tabs, hub browsers,
 * and search results. Renders the parent name, the sub-lens leaf name,
 * an optional DTU count, and an "Open" action. Clicking the card navigates
 * to the dynamic /lenses/[parent]/[sub] route.
 */

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Layers, ArrowRight, BookOpen } from 'lucide-react';
import type { MouseEvent } from 'react';

export interface SubLensCardProps {
  /** Full sub-lens id (e.g. 'math.topology'). */
  id: string;
  /** Optional short description rendered below the name. */
  description?: string;
  /** Optional DTU count shown as a badge. */
  dtuCount?: number;
  /** Optional click override (e.g., for modal previews). If omitted the card
   *  navigates to the dynamic sub-lens page via <Link>. */
  onClick?: () => void;
  /** Optional extra className merged onto the root element. */
  className?: string;
}

function splitLensId(id: string): { parent: string; sub: string } {
  const [parent, ...rest] = id.split('.');
  return { parent: parent || id, sub: rest.join('.') };
}

function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function SubLensCard({
  id,
  description,
  dtuCount,
  onClick,
  className = '',
}: SubLensCardProps) {
  const { parent, sub } = splitLensId(id);
  const parentLabel = titleCase(parent);
  const subLabel = sub ? titleCase(sub) : titleCase(parent);
  const href = sub ? `/lenses/${parent}/${sub}` : `/lenses/${parent}`;

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18 }}
      className={className}
    >
      <Link
        href={href}
        onClick={handleClick}
        className="group block rounded-lg border border-lattice-border bg-lattice-surface p-4 hover:border-neon-purple/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-neon-cyan/80 mb-1">
              <Layers className="w-3 h-3" />
              <span className="truncate">{parentLabel}</span>
            </div>
            <h3 className="text-sm font-semibold text-white truncate group-hover:text-neon-purple transition-colors">
              {subLabel}
            </h3>
            {description && (
              <p className="mt-1 text-xs text-gray-400 line-clamp-2">{description}</p>
            )}
            <p className="mt-2 font-mono text-[10px] text-gray-400 truncate">{id}</p>
          </div>

          {typeof dtuCount === 'number' && (
            <div
              className="flex items-center gap-1 text-[10px] text-neon-cyan bg-neon-cyan/10 border border-neon-cyan/20 rounded px-1.5 py-0.5 flex-shrink-0"
              title={`${dtuCount} DTU${dtuCount === 1 ? '' : 's'}`}
            >
              <BookOpen className="w-3 h-3" />
              {dtuCount}
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-end text-xs text-gray-400 group-hover:text-neon-purple transition-colors">
          <span>Open</span>
          <ArrowRight className="w-3.5 h-3.5 ml-1 transition-transform group-hover:translate-x-0.5" />
        </div>
      </Link>
    </motion.div>
  );
}

export default SubLensCard;
