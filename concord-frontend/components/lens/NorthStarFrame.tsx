'use client';

/**
 * Shared north-star lens chrome: breadcrumb, serif title, optional pill views,
 * right-hand actions slot, cross-lens recents and the teal floating CTA.
 * Pages own their state, data and commands; this only lays out the chrome.
 */

import type { ComponentType, ReactNode } from 'react';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { cn } from '@/lib/utils';

export interface NorthStarTab {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
  keys?: string;
  hint?: string;
}

export interface NorthStarCta {
  label: string;
  icon?: ComponentType<{ className?: string }>;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}

interface NorthStarFrameProps {
  lensId: string;
  theme?: string;
  crumb: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  tabs?: NorthStarTab[];
  activeTab?: string;
  onTab?: (id: string) => void;
  tabsLabel?: string;
  cta?: NorthStarCta;
  children: ReactNode;
}

export function NorthStarFrame({
  lensId, theme, crumb, title, subtitle, actions, tabs, activeTab, onTab, tabsLabel, cta, children,
}: NorthStarFrameProps) {
  const CtaIcon = cta?.icon;
  return (
    <div data-lens-theme={theme ?? lensId} className="relative min-h-full px-8 pb-28 pt-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[14px] text-zinc-500">{crumb}</p>
          <h1 className={cn('font-vault mt-1 text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl', subtitle ? 'mb-1' : 'mb-5')}>
            {title}
          </h1>
          {subtitle && <p className="mb-5 max-w-2xl text-[14px] text-zinc-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 pt-2">{actions}</div>}
      </div>

      {tabs && tabs.length > 0 && (
        <nav
          className="mb-6 inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1"
          aria-label={tabsLabel ?? `${crumb} views`}
        >
          {tabs.map((t) => {
            const Icon = t.icon;
            const on = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onTab?.(t.id)}
                aria-current={on ? 'page' : undefined}
                title={t.hint ? `${t.hint}${t.keys ? ` (${t.keys})` : ''}` : undefined}
                className={cn(
                  'inline-flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {t.label}
                {t.keys && (
                  <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 sm:inline-block">
                    {t.keys}
                  </kbd>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {children}

      <CrossLensRecentsPanel lensId={lensId} sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          disabled={cta.disabled}
          title={cta.title}
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-60"
        >
          {CtaIcon && <CtaIcon className="h-4 w-4" />}
          {cta.label}
        </button>
      )}
    </div>
  );
}
