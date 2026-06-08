'use client';

/**
 * LensAgentFab — Sprint 15
 *
 * One-liner mount for any lens to get Agent Mode at chat-lens baseline
 * depth. Renders:
 *   - Bottom-right floating action button labeled "Agent · <lensId>"
 *   - Slide-over panel (LensAgentPanel) when clicked
 *
 * Usage in any lens page.tsx:
 *
 *   import LensAgentFab from '@/components/lens/LensAgentFab';
 *   ...
 *   <LensAgentFab lensId="studio" lensPrompt="..." />
 *
 * That's it. The lens now has voice input, BYO model picker, streaming,
 * tool calls across 200+ apps, inline artifact rendering — same as the
 * main chat lens.
 */

import { useState } from 'react';
import dynamic from 'next/dynamic';

const LensAgentPanel = dynamic(() => import('./LensAgentPanel'), { ssr: false });

interface LensAgentFabProps {
  lensId: string;
  lensPrompt?: string;
  label?: string;
  position?: 'bottom-right' | 'bottom-left';
}

export default function LensAgentFab({ lensId, lensPrompt, label, position = 'bottom-right' }: LensAgentFabProps) {
  const [open, setOpen] = useState(false);

  const posClass = position === 'bottom-left'
    ? 'fixed bottom-6 left-6'
    : 'fixed bottom-[5.5rem] right-6';

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`${posClass} z-30 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-500 hover:bg-amber-400 text-amber-50 shadow-2xl ring-2 ring-amber-700/30 text-sm font-medium`}
        title={`Agent Mode for ${lensId} — 200+ tools, web, compute, citations`}
        data-testid={`agent-fab-${lensId}`}
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 8V4H8M4 8h4v4M16 4v4h4M20 16h-4v4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {label || `Agent · ${lensId}`}
      </button>
      <LensAgentPanel
        lensId={lensId}
        lensPrompt={lensPrompt}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
