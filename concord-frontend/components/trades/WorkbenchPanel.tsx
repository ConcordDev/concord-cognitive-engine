'use client';

/**
 * Inline mount of TradesWorkbench (dispatch / customers / contracts).
 * Extracted from the floating drawer toggle on the old stacked page.
 */

import TradesWorkbench from '@/components/trades/TradesWorkbench';

export default function WorkbenchPanel() {
  return <TradesWorkbench open inline onClose={() => { /* nav owns dismissal */ }} />;
}
