'use client';

/**
 * PreviewPane — live in-lens app preview. Renders the server-built
 * static HTML for a project page into a sandboxed iframe via srcDoc.
 * Backed by `app-maker` previewRender + deployPublish.
 */

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { Eye, Loader2, Rocket, ExternalLink, X } from 'lucide-react';

interface PageRef { id: string; name: string; route: string }

export function PreviewPane({
  projectId,
  initialPageId,
  onClose,
}: {
  projectId: string;
  initialPageId?: string;
  onClose: () => void;
}) {
  const [html, setHtml] = useState('');
  const [pages, setPages] = useState<PageRef[]>([]);
  const [activePage, setActivePage] = useState<string | undefined>(initialPageId);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);

  async function render(pageId?: string) {
    setLoading(true);
    const r = await lensRun('app-maker', 'previewRender', { projectId, pageId });
    setLoading(false);
    if (r.data?.ok) {
      setHtml(r.data.result?.html ?? '');
      setPages(r.data.result?.pages ?? []);
      setActivePage(r.data.result?.page?.id);
    }
  }

  useEffect(() => {
    void render(initialPageId);
    lensRun('app-maker', 'deployStatus', { projectId }).then((r) => {
      if (r.data?.ok && r.data.result?.deployment?.status === 'live') {
        setDeployUrl(r.data.result.deployment.url);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function deploy() {
    setDeploying(true);
    const r = await lensRun('app-maker', 'deployPublish', { projectId });
    setDeploying(false);
    if (r.data?.ok) setDeployUrl(r.data.result?.deployment?.url ?? null);
  }

  return (
    <div className="rounded-lg border border-pink-700/50 bg-pink-950/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-pink-200">
          <Eye className="h-4 w-4" /> Live preview
        </h3>
        <div className="flex gap-1">
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => render(p.id)}
              className={`rounded px-2 py-0.5 text-[10px] ${
                activePage === p.id ? 'bg-pink-700/50 text-pink-100' : 'bg-pink-950/40 text-pink-500 hover:text-pink-300'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={deploy}
            disabled={deploying}
            className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {deploying ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />} Deploy
          </button>
          <button aria-label="Close" onClick={onClose} className="rounded p-1 text-pink-500 hover:text-pink-200">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {deployUrl && (
        <a
          href={deployUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 inline-flex items-center gap-1 rounded bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-300 hover:text-emerald-100"
        >
          <ExternalLink className="h-3 w-3" /> {deployUrl}
        </a>
      )}
      <div className="relative h-[460px] overflow-hidden rounded border border-pink-900/40 bg-[#020617]">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-pink-500" />
          </div>
        )}
        <iframe
          title="App preview"
          sandbox="allow-same-origin"
          srcDoc={html}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
