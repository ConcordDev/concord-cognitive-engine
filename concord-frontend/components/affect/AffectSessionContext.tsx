'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AffectSessionCtx = {
  sessionId: string;
  setSessionId: (id: string) => void;
};

const Ctx = createContext<AffectSessionCtx | null>(null);

export function AffectSessionProvider({ children }: { children: ReactNode }) {
  // FIX-affect-001: no shared bucket by default. An empty id means "the
  // caller's own session" — the server keys affect state per user and
  // falls back to it whenever no session is named, so a private check-in
  // can no longer land in (or be read from) a session every member
  // shares. A named session can still be set deliberately for viewing.
  const [sessionId, setSessionId] = useState('');
  const value = useMemo(() => ({ sessionId, setSessionId }), [sessionId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAffectSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAffectSession requires AffectSessionProvider');
  return ctx;
}
