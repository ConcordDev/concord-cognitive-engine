'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

const FAMILY = [
  { id: 'studio', label: 'Studio', href: '/lenses/studio' },
  { id: 'music', label: 'Music', href: '/lenses/music' },
  { id: 'art', label: 'Art', href: '/lenses/art' },
  { id: 'fractal', label: 'Visuals', href: '/lenses/fractal' },
  { id: 'game', label: 'Game', href: '/lenses/game' },
  { id: 'sim', label: 'Simulation', href: '/lenses/sim' },
  { id: 'ar', label: 'AR', href: '/lenses/ar' },
  { id: 'podcast', label: 'Podcast', href: '/lenses/podcast' },
] as const;

export type StudioFamilyId = (typeof FAMILY)[number]['id'];

/** Studio through Podcast. Fractal’s live label is Visuals. */
export function StudioFamilyPill({ active }: { active: StudioFamilyId }) {
  return (
    <nav
      aria-label="Studio family"
      className="mt-5 inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1"
    >
      {FAMILY.map((item) => {
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
