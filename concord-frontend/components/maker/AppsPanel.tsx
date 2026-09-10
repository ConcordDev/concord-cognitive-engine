'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { motion } from 'framer-motion';
import { AppWindow, Loader2, ArrowUpRight } from 'lucide-react';

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

export function AppsPanel() {
  const qc = useQueryClient();
  const apps = useQuery({
    queryKey: ['maker-apps'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('apps', 'list', {});
      return (r.data?.result ?? r.data) as {
        apps?: Array<{ id: string; name?: string; status?: string; spec?: unknown }>;
      };
    },
  });
  const appMetrics = useQuery({
    queryKey: ['maker-apps-metrics'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('apps', 'metrics', {});
      return (r.data?.result ?? r.data) as Record<string, number | string>;
    },
  });
  const promoteApp = useMutation({
    mutationFn: async (id: string) => {
      const r = await apiHelpers.lens.runDomain('apps', 'promote', { id });
      return r.data?.result ?? r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maker-apps'] }),
  });

  return (
    <section>
      {appMetrics.data && (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Object.entries(appMetrics.data)
            .slice(0, 4)
            .map(([k, v]) => (
              <Stat key={k} label={k} value={typeof v === 'number' ? v : String(v)} />
            ))}
        </div>
      )}
      <h2 className="mb-3 text-base font-semibold text-pink-200">Apps</h2>
      {apps.isLoading && <Loader2 className="h-4 w-4 animate-spin text-pink-500" />}
      {(apps.data?.apps ?? []).length === 0 && !apps.isLoading && (
        <Empty>No apps yet — create one via the App Maker macros.</Empty>
      )}
      <ul className="space-y-1">
        {(apps.data?.apps ?? []).map((a) => (
          <li
            key={a.id}
            className="flex items-center gap-3 rounded border border-pink-900/30 bg-pink-950/10 px-3 py-2 text-xs"
          >
            <AppWindow className="h-3.5 w-3.5 text-pink-500" aria-hidden />
            <span className="font-mono text-pink-300">{a.id}</span>
            {a.name && <span className="text-pink-100">{a.name}</span>}
            <span className="ml-auto rounded bg-pink-800/30 px-1.5 py-0.5 text-[10px]">
              {a.status ?? '—'}
            </span>
            {a.status !== 'promoted' && (
              <button
                onClick={() => promoteApp.mutate(a.id)}
                disabled={promoteApp.isPending}
                className="inline-flex items-center gap-1 rounded bg-pink-700/50 px-1.5 py-0.5 text-[10px] hover:bg-pink-600/60 disabled:opacity-40"
                aria-label={`Promote app ${a.id}`}
              >
                <ArrowUpRight className="h-2.5 w-2.5" aria-hidden /> Promote
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
