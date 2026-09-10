'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';

/** Honest cross-lens CTA — no backend call; Link or in-page tab switch. */
export function CrossLensCTA({
  icon: Icon, body, href, cta, onClick, secondaryHref, secondaryCta,
}: {
  icon: LucideIcon;
  body: string;
  href?: string;
  cta: string;
  onClick?: () => void;
  secondaryHref?: string;
  secondaryCta?: string;
}) {
  const primaryClass =
    'inline-flex items-center gap-1.5 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500';
  return (
    <div className="rounded-lg border border-rose-900/30 bg-rose-950/10 p-5 text-center">
      <Icon className="mx-auto mb-2 h-6 w-6 text-rose-500" aria-hidden />
      <p className="mx-auto mb-4 max-w-md text-xs leading-relaxed text-rose-400">{body}</p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onClick ? (
          <button type="button" onClick={onClick} className={primaryClass}>{cta}</button>
        ) : href ? (
          <Link href={href} className={primaryClass}>{cta}</Link>
        ) : null}
        {secondaryHref && secondaryCta && (
          <Link
            href={secondaryHref}
            className="inline-flex items-center gap-1.5 rounded border border-rose-900/40 px-3 py-1.5 text-xs text-rose-300 hover:text-rose-100"
          >
            {secondaryCta}
          </Link>
        )}
      </div>
    </div>
  );
}
