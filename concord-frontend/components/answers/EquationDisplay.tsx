'use client';

/**
 * EquationDisplay
 *
 * Renders a single STSVK equation in a compact, "code plaque" style with
 * neon-cyan monospace text, a subtle gradient background, and an optional
 * solution set readout ("x∈{0,1}"). Used by the Answers lens to surface the
 * root equation x² - x = 0 and related forms (y³ = x² + x, y³ = x² + x - φ).
 *
 * Props:
 *   - equation:    the raw equation string (e.g. "x² - x = 0")
 *   - solution:    optional solution-set hint (e.g. "x ∈ {0, 1}")
 *   - label:       optional caption above the equation (e.g. "Root Equation")
 *   - size:        'sm' | 'md' | 'lg' — controls font scale
 *   - className:   optional extra Tailwind classes
 */

import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface EquationDisplayProps {
  equation: string;
  solution?: string;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<EquationDisplayProps['size']>, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-lg px-4 py-2.5',
  lg: 'text-3xl px-6 py-4',
};

export function EquationDisplay({
  equation,
  solution,
  label,
  size = 'md',
  className,
}: EquationDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn('inline-flex flex-col gap-1', className)}
    >
      {label && (
        <span className="text-[10px] uppercase tracking-[0.2em] text-neon-purple/80">
          {label}
        </span>
      )}
      <div
        className={cn(
          'relative inline-flex items-center gap-3 rounded-lg',
          'border border-neon-cyan/30',
          'bg-gradient-to-br from-neon-cyan/10 via-lattice-surface/80 to-neon-purple/10',
          'shadow-[0_0_24px_-8px_rgba(34,211,238,0.45)]',
          SIZE_CLASSES[size],
        )}
      >
        <code className="font-mono text-neon-cyan font-semibold tracking-wide drop-shadow-[0_0_6px_rgba(34,211,238,0.4)]">
          {equation}
        </code>
        {solution && (
          <>
            <span className="text-gray-400 font-mono select-none">⇔</span>
            <code className="font-mono text-neon-pink/90">{solution}</code>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default EquationDisplay;
