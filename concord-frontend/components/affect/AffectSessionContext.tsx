'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

type AffectSessionCtx = {
  sessionId: string;
  setSessionId: (id: string) => void;
};

const Ctx = createContext<AffectSessionCtx | null>(null);

export function AffectSessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionId] = useState('default');
  const value = useMemo(() => ({ sessionId, setSessionId }), [sessionId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAffectSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAffectSession requires AffectSessionProvider');
  return ctx;
}
