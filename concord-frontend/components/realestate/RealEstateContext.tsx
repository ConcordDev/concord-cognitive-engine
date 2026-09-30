'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Listing } from './ListingsBrowser';

interface RealEstateSelection {
  selected: Listing | null;
  setSelected: (listing: Listing | null) => void;
  comparePicks: string[];
  togglePick: (id: string) => void;
  clearPicks: () => void;
}

const Ctx = createContext<RealEstateSelection | null>(null);

export function RealEstateProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<Listing | null>(null);
  const [comparePicks, setComparePicks] = useState<string[]>([]);

  const togglePick = useCallback((id: string) => {
    setComparePicks((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev,
    );
  }, []);

  const clearPicks = useCallback(() => setComparePicks([]), []);

  const value = useMemo(
    () => ({ selected, setSelected, comparePicks, togglePick, clearPicks }),
    [selected, comparePicks, togglePick, clearPicks],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRealEstateSelection(): RealEstateSelection {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useRealEstateSelection must be used inside RealEstateProvider');
  return ctx;
}
