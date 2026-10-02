'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';

export const northPage = 'min-h-[calc(100vh-4rem)] bg-black px-8 pb-28 pt-4 text-zinc-100';

/** One macro, no retry storm. Throws when the envelope is not ok. */
export function useMacro<T>(
  key: unknown[],
  domain: string,
  action: string,
  input: Record<string, unknown>,
  pick: (result: T) => T,
  enabled = true,
) {
  return useQuery({
    queryKey: key,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await lensRun<T>(domain, action, input);
      if (!res.data.ok || res.data.result == null) {
        throw new Error(res.data.error || 'The lens did not answer.');
      }
      return pick(res.data.result);
    },
  });
}

export function usd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function FamilyPill({
  label,
  active,
  items,
}: {
  label: string;
  active: string;
  items: { id: string; label: string; href: string }[];
}) {
  return (
    <nav
      aria-label={label}
      className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1"
    >
      {items.map((item) => {
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

export function BookRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
      <span className="text-[15px] text-zinc-200">{label}</span>
      <span className="text-right text-[14px] text-zinc-400 tabular-nums">{value}</span>
    </div>
  );
}

export function NorthNote({ children }: { children: ReactNode }) {
  return <p className="mt-8 text-[14px] text-zinc-500">{children}</p>;
}

export function NorthError({ message }: { message: string }) {
  return <p className="mt-4 text-[14px] text-rose-300" role="alert">{message}</p>;
}

/** The previous desk stays one click away. The default surface does not mount it. */
export function NorthGate({
  backLabel,
  desk,
  star,
}: {
  backLabel: string;
  desk: ReactNode;
  star: (openDesk: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-black">
        <div className="px-6 pt-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 text-[14px] text-zinc-500 hover:text-zinc-200"
          >
            <ArrowLeft className="h-4 w-4" />
            {backLabel}
          </button>
        </div>
        {desk}
      </div>
    );
  }
  return <>{star(() => setOpen(true))}</>;
}
