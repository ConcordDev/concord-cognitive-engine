'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { motion } from 'framer-motion';
import { Wand2, Loader2, Plus } from 'lucide-react';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.18 }}
      className="rounded-lg border border-pink-900/40 bg-pink-950/10 p-3 text-pink-200"
    >
      <div className="mb-1 text-[11px] uppercase tracking-wider text-pink-700">{label}</div>
      <div className="font-mono text-xl font-semibold">{value}</div>
    </motion.div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-pink-900/30 bg-pink-950/10 px-4 py-6 text-center text-xs text-pink-600">
      {children}
    </p>
  );
}

export function QuestsPanel() {
  const qc = useQueryClient();
  const [questTitle, setQuestTitle] = useState('');
  const quests = useQuery({
    queryKey: ['maker-quests'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'list', {});
      return (r.data?.result ?? r.data) as {
        quests?: Array<{ id: string; title?: string; status?: string; domain?: string }>;
      };
    },
  });
  const questActive = useQuery({
    queryKey: ['maker-quest-active'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'active', {});
      return (r.data?.result ?? r.data) as { active?: number; quests?: unknown[] };
    },
    refetchInterval: 30_000,
  });
  const questMetrics = useQuery({
    queryKey: ['maker-quest-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'metrics', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });
  const createQuest = useMutation({
    mutationFn: async () => {
      const r = await apiHelpers.lens.runDomain('quest', 'create', {
        title: questTitle,
        config: {},
      });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maker-quests'] });
      setQuestTitle('');
    },
  });

  return (
    <section>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label="Active" value={questActive.data?.active ?? 0} />
        <Stat label="Total" value={quests.data?.quests?.length ?? 0} />
        {questMetrics.data?.completed != null && (
          <Stat label="Completed" value={questMetrics.data.completed} />
        )}
      </div>

      <div className="mb-4 rounded-lg border border-pink-900/40 bg-pink-950/10 p-3">
        <h3 className="mb-2 text-sm font-semibold text-pink-300">Create quest</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={questTitle}
            onChange={(e) => setQuestTitle(e.target.value)}
            placeholder="Quest title"
            className="flex-1 rounded border border-pink-900/40 bg-black/40 px-2 py-1.5 font-mono text-sm text-pink-100 focus:border-pink-500 focus:outline-none focus:ring-1 focus:ring-pink-500"
            aria-label="Quest title"
          />
          <button
            onClick={() => createQuest.mutate()}
            disabled={!questTitle || createQuest.isPending}
            className="inline-flex items-center gap-1 rounded bg-pink-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-pink-400"
          >
            {createQuest.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}{' '}
            Create
          </button>
        </div>
      </div>

      <h2 className="mb-3 text-base font-semibold text-pink-200">Quests</h2>
      {(quests.data?.quests ?? []).length === 0 && !quests.isLoading ? (
        <Empty>No quests yet.</Empty>
      ) : (
        <ul className="space-y-1">
          {(quests.data?.quests ?? []).map((q) => (
            <li
              key={q.id}
              className="flex items-center gap-3 rounded border border-pink-900/30 bg-pink-950/10 px-3 py-2 text-xs"
            >
              <Wand2 className="h-3.5 w-3.5 text-pink-500" aria-hidden />
              <span className="font-mono text-pink-300">{q.id}</span>
              {q.title && <span className="text-pink-100">{q.title}</span>}
              {q.domain && (
                <span className="rounded bg-pink-800/30 px-1.5 py-0.5 text-[10px]">{q.domain}</span>
              )}
              <span className="ml-auto text-[10px] text-pink-700">{q.status}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
