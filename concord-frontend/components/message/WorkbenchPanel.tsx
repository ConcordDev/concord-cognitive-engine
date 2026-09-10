'use client';

/**
 * WorkbenchPanel — saved/starred, search, voice notes, reactions.
 * Embeds MessageWorkbench as a full-tab surface (was a floating drawer).
 * All macros remain inside MessageWorkbench — extract, don't invent.
 */

import MessageWorkbench from '@/components/message/MessageWorkbench';

export function WorkbenchPanel() {
  return (
    <div className="relative min-h-[70vh] rounded-xl border border-lattice-border overflow-hidden bg-lattice-surface/30">
      {/* Override the drawer's fixed positioning so it fills the tab pane. */}
      <div className="[&>div]:!relative [&>div]:!inset-auto [&>div]:!w-full [&>div]:!max-w-none [&>div]:h-[70vh] [&>div]:!shadow-none [&>div]:!border-0">
        <MessageWorkbench open onClose={() => { /* tab surface — stay open */ }} />
      </div>
    </div>
  );
}
