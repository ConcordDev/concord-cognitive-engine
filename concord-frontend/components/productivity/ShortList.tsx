'use client';

/** Productivity north star — today's due tasks, plus one add. */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Task = { id: string; content?: string; dueDate?: string | null };

function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ShortList({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('productivity');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const [draft, setDraft] = useState('');
  const [composing, setComposing] = useState(false);
  const listQ = useMacro<{ tasks?: Task[] }>(
    ['productivity-northstar', 'today'],
    'productivity',
    'today-view',
    {},
    (result) => {
      if (!Array.isArray(result.tasks)) throw new Error('Today did not answer.');
      return result;
    },
  );
  const add = useMutation({
    mutationFn: async (content: string) => {
      const res = await lensRun<{ task?: Task }>('productivity', 'task-add', { content, dueDate: serverToday() });
      if (!res.data.ok || !res.data.result?.task?.id) throw new Error(res.data.error || 'The task was not added.');
      return res.data.result.task;
    },
    onSuccess: () => {
      setDraft('');
      setComposing(false);
      void client.invalidateQueries({ queryKey: ['productivity-northstar', 'today'] });
    },
  });
  const tasks = listQ.data?.tasks ?? [];
  const loadError = listQ.error instanceof Error ? listQ.error.message : '';
  const actError = add.error instanceof Error ? add.error.message : '';

  function onAdd() {
    const content = draft.trim();
    if (!composing) {
      setComposing(true);
      return;
    }
    if (!content) return;
    add.mutate(content);
  }

  return (
    <LensShell lensId="productivity" asMain={false} disableAgentFab>
      <div data-lens-theme="productivity" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Productivity" title={who ? `Today's short list, ${who}` : "Today's short list"} />
          <QuietMore items={[{ id: 'desk', label: 'Tasks' }]} onPick={onOpenDesk} />
        </div>
        {(loadError || actError) && <NorthError message={loadError || actError} />}
        {listQ.data && (
          <div className="mt-6 min-h-[420px] rounded-2xl border border-white/10 px-4 py-4" data-testid="productivity-list">
            {tasks.length === 0 && <p className="text-[14px] text-zinc-400">Nothing on the list.</p>}
            {tasks.length > 0 && (
              <ul className="divide-y divide-white/10">
                {tasks.map((t) => (
                  <li key={t.id} className="py-3 text-[15px] text-zinc-100">{t.content || 'Untitled'}</li>
                ))}
              </ul>
            )}
            {composing && (
              <label className="mt-4 block text-[13px] text-zinc-500">
                Task
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-transparent px-3 py-2 text-[15px] text-zinc-100 outline-none"
                />
              </label>
            )}
          </div>
        )}
        <button type="button" className={northCtaClass} onClick={onAdd} disabled={listQ.isLoading || add.isPending}>+ Add</button>
      </div>
    </LensShell>
  );
}
