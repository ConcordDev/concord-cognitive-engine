'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

const FAMILY = [
  { id: 'code', label: 'Code', href: '/lenses/code' },
  { id: 'debug', label: 'Debug', href: '/lenses/debug' },
  { id: 'database', label: 'Database', href: '/lenses/database' },
  { id: 'repos', label: 'Repos', href: '/lenses/repos' },
] as const;

export type CodeFamilyId = (typeof FAMILY)[number]['id'];

/** Quiet Code · Debug · Database · Repos pill from the north-star concepts. */
export function CodeFamilyPill({ active }: { active: CodeFamilyId }) {
  return (
    <nav
      aria-label="Code family"
      className="mt-5 inline-flex items-center gap-0.5 rounded-full border border-white/10 bg-white/[0.04] p-1"
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

export function NorthGreeting({ kicker, title }: { kicker: string; title: string }) {
  return (
    <header>
      <p className="text-[13px] text-zinc-500">{kicker}</p>
      <h1 className="mt-1 font-vault text-[2.75rem] leading-[1.05] text-zinc-100">{title}</h1>
    </header>
  );
}

export const northCtaClass =
  'fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300 disabled:opacity-50';

/** Tools that stay reachable, off the default surface. */
export function QuietMore({
  label = 'More',
  items,
  onPick,
}: {
  label?: string;
  items: { id: string; label: string; key?: string }[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-[14px] text-zinc-500 transition-colors hover:text-zinc-200"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
          {items.map((item) => (
            <button
              key={item.id}
              role="menuitem"
              type="button"
              onClick={() => { setOpen(false); onPick(item.id); }}
              className="flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] hover:text-zinc-50"
            >
              <span className="flex-1">{item.label}</span>
              {item.key && <kbd className="font-mono text-[11px] text-zinc-500">{item.key}</kbd>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
