'use client';

/**
 * Notion/Confluence workspace + live docs-dashboard stats strip.
 * Extracted from docs/page.tsx.
 */

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { FileText, Layers, CheckCircle2, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { DocsWorkspace } from '@/components/docs/DocsWorkspace';

export function WorkspacePanel() {
  const [docsStats, setDocsStats] = useState<{
    pages: number; topLevelPages: number; totalBlocks: number;
    words: number; openTodos: number; doneTodos: number;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void lensRun('docs', 'docs-dashboard', {}).then((r) => {
      if (alive && r.data?.ok) {
        setDocsStats(r.data.result as typeof docsStats);
      }
    });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <FileText className="w-5 h-5 text-neon-blue" />
          <div>
            <p className="text-lg font-bold">{docsStats?.pages ?? 0}</p>
            <p className="text-xs text-gray-400">Workspace Pages</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Layers className="w-5 h-5 text-neon-green" />
          <div>
            <p className="text-lg font-bold">{docsStats?.totalBlocks ?? 0}</p>
            <p className="text-xs text-gray-400">Total Blocks</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <CheckCircle2 className="w-5 h-5 text-neon-purple" />
          <div>
            <p className="text-lg font-bold">{docsStats?.openTodos ?? 0}</p>
            <p className="text-xs text-gray-400">Open To-dos</p>
          </div>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3 * 0.05 }}
          className="panel p-3 flex items-center gap-3"
        >
          <Clock className="w-5 h-5 text-neon-cyan" />
          <div>
            <p className="text-lg font-bold">{(docsStats?.words ?? 0).toLocaleString()}</p>
            <p className="text-xs text-gray-400">Words Written</p>
          </div>
        </motion.div>
      </div>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <DocsWorkspace />
      </section>
    </div>
  );
}
