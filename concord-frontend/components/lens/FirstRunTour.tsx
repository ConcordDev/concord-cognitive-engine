'use client';

/**
 * FirstRunTour — retired. Quick tours no longer auto-open or dim the page.
 * The export stays so any leftover import is a silent no-op.
 */

export interface FirstRunTourProps {
  lensId: string;
  force?: boolean;
  onComplete?: (mode: 'finished' | 'skipped') => void;
}

export function FirstRunTour(_props: FirstRunTourProps) {
  return null;
}

export default FirstRunTour;
