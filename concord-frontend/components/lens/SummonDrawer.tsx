'use client';

// World Lens plan Phase 5 (Panels: Glance → Summon → Sanctum) — the
// generic "Summon" primitive: a temporary workspace that slides in, closes,
// and returns to the world underneath it (never a full takeover, never a
// permanent window). Extracted from concord-link/LinkShell.tsx, the one
// place this exact shell shape (`fixed inset-y-0 right-0 z-40`, backdrop
// blur, header + close button) already existed and had already proven
// itself in production — Connect/Extend, not a new invention. LinkShell now
// consumes this instead of inlining its own copy of the shell markup.
//
// Intended consumers: any of app/lenses/world/page.tsx's `showPanel==='X'`
// modals that pass the "is this a temporary workspace the player steps
// into and back out of?" test (inventory, map, crafting, research,
// dialogue, ...) — as opposed to a Glance (transient HUD readout) or a
// Sanctum (full immersive takeover: Builder, World Editor, Research
// Studio, Simulation, Developer tools).

import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SummonDrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind width class. Defaults to LinkShell's proven w-80. */
  widthClassName?: string;
  testId?: string;
}

export function SummonDrawer({
  open,
  title,
  onClose,
  children,
  widthClassName = 'w-80',
  testId,
}: SummonDrawerProps) {
  if (!open) return null;

  return (
    <div
      className={`fixed inset-y-0 right-0 z-40 ${widthClassName} max-w-[90vw] bg-zinc-950/95 border-l border-cyan-500/30 backdrop-blur p-4 overflow-y-auto`}
      data-testid={testId}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-cyan-300">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-zinc-800 text-zinc-400">
          <X className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

export default SummonDrawer;
