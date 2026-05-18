'use client';

/**
 * RepoIndexPanel — Code Sprint A #5.
 *
 * Surfaces the previously-dark `server/lib/code-engine.js` (1,786 LOC,
 * audit-verified unused). Lets the user:
 *   - ingest a local path or GitHub URL into code_repositories
 *   - browse extracted patterns by category / CRETI
 *   - browse MEGA-compressed pattern clusters
 *   - see engine-wide stats
 *
 * Every extracted pattern is a kind='code_pattern' DTU; the cascade
 * pays the original ingestor when a downstream user cites the pattern
 * in their build.
 */

import { useEffect, useState, useCallback } from 'react';
import { Database as DbIcon, RefreshCw, Loader2, AlertCircle, Search, ChevronDown, ChevronRight, FolderInput, Hash, Cpu } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface RepoRow { id: string; name?: string; owner?: string; url?: string; language?: string; pattern_count?: number; status?: string; ingested_at?: string }
interface PatternRow { id: string; name: string; category?: string; language?: string; file_path?: string; _avgCreti?: number; description?: string }
interface MegaRow { id: string; topic?: string; compressed_from_count?: number; avg_creti?: number; created_at?: string }
interface EngineStats { repositories?: number; patterns?: number; megas?: number; lensGenerations?: number; errors?: number }

const CATEGORIES = ['', 'architectural', 'error_handling', 'security', 'performance', 'testing', 'data_modeling', 'api_design', 'concurrency'];

async function callMacro<T>(name: string, input: Record<string, unknown>): Promise<T | null> {
  try {
    const r = await api.post('/api/lens/run', { domain: 'code', name, input });
    return (r.data?.result ?? r.data) as T;
  } catch {
    return null;
  }
}

