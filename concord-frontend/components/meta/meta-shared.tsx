'use client';

import type { ComponentType } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { Search, CheckCircle, XCircle, Loader2 } from 'lucide-react';

export interface InventoryOverview {
  totalComponents: number;
  totalLenses: number;
  totalServerLibs: number;
  totalRoutes: number;
  orphanedCount: number;
  largestFiles: { path: string; lineCount: number }[];
  mostImportedComponents: { path: string; usedByCount: number }[];
}

export interface ComponentEntry {
  path: string;
  directory: string;
  lineCount: number;
  isOrphaned: boolean;
  exports: string[];
  usedByLenses: string[];
}

export interface LensEntry {
  name: string;
  lineCount: number;
  imports: string[];
  serverRoutes: string[];
}

export interface OrphanEntry {
  path: string;
  directory: string;
  exports: string[];
  lineCount: number;
}

export interface LensWiringInfo {
  components: string[];
  serverRoutes: string[];
  lineCount: number;
  lastModified: string | null;
}

export interface WiringMapResult {
  lenses: Record<string, LensWiringInfo>;
  components: Record<string, { exports: string[]; usedByLenses: string[]; lineCount: number; lastModified: string | null }>;
  serverLibs: Record<string, { type: string; exports: string[]; lineCount: number; lastModified: string | null }>;
}

export interface SearchResult {
  type: 'component' | 'lens' | 'serverLib' | 'route';
  name: string;
  path: string;
  matchContext?: string;
}

export function baseName(p: string): string {
  const last = p.split('/').pop() || p;
  return last.replace(/\.(tsx?|jsx?)$/, '');
}

export const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.04, duration: 0.3, ease: 'easeOut' as const },
  }),
};

export const tabContentVariants = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
};

export function StatCard({
  icon: Icon,
  label,
  value,
  color,
  warning,
  index,
}: {
  icon: ComponentType<{ className?: string; size?: number | string }>;
  label: string;
  value: number | string;
  color: string;
  warning?: boolean;
  index: number;
}) {
  return (
    <motion.div
      custom={index}
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      className={cn('lens-card', warning && 'border-yellow-500/40')}
    >
      <Icon className={cn('w-5 h-5 mb-2', color)} />
      <p className={cn('text-2xl font-bold', warning && 'text-yellow-400')}>{value}</p>
      <p className="text-sm text-gray-400">{label}</p>
    </motion.div>
  );
}

export function WiredBadge({ wired }: { wired: boolean }) {
  return wired ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/20 text-green-400 border border-green-500/30">
      <CheckCircle className="w-3 h-3" /> Wired
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/20 text-red-400 border border-red-500/30">
      <XCircle className="w-3 h-3" /> Orphan
    </span>
  );
}

export function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input-lattice w-full pl-10"
      />
    </div>
  );
}

export function LoadingSpinner({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center p-12 text-gray-400">
      <Loader2 className="w-6 h-6 animate-spin mr-2" />
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-10 text-gray-400 text-sm border border-dashed border-white/10 rounded-lg">
      {message}
    </div>
  );
}

export function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {
    /* fallback: noop */
  });
}
