'use client';

// Phase DC8 — HLR reasoning trace browser, in the north-star look.
// Data path unchanged:
//   GET /api/reasoning/traces?limit=100
//   GET /api/reasoning/trace/:id

import { useCallback } from 'react';
import { FileSearch } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { FirstRunTour } from '@/components/lens/FirstRunTour';
import { DepthBadge } from '@/components/lens/DepthBadge';
import { CrossLensRecentsPanel } from '@/components/lens/CrossLensRecentsPanel';
import { HlrTracesPanel } from '@/components/reasoning/HlrTracesPanel';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

export default function ReasoningTracesPage() {
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);

  const openTrace = useCallback(() => {
    const first = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Reasoning traces"] [role="option"]');
    if (first) {
      first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first.click();
    } else {
      document.getElementById('reasoning-mode-filter')?.focus();
    }
  }, []);

  useLensCommand(
    [{ id: 'open-trace', keys: 'n', description: 'Open the latest trace', category: 'actions' as const, action: openTrace }],
    { lensId: 'reasoning' },
  );

  return (
    <LensShell lensId="reasoning" asMain={false}>
      <FirstRunTour lensId="reasoning" />
      <DepthBadge lensId="reasoning" size="sm" className="ml-2" />
      <div data-lens-theme="reasoning" className="relative min-h-full px-8 pb-28 pt-6">
        <p className="text-[14px] text-zinc-500">HLR Traces</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          The trace{who ? `, ${who}` : ''}
        </h1>

        <HlrTracesPanel />

        <CrossLensRecentsPanel lensId="reasoning" sinceDays={7} limit={6} hideWhenEmpty className="mt-8" />

        <button
          type="button"
          onClick={openTrace}
          title="Open the latest trace (N)"
          className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
        >
          <FileSearch className="h-4 w-4" />
          Open a trace
        </button>
      </div>
    </LensShell>
  );
}
