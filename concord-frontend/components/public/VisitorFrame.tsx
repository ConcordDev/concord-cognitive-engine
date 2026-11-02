'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';

/** Sign-in link that returns the visitor to this same page (login validates `from` as a relative path). */
export function signInHref(): string {
  if (typeof window === 'undefined') return '/login';
  return `/login?from=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

/**
 * Chrome for a signed-out visitor on a lens open to browsing (Music, Market): the brand, the two open
 * lenses, sign-in / create-account, and one honest line about what a visitor can and cannot do. The
 * member sidebar and topbar are not rendered for visitors (see AppShell), so this is their only chrome.
 */
export function VisitorFrame({ active, children }: { active: 'music' | 'market'; children: React.ReactNode }) {
  const tab = (id: 'music' | 'market', label: string) => (
    <Link
      href={`/lenses/${id}`}
      aria-current={active === id ? 'page' : undefined}
      className={`rounded-full px-4 py-1.5 text-sm transition-colors ${active === id ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200'}`}
    >
      {label}
    </Link>
  );
  return (
    <div data-testid="visitor-frame" data-visitor-lens={active} className="min-h-screen bg-lattice-void text-zinc-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-white/5 px-6 py-3">
        <Link href="/" className="font-vault text-lg text-zinc-100">Concord</Link>
        <nav aria-label="Browse" className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] p-1">
          {tab('music', 'Music')}
          {tab('market', 'Market')}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link data-testid="visitor-signin" href={signInHref()} className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:text-white">Sign in</Link>
          <Link data-testid="visitor-register" href="/register" className="rounded-md bg-teal-400 px-3 py-1.5 text-sm font-medium text-black hover:bg-teal-300">Create account</Link>
        </div>
      </header>
      <p data-testid="visitor-note" className="flex items-center gap-2 border-b border-white/5 bg-white/[0.02] px-6 py-2 text-xs text-zinc-400">
        <Lock className="h-3 w-3 shrink-0" aria-hidden />
        You are browsing as a visitor: public items only, previews are the first 30 seconds. Sign in to hear the full track, buy, list, upload, like or comment.
      </p>
      <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
    </div>
  );
}

/** A write action a visitor cannot take: a link to sign in (back to this page), never an erroring button. */
export function SignInToAct({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <Link
      href={signInHref()}
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5"
    >
      <Lock className="h-3 w-3" aria-hidden /> {children}
    </Link>
  );
}
