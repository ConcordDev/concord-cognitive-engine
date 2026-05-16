'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCode, Loader2, ExternalLink } from 'lucide-react';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface Gist {
  id: string;
  description: string | null;
  html_url: string;
  public: boolean;
  files: Record<string, { filename: string; language: string | null; size: number; raw_url: string }>;
  owner?: { login: string; avatar_url: string };
  created_at: string;
  updated_at: string;
  comments: number;
}

export function PublicGistGallery() {
  const [tick, setTick] = useState(0);

  const gists = useQuery({
    queryKey: ['public-gists', tick],
    queryFn: async () => {
      const r = await fetch('https://api.github.com/gists/public?per_page=30', { headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(`github gists ${r.status}`);
      return (await r.json()) as Gist[];
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <FileCode className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Public gist inspiration</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">api.github.com/gists/public · live</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setTick((t) => t + 1)} className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-200 hover:bg-cyan-500/20">Refresh</button>
          {(gists.data?.length ?? 0) > 0 && (
            <SaveAsDtuButton
              compact
              apiSource="github-gists"
              apiUrl="https://api.github.com/gists/public"
              title={`Public gists — ${gists.data?.length}`}
              content={(gists.data || []).slice(0, 20).map((g, i) => `${i + 1}. ${g.description || '(no description)'} by ${g.owner?.login || '?'}\n   files: ${Object.values(g.files).map((f) => `${f.filename}${f.language ? ` [${f.language}]` : ''}`).join(', ')}\n   ${g.html_url}`).join('\n\n')}
              extraTags={['custom', 'gists', 'github']}
              rawData={{ gists: gists.data }}
            />
          )}
        </div>
      </header>
      {gists.isError && <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">GitHub gists unreachable.</div>}
      {gists.isPending && <div className="flex items-center gap-2 text-xs text-zinc-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
      <div className="space-y-1 max-h-[500px] overflow-y-auto">
        {(gists.data || []).map((g) => {
          const files = Object.values(g.files);
          const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
          return (
            <a key={g.id} href={g.html_url} target="_blank" rel="noopener noreferrer" className="block rounded border border-zinc-800 bg-zinc-950 p-2.5 hover:border-cyan-500/30">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="line-clamp-1 text-[12px] text-white">{g.description || `Gist ${g.id.slice(0, 8)}`}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-zinc-500">
                    <span>{g.owner?.login || '?'}</span>
                    <span>{files.length} files · {(totalSize / 1024).toFixed(1)} KB</span>
                    <span>{g.comments} comments</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {files.slice(0, 4).map((f) => (
                      <span key={f.filename} className="rounded bg-zinc-800 px-1 font-mono text-[9px] text-cyan-300/80">
                        {f.filename}{f.language ? ` [${f.language}]` : ''}
                      </span>
                    ))}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
