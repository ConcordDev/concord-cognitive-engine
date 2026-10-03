'use client';

/**
 * Schema lens: north-star look (serif title, pill tabs, teal CTA) with every
 * tool one click away: canvas, registry, visual editor, sample data,
 * migrations, diff, evolution, conformance, ER diagram, import and GitHub tooling.
 */

import { useState } from 'react';
import { Plus, LayoutGrid, Wrench } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensIdentity } from '@/hooks/useLensIdentity';
import { useAuth } from '@/hooks/useAuth';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';
import { cn } from '@/lib/utils';
import { SchemaRepos } from '@/components/schema/SchemaRepos';
import { SchemaWorkbench, SCHEMA_TOOL_TABS, type SchemaTab } from '@/components/schema/SchemaWorkbench';

type View = SchemaTab | 'tooling';

const NAV: { id: View; label: string; title: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'canvas', label: 'Canvas', title: 'The shape of the data', icon: LayoutGrid },
  ...SCHEMA_TOOL_TABS.map((t) => ({ id: t.id as View, label: t.label, title: t.label, icon: t.icon })),
  { id: 'tooling', label: 'Tooling', title: 'Schema tooling', icon: Wrench },
];

export default function SchemaLensPage() {
  useLensNav('schema');
  useLensIdentity('schema');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const [view, setView] = useState<View>('canvas');
  const [newSignal, setNewSignal] = useState(0);

  const newSchema = () => setNewSignal((n) => n + 1);

  useLensCommand(
    [
      { id: 'schema-new', keys: 'n', description: 'New schema', category: 'actions', action: () => { setView('canvas'); newSchema(); } },
      ...NAV.slice(0, 9).map((n, i) => ({
        id: `schema-view-${n.id}`,
        keys: String(i + 1),
        description: n.label,
        category: 'navigation' as const,
        action: () => setView(n.id),
      })),
    ],
    { lensId: 'schema' },
  );

  const onCanvas = view === 'canvas';
  const current = NAV.find((n) => n.id === view)!;

  return (
    <LensShell lensId="schema" asMain={false}>
      <div data-lens-theme="schema" className="relative min-h-full px-8 pb-10 pt-6">
        <p className="text-[14px] text-zinc-500">Schema</p>
        <h1 className="mb-5 mt-1 font-vault text-[2.25rem] leading-tight text-zinc-100 sm:text-5xl">
          {onCanvas ? `${current.title}${who ? `, ${who}` : ''}` : current.title}
        </h1>

        <nav className="mb-6 flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.03] p-1 sm:inline-flex" aria-label="Schema tools">
          {NAV.map((n, i) => {
            const Icon = n.icon;
            const on = view === n.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setView(n.id)}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[14px] transition-colors',
                  on ? 'bg-white/10 text-zinc-50' : 'text-zinc-500 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {n.label}
                {i < 9 && <kbd className="hidden rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono text-[10px] text-white/30 xl:inline-block">{i + 1}</kbd>}
              </button>
            );
          })}
        </nav>

        {view === 'tooling' ? (
          <SchemaRepos />
        ) : (
          <SchemaWorkbench
            bare
            tab={view}
            onTabChange={(t) => setView(t)}
            newSignal={newSignal}
          />
        )}

        {onCanvas && (
          <button
            type="button"
            onClick={newSchema}
            title="New schema (N)"
            className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
          >
            <Plus className="h-4 w-4" />
            New schema
          </button>
        )}
      </div>
    </LensShell>
  );
}