export function RepoIndexPanel() {
  const [stats, setStats] = useState<EngineStats | null>(null);
  const [repos, setRepos] = useState<RepoRow[]>([]);
  const [patterns, setPatterns] = useState<PatternRow[]>([]);
  const [megas, setMegas] = useState<MegaRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [section, setSection] = useState<'repos' | 'patterns' | 'megas'>('repos');
  const [showIngest, setShowIngest] = useState(false);
  const [ingestUrl, setIngestUrl] = useState('');
  const [ingestLocal, setIngestLocal] = useState('');
  const [ingestAllowCopyleft, setIngestAllowCopyleft] = useState(false);
  const [ingestResult, setIngestResult] = useState<string | null>(null);

  const [searchCategory, setSearchCategory] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchMinCreti, setSearchMinCreti] = useState('');

  const refreshStats = useCallback(async () => {
    const s = await callMacro<{ ok: boolean; stats?: EngineStats }>('engine_stats', {});
    if (s?.ok && s.stats) setStats(s.stats);
  }, []);

  const refreshRepos = useCallback(async () => {
    setBusy('repos');
    const r = await callMacro<{ ok: boolean; repositories?: RepoRow[]; reason?: string }>('list_repos', { limit: 50 });
    if (r?.ok && r.repositories) setRepos(r.repositories);
    else if (r?.reason) setErr(r.reason);
    setBusy(null);
  }, []);

  const refreshPatterns = useCallback(async () => {
    setBusy('patterns');
    const r = await callMacro<{ ok: boolean; patterns?: PatternRow[]; reason?: string }>('search_patterns', {
      category: searchCategory || undefined,
      name: searchName || undefined,
      minCreti: searchMinCreti ? Number(searchMinCreti) : undefined,
      limit: 50,
    });
    if (r?.ok && r.patterns) setPatterns(r.patterns);
    else if (r?.reason) setErr(r.reason);
    setBusy(null);
  }, [searchCategory, searchName, searchMinCreti]);

  const refreshMegas = useCallback(async () => {
    setBusy('megas');
    const r = await callMacro<{ ok: boolean; megas?: MegaRow[]; reason?: string }>('list_megas', { limit: 50 });
    if (r?.ok && r.megas) setMegas(r.megas);
    else if (r?.reason) setErr(r.reason);
    setBusy(null);
  }, []);

  useEffect(() => {
    refreshStats();
    refreshRepos();
  }, [refreshStats, refreshRepos]);

  useEffect(() => {
    if (section === 'patterns') refreshPatterns();
    if (section === 'megas') refreshMegas();
  }, [section, refreshPatterns, refreshMegas]);

  async function handleIngest() {
    setBusy('ingest'); setErr(null); setIngestResult(null);
    const input: Record<string, unknown> = { allowCopyleft: ingestAllowCopyleft };
    if (ingestLocal.trim()) input.localPath = ingestLocal.trim();
    if (ingestUrl.trim()) input.url = ingestUrl.trim();
    if (!input.localPath && !input.url) {
      setErr('Provide a local path or a URL');
      setBusy(null);
      return;
    }
    const r = await callMacro<{ ok: boolean; reason?: string; patternsExtracted?: number; dtusMinted?: number; sourceFileCount?: number; repository?: RepoRow }>('ingest_repo', input);
    if (r?.ok) {
      setIngestResult(`Ingested ${r.repository?.name ?? 'repo'} · ${r.sourceFileCount ?? 0} files · ${r.patternsExtracted ?? 0} patterns · ${r.dtusMinted ?? 0} DTUs minted`);
      setIngestUrl(''); setIngestLocal('');
      await refreshStats(); await refreshRepos();
    } else {
      setErr(r?.reason || 'ingest failed');
    }
    setBusy(null);
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117]">
      <header className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <DbIcon className="w-4 h-4 text-indigo-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Repo index</span>
        <span className="ml-auto text-[10px] text-gray-500">
          {stats ? `${stats.repositories ?? 0}r · ${stats.patterns ?? 0}p · ${stats.megas ?? 0}m` : '…'}
        </span>
        <button onClick={() => { refreshStats(); refreshRepos(); if (section === 'patterns') refreshPatterns(); if (section === 'megas') refreshMegas(); }} className="p-1 text-gray-400 hover:text-white">
          <RefreshCw className={cn('w-3.5 h-3.5', busy && 'animate-spin')} />
        </button>
      </header>

      {err && (
        <div className="m-2 px-2 py-1 text-[10px] text-red-300 bg-red-500/10 rounded flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {err}
          <button onClick={() => setErr(null)} className="ml-auto text-red-300 hover:text-white">×</button>
        </div>
      )}

      <div className="px-3 py-2 border-b border-white/10">
        <button
          onClick={() => setShowIngest((v) => !v)}
          className="w-full text-[10px] flex items-center gap-2 text-indigo-300 hover:text-indigo-200"
        >
          {showIngest ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <FolderInput className="w-3 h-3" /> Ingest a repo
        </button>
        {showIngest && (
          <div className="mt-2 space-y-1.5">
            <input
              type="text" value={ingestUrl}
              onChange={(e) => setIngestUrl(e.target.value)}
              placeholder="github.com/owner/repo (or owner/repo)"
              className="w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <input
              type="text" value={ingestLocal}
              onChange={(e) => setIngestLocal(e.target.value)}
              placeholder="local path (relative to CONCORD_CODE_WORKSPACE_ROOT)"
              className="w-full px-2 py-1 text-[10px] bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <label className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <input type="checkbox" checked={ingestAllowCopyleft} onChange={(e) => setIngestAllowCopyleft(e.target.checked)} className="accent-indigo-400" />
              allow copyleft license (GPL, AGPL)
            </label>
            <button
              onClick={handleIngest}
              disabled={busy !== null || (!ingestUrl.trim() && !ingestLocal.trim())}
              className="px-2 py-1 text-[10px] rounded bg-indigo-500 text-white font-bold hover:bg-indigo-400 disabled:opacity-50"
            >
              {busy === 'ingest' ? <Loader2 className="w-3 h-3 animate-spin inline" /> : 'Ingest'}
            </button>
            {ingestResult && <p className="text-[10px] text-emerald-300">{ingestResult}</p>}
          </div>
        )}
      </div>

      <div className="px-3 py-1 border-b border-white/10 flex gap-2">
        {(['repos', 'patterns', 'megas'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSection(tab)}
            className={cn(
              'text-[10px] px-2 py-1 rounded uppercase tracking-wider',
              section === tab ? 'bg-indigo-500/20 text-indigo-200' : 'text-gray-500 hover:text-white'
            )}
          >{tab}</button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {section === 'repos' && (
          <ul>
            {repos.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-gray-500">No repositories ingested.</li>
            ) : (
              repos.map((r) => (
                <li key={r.id} className="px-3 py-2 border-b border-white/5 text-xs">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-3 h-3 text-indigo-400" />
                    <span className="text-gray-200 font-medium truncate flex-1">{r.owner ?? '?'}/{r.name ?? '?'}</span>
                    <span className="text-[10px] text-gray-500">{r.language ?? '?'}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">
                    {r.pattern_count ?? 0} patterns · {r.status ?? 'unknown'}
                  </div>
                </li>
              ))
            )}
          </ul>
        )}

        {section === 'patterns' && (
          <>
            <div className="px-3 py-2 border-b border-white/10 grid grid-cols-3 gap-2">
              <select
                value={searchCategory} onChange={(e) => setSearchCategory(e.target.value)}
                className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
              >
                {CATEGORIES.map((c) => <option key={c} value={c}>{c || 'any category'}</option>)}
              </select>
              <input
                type="text" value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
                placeholder="name…"
                className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
              />
              <input
                type="number" value={searchMinCreti}
                onChange={(e) => setSearchMinCreti(e.target.value)}
                placeholder="min CRETI"
                className="text-[10px] bg-lattice-deep border border-lattice-border rounded px-1.5 py-1 text-white"
              />
            </div>
            <div className="px-3 py-1 border-b border-white/10 flex items-center">
              <button
                onClick={refreshPatterns}
                disabled={busy === 'patterns'}
                className="text-[10px] flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-200 hover:bg-indigo-500/30"
              >
                <Search className="w-3 h-3" /> search
              </button>
              <span className="ml-2 text-[10px] text-gray-500">{patterns.length} results</span>
            </div>
            <ul>
              {patterns.length === 0 ? (
                <li className="px-3 py-3 text-[10px] text-gray-500">No patterns. Ingest a repo first.</li>
              ) : (
                patterns.map((p) => (
                  <li key={p.id} className="px-3 py-2 border-b border-white/5 text-xs">
                    <div className="flex items-center gap-2">
                      <Hash className="w-3 h-3 text-indigo-400" />
                      <span className="text-gray-200 font-medium truncate flex-1">{p.name}</span>
                      <span className="text-[10px] text-indigo-300 font-mono">{(p._avgCreti ?? 0).toFixed(2)}</span>
                    </div>
                    {p.file_path && <div className="text-[10px] text-gray-500 mt-0.5 truncate">{p.file_path}</div>}
                    {p.description && <div className="text-[10px] text-gray-400 mt-0.5 line-clamp-2">{p.description}</div>}
                  </li>
                ))
              )}
            </ul>
          </>
        )}

        {section === 'megas' && (
          <ul>
            {megas.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-gray-500">No MEGAs yet.</li>
            ) : (
              megas.map((m) => (
                <li key={m.id} className="px-3 py-2 border-b border-white/5 text-xs">
                  <div className="flex items-center gap-2">
                    <DbIcon className="w-3 h-3 text-indigo-400" />
                    <span className="text-gray-200 font-medium truncate flex-1">{m.topic ?? '(no topic)'}</span>
                    <span className="text-[10px] text-indigo-300">{(m.avg_creti ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="text-[10px] text-gray-500 mt-0.5">compressed from {m.compressed_from_count ?? 0} patterns</div>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

export default RepoIndexPanel;
