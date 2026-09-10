'use client';

// Phase DC8 — HLR reasoning trace browser.
// Thin shell over HlrTracesPanel. Data path unchanged:
//   GET /api/reasoning/traces?limit=100
//   GET /api/reasoning/trace/:id

import { LensShell } from '@/components/lens/LensShell';
import { HlrTracesPanel } from '@/components/reasoning/HlrTracesPanel';

export default function ReasoningTracesPage() {
  return (
    <LensShell lensId="reasoning">
      <HlrTracesPanel />
    </LensShell>
  );
}
