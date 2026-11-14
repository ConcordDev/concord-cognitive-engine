'use client';

import { Lock } from 'lucide-react';
import { useGuestAuth } from '@/lib/guest';

/** Sign-in link that returns the visitor to this same page (login validates `from` as a relative path). */
export function signInHref(): string {
  if (typeof window === 'undefined') return '/login';
  return `/login?from=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
}

/**
 * Content wrapper for a signed-out visitor on a lens open to browsing
 * (Music, Market). GB-1536: the frame's own header and visitor note
 * are RETIRED — guests now render inside the normal AppShell, whose
 * Topbar carries Log in / Sign up and whose GuestBanner carries the
 * visitor note. What remains is the centred content column the two
 * SignedOut*Browse surfaces were laid out against.
 */
export function VisitorFrame({ active, children }: { active: 'music' | 'market'; children: React.ReactNode }) {
  return (
    <div data-testid="visitor-frame" data-visitor-lens={active} className="text-zinc-100">
      <main className="mx-auto max-w-5xl px-6 py-6">{children}</main>
    </div>
  );
}

/**
 * A write action a visitor cannot take: GB-1536 — opens the signup
 * modal in place (with the return-to) instead of linking away to the
 * login page, and never renders an erroring button.
 */
export function SignInToAct({ children, testId }: { children: React.ReactNode; testId?: string }) {
  const { openAuth } = useGuestAuth();
  return (
    <button
      type="button"
      onClick={() => openAuth('signup')}
      data-testid={testId}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1 text-xs text-zinc-300 hover:bg-white/5"
    >
      <Lock className="h-3 w-3" aria-hidden /> {children}
    </button>
  );
}
