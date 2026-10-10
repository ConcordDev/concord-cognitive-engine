import Link from 'next/link';
import { Bot, LogIn, UserPlus } from 'lucide-react';
import { DEMO_SIGNIN_HREF, DEMO_SIGNUP_HREF } from '@/lib/conkay/demo-api';

/** Header shared by the results index and a design's page. */
export function DesignsHeader({ crumb }: { crumb?: { label: string; href?: string } }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <Bot className="h-5 w-5 shrink-0 text-sky-300" aria-hidden />
        <Link href="/conkay/designs" className="text-base font-semibold tracking-tight hover:text-sky-200">ConKay results</Link>
        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] text-sky-200">read-only · no account</span>
        {crumb && <span className="truncate text-sm text-slate-400">/ {crumb.label}</span>}
      </div>
      <nav className="flex items-center gap-2 text-sm" aria-label="ConKay">
        <Link href="/conkay/demo" className="rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/5">Try the beam demo</Link>
        <Link href={DEMO_SIGNIN_HREF} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-slate-300 hover:bg-white/5">
          <LogIn className="h-4 w-4" aria-hidden /> Sign in
        </Link>
        <Link href={DEMO_SIGNUP_HREF} className="flex items-center gap-1.5 rounded-lg bg-sky-500/90 px-3 py-1.5 font-medium text-white hover:bg-sky-500">
          <UserPlus className="h-4 w-4" aria-hidden /> Create account
        </Link>
      </nav>
    </header>
  );
}
