'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { PipingProvider } from '@/components/panel-polish';
import { CollabBoardSection } from './CollabBoardSection';
import { WhiteboardActionPanel } from './WhiteboardActionPanel';
import { WhiteboardActionsStrip } from './WhiteboardActionsStrip';
import { WhiteboardRepos } from './WhiteboardRepos';

type InspectorTab = 'analyze' | 'collab' | 'session' | 'tools';

const TABS: { id: InspectorTab; label: string }[] = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'collab', label: 'Collab' },
  { id: 'session', label: 'Session' },
  { id: 'tools', label: 'Tools' },
];

export function WhiteboardInspector({ boardId }: { boardId?: string }) {
  const [tab, setTab] = useState<InspectorTab>('analyze');
  const wide = tab === 'collab';

  return (
    <aside
      className={cn(
        'flex-shrink-0 border-l border-lattice-border bg-lattice-surface flex flex-col min-h-0',
        wide ? 'w-[min(42vw,520px)]' : 'w-[320px]',
      )}
    >
      <nav className="flex items-center gap-1 px-2 py-2 border-b border-lattice-border overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'px-2.5 py-1 text-[11px] rounded whitespace-nowrap font-medium',
              tab === t.id
                ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                : 'text-gray-400 hover:text-white border border-transparent',
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto min-h-0">
        {tab === 'analyze' && (
          <div className="p-3">
            <WhiteboardActionsStrip boardId={boardId} />
          </div>
        )}
        {tab === 'collab' && (
          <div className="h-full min-h-[480px]">
            <CollabBoardSection />
          </div>
        )}
        {tab === 'session' && (
          <PipingProvider>
            <div className="p-3">
              <WhiteboardActionPanel />
            </div>
          </PipingProvider>
        )}
        {tab === 'tools' && (
          <div className="p-3">
            <WhiteboardRepos />
          </div>
        )}
      </div>
    </aside>
  );
}
