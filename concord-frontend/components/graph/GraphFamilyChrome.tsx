'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export const SHAPE_LINKS = [
  { id: 'graph', label: 'Graph', href: '/lenses/graph' },
  { id: 'schema', label: 'Schema', href: '/lenses/schema' },
  { id: 'entity', label: 'Entities', href: '/lenses/entity' },
] as const;

export const SERIES_LINKS = [
  { id: 'graph', label: 'Graph', href: '/lenses/graph' },
  { id: 'temporal', label: 'Temporal', href: '/lenses/temporal' },
  { id: 'eco', label: 'Ecosystem', href: '/lenses/eco' },
] as const;

export const META_LINKS = [
  { id: 'graph', label: 'Graph', href: '/lenses/graph' },
  { id: 'eco', label: 'Ecosystem', href: '/lenses/eco' },
  { id: 'meta', label: 'Meta', href: '/lenses/meta' },
] as const;

/** Quiet sibling pill from the graph-family north stars. */
export function GraphFamilyPill({
  active,
  links,
  label = 'Graph family',
}: {
  active: string;
  links: readonly { id: string; label: string; href: string }[];
  label?: string;
}) {
  return (
    <nav
      aria-label={label}
      className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1"
    >
      {links.map((item) => {
        const on = item.id === active;
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'rounded-full px-3.5 py-1 text-[13px] transition-colors',
              on ? 'bg-white/10 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
