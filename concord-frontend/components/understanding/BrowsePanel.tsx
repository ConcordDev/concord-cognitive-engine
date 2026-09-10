'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, Loader2, RefreshCw, X, ChevronRight } from 'lucide-react';
import {
  understandingMacro,
  type SubjectKind,
  type Understanding,
} from './understanding-shared';

export function BrowsePanel({ subjectKinds }: { subjectKinds: SubjectKind[] }) {
  const [rows, setRows] = useState<Understanding[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filterKind, setFilterKind] = useState<SubjectKind | 'all'>('all');
  const [detail, setDetail] = useState<Understanding | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // engine_list (not the bare "list") — the notes-substrate LENS_ACTION
      // shadows "list" for /api/lens/run; engine_list reaches the real
      // understanding-engine list this Browse tab is built around.
      const r = await understandingMacro<{ ok: boolean; rows?: Understanding[] }>('engine_list',
        filterKind === 'all' ? {} : { subjectKind: filterKind }
      );
      setRows(r.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'load failed');
    } finally {
      setLoading(false);
    }
  }, [filterKind]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      String(r.id).toLowerCase().includes(q) ||
      String(r.subjectId ?? '').toLowerCase().includes(q) ||
      String(r.text ?? '').toLowerCase().includes(q)
    );
  }, [rows, search]);

  async function recompose(id: string) {
    try {
      await understandingMacro('recompose', { id });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'recompose failed');
    }
  }

  return (
    <section>
      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-md px-3 py-1.5 flex-1">
          <Search className="w-3.5 h-3.5 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search understandings…"
            className="bg-transparent outline-none text-sm flex-1 placeholder:text-white/30"
          />
          {search && (
            <button onClick={() => setSearch('')} className="text-white/40 hover:text-white" aria-label="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as SubjectKind | 'all')}
          className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm outline-none"
        >
          <option value="all">All kinds</option>
          {subjectKinds.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-white/60"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <p className="text-white/50 text-sm">
          {rows.length === 0 ? 'No understandings yet. Compose one to get started.' : 'No matches.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {filtered.map((u) => (
            <li
              key={u.id}
              className="bg-white/5 border border-white/10 rounded-lg p-3 flex items-start justify-between gap-3 hover:bg-white/10 transition cursor-pointer"
              onClick={() => setDetail(u)}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {u.subjectKind && (
                    <span className="text-[10px] uppercase tracking-wide text-violet-300 bg-violet-500/10 border border-violet-500/30 rounded px-1.5 py-0.5">
                      {u.subjectKind}
                    </span>
                  )}
                  {u.composer && (
                    <span className="text-[10px] text-white/40">composer: {u.composer}</span>
                  )}
                </div>
                <p className="text-sm font-mono mt-1 truncate">{u.id}</p>
                {u.subjectId && (
                  <p className="text-xs text-white/50 truncate">subject: {u.subjectId}</p>
                )}
                <div className="flex gap-3 mt-1 text-[11px] text-white/40">
                  {u.consistency != null && (
                    <span>consistency: <span className="text-white/70">{Number(u.consistency).toFixed(2)}</span></span>
                  )}
                  {u.confidence != null && (
                    <span>confidence: <span className="text-white/70">{Number(u.confidence).toFixed(2)}</span></span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={(e) => { e.stopPropagation(); recompose(u.id); }}
                  className="px-2 py-1 text-[11px] bg-violet-500/20 border border-violet-500/40 rounded text-violet-200 hover:bg-violet-500/30 inline-flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Recompose
                </button>
                <ChevronRight className="w-4 h-4 text-white/30" />
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail && <UnderstandingDetailModal u={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}

function UnderstandingDetailModal({
  u, onClose,
}: { u: Understanding; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="bg-black/95 border border-violet-500/30 rounded-2xl p-5 w-full max-w-xl max-h-[85vh] overflow-y-auto text-white"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold">Understanding</h3>
          <button onClick={onClose} className="text-white/50 hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-[11px] font-mono text-white/40 break-all mb-3">{u.id}</p>
        {u.subjectId && (
          <div className="text-xs mb-2">
            <span className="text-white/40">subject:</span> <span className="font-mono">{u.subjectId}</span>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
          {u.subjectKind && <div><span className="text-white/40">kind:</span> {u.subjectKind}</div>}
          {u.composer && <div><span className="text-white/40">composer:</span> {u.composer}</div>}
          {u.consistency != null && <div><span className="text-white/40">consistency:</span> {Number(u.consistency).toFixed(3)}</div>}
          {u.confidence != null && <div><span className="text-white/40">confidence:</span> {Number(u.confidence).toFixed(3)}</div>}
          {u.composedAt && <div><span className="text-white/40">composed:</span> {String(u.composedAt)}</div>}
          {u.expiresAt && <div><span className="text-white/40">expires:</span> {String(u.expiresAt)}</div>}
        </div>
        {u.text && (
          <div className="border-t border-white/10 pt-3 mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Text</p>
            <pre className="text-xs whitespace-pre-wrap text-white/80">{u.text}</pre>
          </div>
        )}
        {Array.isArray(u.claims) && u.claims.length > 0 && (
          <div className="border-t border-white/10 pt-3 mt-3">
            <p className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Claims ({u.claims.length})</p>
            <ul className="text-xs text-white/70 space-y-1 list-disc pl-4">
              {u.claims.slice(0, 8).map((c, i) => (
                <li key={i} className="break-words">{typeof c === 'string' ? c : JSON.stringify(c)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
