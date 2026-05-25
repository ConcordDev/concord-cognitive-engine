'use client';

/**
 * SyncthingReleases — real-data reference panel. Pulls the latest
 * Syncthing releases via the `sync.syncthing_releases` macro (GitHub,
 * free, no key) so the lens shows what the category leader ships.
 */

import { useEffect, useState } from 'react';
import { GitBranch, ExternalLink, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Release {
  tag: string;
  name: string;
  publishedAt: string;
  url: string;
  prerelease: boolean;
  body: string;
}

export function SyncthingReleases() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await lensRun('sync', 'syncthing_releases', {});
      setLoading(false);
      if (r.data?.ok) setReleases(r.data.result?.releases || []);
      else setErr(r.data?.error || 'unreachable');
    })();
  }, []);

  return (
    <div className="space-y-2">
      <header className="flex items-center gap-2 border-b border-cyan-500/15 pb-2">
        <GitBranch className="h-4 w-4 text-cyan-400" />
        <h2 className="text-sm font-semibold text-white">Syncthing releases</h2>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
          github · syncthing/syncthing
        </span>
      </header>
      {loading && (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Pulling latest releases…
        </div>
      )}
      {err && !loading && (
        <div className="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          GitHub unreachable.
        </div>
      )}
      <ul className="space-y-1.5">
        {releases.map((r) => (
          <li key={r.tag}>
            <a
              href={r.url} target="_blank" rel="noopener noreferrer"
              className="block rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2.5 hover:border-cyan-500/40"
            >
              <div className="flex items-center justify-between">
                <p className="font-mono text-[12px] text-zinc-100">{r.name}</p>
                <div className="flex items-center gap-1.5">
                  {r.prerelease && (
                    <span className="rounded bg-amber-900/50 px-1 text-[9px] uppercase text-amber-300">pre</span>
                  )}
                  <ExternalLink className="h-3 w-3 text-zinc-400" />
                </div>
              </div>
              <p className="mt-0.5 text-[10px] text-zinc-400">
                {r.publishedAt ? new Date(r.publishedAt).toLocaleDateString() : ''}
              </p>
            </a>
          </li>
        ))}
        {!loading && !err && releases.length === 0 && (
          <li className="rounded border border-dashed border-zinc-800 p-3 text-center text-[11px] text-zinc-400">
            No releases.
          </li>
        )}
      </ul>
    </div>
  );
}
