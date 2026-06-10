'use client';

import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, Loader2, Table2, Trash2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface RefLite {
  id: string;
  title: string;
  authors: string | null;
  year: number | null;
  abstract: string | null;
}
interface ReviewRow {
  paperIndex: number;
  title: string;
  year: number | null;
  cells: Record<string, string>;
}
interface Review {
  id: string;
  title: string;
  dimensions: string[];
  paperCount: number;
  matrix: ReviewRow[];
  summary: string | null;
  mode: string;
  createdAt: string;
}
interface ReviewSummary {
  id: string;
  title: string;
  dimensions: string[];
  paperCount: number;
  mode: string;
  createdAt: string;
}

const DEFAULT_DIMS = ['method', 'finding', 'sample', 'limitation'];

/**
 * LiteratureReviewPanel — Elicit-style cross-paper finding extraction.
 * Picks references from the user's library and builds a comparison matrix
 * via research.literature-review. No fake data — all rows from real refs.
 */
export function LiteratureReviewPanel() {
  const [refs, setRefs] = useState<RefLite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dims, setDims] = useState<string[]>(DEFAULT_DIMS);
  const [dimInput, setDimInput] = useState('');
  const [title, setTitle] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [saved, setSaved] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRefs = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<{ references: RefLite[] }>('research', 'reference-list', {});
      if (r.data?.ok && r.data.result) setRefs(r.data.result.references || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSaved = useCallback(async () => {
    try {
      const r = await lensRun<{ reviews: ReviewSummary[] }>(
        'research',
        'literature-reviews-list',
        {},
      );
      if (r.data?.ok && r.data.result) setSaved(r.data.result.reviews || []);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    loadRefs();
    loadSaved();
  }, [loadRefs, loadSaved]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addDim = () => {
    const d = dimInput.trim().toLowerCase();
    if (d && !dims.includes(d) && dims.length < 8) setDims([...dims, d]);
    setDimInput('');
  };

  const build = useCallback(async () => {
    if (selected.size < 2) {
      setError('Select at least 2 references.');
      return;
    }
    setBuilding(true);
    setError(null);
    setReview(null);
    try {
      const r = await lensRun<{ review: Review }>('research', 'literature-review', {
        referenceIds: [...selected],
        dimensions: dims,
        title: title.trim() || undefined,
        save: true,
      });
      if (r.data?.ok && r.data.result) {
        setReview(r.data.result.review);
        await loadSaved();
      } else {
        setError(r.data?.error || 'Review failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed');
    } finally {
      setBuilding(false);
    }
  }, [selected, dims, title, loadSaved]);

  const openSaved = useCallback(async (id: string) => {
    try {
      const r = await lensRun<{ review: Review }>('research', 'literature-review-get', { id });
      if (r.data?.ok && r.data.result) setReview(r.data.result.review);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const deleteSaved = useCallback(
    async (id: string) => {
      try {
        await lensRun('research', 'literature-review-delete', { id });
        if (review?.id === id) setReview(null);
        await loadSaved();
      } catch (e) {
        console.error(e);
      }
    },
    [review, loadSaved],
  );

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-4 h-4 text-fuchsia-400" />
        <span className="text-sm font-semibold text-gray-200">Literature review</span>
      </div>

      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Review title (optional)"
        className="w-full px-2 py-1.5 text-sm bg-black/40 border border-white/10 rounded text-gray-100"
      />

      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Dimensions</p>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {dims.map((d) => (
            <span
              key={d}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-fuchsia-500/15 text-fuchsia-200"
            >
              {d}
              <button
                type="button"
                onClick={() => setDims(dims.filter((x) => x !== d))}
                className="text-fuchsia-300 hover:text-rose-300"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={dimInput}
            onChange={(e) => setDimInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addDim();
            }}
            placeholder="Add dimension"
            className="flex-1 px-2 py-1 text-xs bg-black/40 border border-white/10 rounded text-gray-100"
          />
          <button
            type="button"
            onClick={addDim}
            className="px-2 py-1 rounded border border-white/10 text-xs text-gray-300"
          >
            Add
          </button>
        </div>
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">
          References ({selected.size} selected)
        </p>
        {loading ? (
          <div className="text-center py-4 text-xs text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin inline" />
          </div>
        ) : refs.length === 0 ? (
          <p className="text-xs text-gray-400 py-3">
            No references yet. Add some via Academic Search or the library.
          </p>
        ) : (
          <div className="space-y-1 max-h-44 overflow-y-auto">
            {refs.map((r) => (
              <label
                key={r.id}
                className="flex items-start gap-2 rounded border border-white/10 bg-black/20 p-2 cursor-pointer hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  className="mt-0.5"
                />
                <div className="min-w-0">
                  <p className="text-xs text-gray-100 truncate">{r.title}</p>
                  <p className="text-[10px] text-gray-400">
                    {r.authors || 'Unknown'}
                    {r.year ? ` · ${r.year}` : ''}
                    {!r.abstract ? ' · no abstract' : ''}
                  </p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={build}
        disabled={building || selected.size < 2}
        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/15 text-xs text-fuchsia-100 disabled:opacity-40"
      >
        {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Table2 className="w-3.5 h-3.5" />}
        {building ? 'Synthesizing…' : 'Build comparison table'}
      </button>

      {error && (
        <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded p-2">
          {error}
        </p>
      )}

      {review && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-100">{review.title}</p>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
              {review.mode}
            </span>
          </div>
          {review.summary && (
            <p className="text-[11px] text-gray-400 italic border-l-2 border-fuchsia-500/40 pl-2">
              {review.summary}
            </p>
          )}
          <div className="overflow-x-auto rounded border border-white/10">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="bg-white/5">
                  <th className="text-left p-1.5 text-gray-400 font-medium">Paper</th>
                  {review.dimensions.map((d) => (
                    <th key={d} className="text-left p-1.5 text-gray-400 font-medium capitalize">
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {review.matrix.map((row) => (
                  <tr key={row.paperIndex} className="border-t border-white/5">
                    <td className="p-1.5 text-gray-200 align-top max-w-[140px]">
                      {row.title}
                      {row.year ? <span className="text-gray-400"> ({row.year})</span> : null}
                    </td>
                    {review.dimensions.map((d) => (
                      <td key={d} className="p-1.5 text-gray-400 align-top max-w-[180px]">
                        {row.cells[d]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="border-t border-white/10 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Saved reviews</p>
          <div className="space-y-1">
            {saved.map((rv) => (
              <div
                key={rv.id}
                className="flex items-center justify-between rounded border border-white/10 bg-black/20 p-2"
              >
                <button
                  type="button"
                  onClick={() => openSaved(rv.id)}
                  className="text-left min-w-0 flex-1"
                >
                  <p className="text-xs text-gray-200 truncate">{rv.title}</p>
                  <p className="text-[10px] text-gray-400">
                    {rv.paperCount} papers · {rv.dimensions.length} dimensions · {rv.mode}
                  </p>
                </button>
                <button
                  type="button"
                  aria-label="Delete saved review"
                  onClick={() => deleteSaved(rv.id)}
                  className="p-1 text-gray-600 hover:text-rose-300"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default LiteratureReviewPanel;
