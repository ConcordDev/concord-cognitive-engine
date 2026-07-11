'use client';

/**
 * DomainProbeCard — surfaces a previously-headless backend domain.
 *
 * Calls runDomain(domain, macro, input) on mount via TanStack Query
 * and renders a compact diagnostic card with the probe's accent
 * colour, icon, and a one-line summary derived from the response.
 *
 * Used by the system / dtus / settings lenses to give each headless
 * domain at least one UI consumer. Cards are visually distinct by
 * accent + icon so a grid of them never feels uniform.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import * as LucideIcons from 'lucide-react';

import { apiHelpers } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { probeAccentClasses, type HeadlessProbe } from '@/lib/headless-probes';

interface DomainProbeCardProps {
  probe: HeadlessProbe;
  className?: string;
}

type LucideIconComponent = React.ComponentType<{ className?: string }>;

function resolveIcon(name: string): LucideIconComponent {
  const lib = LucideIcons as unknown as Record<string, LucideIconComponent>;
  return lib[name] ?? lib.Box ?? (() => null);
}

export function DomainProbeCard({ probe, className }: DomainProbeCardProps) {
  const accent = probeAccentClasses(probe.accent);
  const Icon = resolveIcon(probe.icon);

  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['domain-probe', probe.domain, probe.macro, JSON.stringify(probe.input ?? {})],
    queryFn: async () => {
      // `runDomain` resolves to the raw axios response — the envelope
      // `/api/lens/run` always sends is `{ ok, result }` (or `{ ok:false,
      // error:'unknown_macro' }` for an unregistered domain/macro pair).
      // Unwrap to `.data` here so `probe.summarise` receives the macro's
      // OWN return value, not the axios Response wrapper (which was the
      // bug: every card fell through to the `Object.keys(o).length`
      // branch and showed a fixed "N fields" for every probe regardless
      // of what the backend actually returned).
      const r = await apiHelpers.lens.runDomain(probe.domain, probe.macro, probe.input ?? {});
      return r.data as { ok?: boolean; result?: unknown; error?: string; reason?: string } | undefined;
    },
    staleTime: 30_000,
    gcTime: 60_000,
    retry: 1,
  });

  const envelopeFailed = !!data && data.ok === false;
  let summary: string;
  if (isFetching && !data) summary = 'probing…';
  else if (error) summary = error instanceof Error ? error.message : 'unreachable';
  else if (envelopeFailed) summary = data?.error || data?.reason || 'unreachable';
  else if (probe.summarise) summary = probe.summarise(data?.result);
  else summary = 'ok';

  const status: 'pending' | 'ok' | 'error' = (error || envelopeFailed) ? 'error' : isFetching && !data ? 'pending' : 'ok';
  const statusDot = status === 'error'
    ? 'bg-red-400'
    : status === 'pending'
      ? 'bg-gray-500 animate-pulse'
      : accent.dot;

  return (
    <article
      className={cn(
        'group relative rounded-lg border bg-lattice-surface/40 p-3 transition',
        accent.border,
        accent.glow,
        className
      )}
      aria-labelledby={`probe-${probe.domain}-title`}
    >
      <header className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 h-4 w-4 flex-shrink-0', accent.text)} aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <h4
            id={`probe-${probe.domain}-title`}
            className="text-sm font-semibold text-white truncate"
          >
            {probe.title}
          </h4>
          <p className="text-[11px] text-gray-400 leading-snug">{probe.description}</p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label={`Re-probe ${probe.title}`}
          className="text-gray-400 hover:text-white transition disabled:opacity-50"
        >
          <LucideIcons.RotateCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
        </button>
      </header>
      <footer className="mt-2 flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-gray-300">
          <span className={cn('h-1.5 w-1.5 rounded-full', statusDot)} aria-hidden="true" />
          <span className="font-mono">{probe.domain}.{probe.macro}</span>
        </span>
        <span className={cn('truncate max-w-[140px]', status === 'error' ? 'text-red-300' : accent.text)}>
          {summary}
        </span>
      </footer>
    </article>
  );
}

export default DomainProbeCard;
