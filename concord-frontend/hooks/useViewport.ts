'use client';

/**
 * useViewport — tiny SSR-safe hook returning current viewport
 * breakpoint info for responsive component logic.
 *
 * Phase 5 of the UX completeness sprint (mobile track).
 *
 * Returns:
 *   { width, isMobile, isTablet, isDesktop, isTouch }
 *
 * Breakpoints (Tailwind defaults):
 *   isMobile  → width < 640
 *   isTablet  → 640 ≤ width < 1024
 *   isDesktop → width ≥ 1024
 *
 * Touch detection uses pointer:coarse media query (real, not navigator
 * sniffing).
 */

import { useEffect, useState } from 'react';

export interface ViewportInfo {
  width: number;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isTouch: boolean;
}

const INITIAL: ViewportInfo = {
  width: 1024, // SSR-friendly default
  isMobile: false,
  isTablet: false,
  isDesktop: true,
  isTouch: false,
};

export function useViewport(): ViewportInfo {
  const [v, setV] = useState<ViewportInfo>(INITIAL);

  useEffect(() => {
    const compute = (): ViewportInfo => {
      const w = window.innerWidth;
      const isTouch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
      return {
        width: w,
        isMobile: w < 640,
        isTablet: w >= 640 && w < 1024,
        isDesktop: w >= 1024,
        isTouch,
      };
    };
    setV(compute());
    const onResize = () => setV(compute());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return v;
}

export default useViewport;
