'use client';

/**
 * ResearchLibraryPanel — the reference library with add, filters, and a
 * reference detail showing citations, annotations and related items.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, BookMarked, ChevronLeft, ChevronDown, Trash2, Copy, FileText, ExternalLink, Pencil, Link2, X, Tag, Highlighter, ScanSearch } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';

interface Reference {
  id: string; title: string; authors: string | null; year: number | null;
  type: string; journal: string | null; doi: string | null; tags: string[]; status: string;
}
interface Annotation { id: string; page: number | null; quote: string | null; text: string | null; color: string }
interface LibraryAnnotation extends Annotation { referenceId: string }
interface PdfAttachment { id: string; referenceId: string; url: string; filename: string; pages: number | null }
interface TagCount { tag: string; count: number }

const TYPES = ['article', 'book', 'chapter', 'conference', 'thesis', 'report', 'preprint', 'dataset'];
const STATUS_COLOR: Record<string, string> = {
  to_read: 'text-zinc-400', reading: 'text-amber-400', read: 'text-emerald-400',
};

/**
 * HighlightsSection — cross-library annotation browser. Was a real,
 * never-called macro (`research.annotation-list` with no referenceId
 * filter): the panel already showed a reference's own annotations inline
 * (via `reference-detail`), but there was no way to see everything you'd
 * highlighted across the whole library without opening each reference one
 * at a time. Wires the global `annotation-list` call to a collapsible
 * "My highlights" browser that jumps straight to the source reference.
 */
function HighlightsSection({ onOpenReference }: { onOpenReference: (ref: Reference) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<LibraryAnnotation[]>([]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      setLoading(true);
      const r = await lensRun<{ annotations: LibraryAnnotation[] }>('research', 'annotation-list', {});
      setItems(r.data?.result?.annotations || []);
      setLoading(false);
      setLoaded(true);
    }
  };

  const jump = async (referenceId: string) => {
    const r = await lensRun('research', 'reference-detail', { id: referenceId });
    const ref = r.data?.result?.reference as Reference | undefined;
    if (ref) await onOpenReference(ref);
  };

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button type="button" onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-300 bg-zinc-900/70 hover:bg-zinc-900 transition-colors">
        <span className="flex items-center gap-1.5">
          <Highlighter className="w-3.5 h-3.5 text-amber-400" /> My highlights{loaded && items.length > 0 ? ` (${items.length})` : ''}
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="p-2 space-y-1 max-h-64 overflow-y-auto bg-zinc-950/40">
          {loading ? (
            <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-zinc-500" /></div>
          ) : items.length === 0 ? (
            <p className="text-[11px] text-zinc-500 italic py-2 text-center">No annotations yet — open a reference and add one.</p>
          ) : (
            items.map((a) => (
              <button key={a.id} type="button" onClick={() => jump(a.referenceId)}
                className="w-full text-left text-[11px] border-l-2 border-amber-600/50 pl-2 py-1 hover:bg-zinc-800/40 rounded-r transition-colors">
                {a.quote && <p className="text-zinc-300 italic truncate">&ldquo;{a.quote}&rdquo;{a.page ? ` (p.${a.page})` : ''}</p>}
                {a.text && <p className="text-zinc-400 truncate">{a.text}</p>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface GapEntry { kind: string; count?: number; referenceIds?: string[]; year?: number; tags?: string[] }
interface GapResult { referenceCount: number; topic: string | null; gaps: GapEntry[]; byYear: Record<string, number> }
interface MatchEntry { referenceId: string; title: string; score: number; matchedTokens: string[] }
interface MatchResult { question: string; matchCount: number; matches: MatchEntry[] }
interface EvalResult { referenceId: string; title: string; credibility: string; signals: string[]; status: string }

const SIGNAL_LABEL: Record<string, string> = {
  has_doi: 'DOI', has_venue: 'Venue', has_year: 'Year', has_abstract: 'Abstract', has_authors: 'Authors',
};
const CREDIBILITY_COLOR: Record<string, string> = {
  high: 'text-emerald-400 border-emerald-700/60', moderate: 'text-amber-400 border-amber-700/60', low: 'text-red-400 border-red-800/60',
};

function gapText(g: GapEntry): string {
  if (g.kind === 'missing_abstract') return `${g.count ?? 0} reference${g.count === 1 ? '' : 's'} missing an abstract`;
  if (g.kind === 'year_gap') return `No references from ${g.year}`;
  if (g.kind === 'singleton_tags') return `Tags used only once: ${(g.tags || []).join(', ')}`;
  return g.kind;
}

/**
 * AnalyzeLibrarySection — the "Analyze library" tools. Three real backend
 * actions (`research.find-gaps`, `research.match-questions`,
 * `research.evaluate-source`) had no frontend surface anywhere — the
 * library could be browsed and cited but never analyzed. This section
 * wires all three against the caller's own library: coverage gaps
 * (missing abstracts, year gaps, singleton tags), question→reference
 * matching, and a per-source credibility readout from the metadata
 * signals the backend actually checks. Errors surface as-is (an empty
 * library gets the backend's "references required", not a fake result).
 */
export function AnalyzeLibrarySection({ references, onOpenReference }: {
  references: Reference[];
  onOpenReference: (ref: Reference) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState('');
  const [gapResult, setGapResult] = useState<GapResult | null>(null);
  const [gapError, setGapError] = useState<string | null>(null);
  const [gapLoading, setGapLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [evalId, setEvalId] = useState('');
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);

  const runGaps = async () => {
    setGapLoading(true); setGapError(null);
    const params: Record<string, string> = {};
    if (topic.trim()) params.topic = topic.trim();
    const r = await lensRun<GapResult>('research', 'find-gaps', params);
    if (r.data?.ok === false) { setGapError(r.data.error || 'Gap analysis failed.'); setGapResult(null); }
    else setGapResult((r.data?.result as GapResult) || null);
    setGapLoading(false);
  };

  const runMatch = async () => {
    if (!question.trim()) return;
    setMatchLoading(true); setMatchError(null);
    const r = await lensRun<MatchResult>('research', 'match-questions', { question: question.trim() });
    if (r.data?.ok === false) { setMatchError(r.data.error || 'Matching failed.'); setMatchResult(null); }
    else setMatchResult((r.data?.result as MatchResult) || null);
    setMatchLoading(false);
  };

  const runEval = async () => {
    if (!evalId) return;
    setEvalLoading(true); setEvalError(null);
    const r = await lensRun<EvalResult>('research', 'evaluate-source', { id: evalId });
    if (r.data?.ok === false) { setEvalError(r.data.error || 'Evaluation failed.'); setEvalResult(null); }
    else setEvalResult((r.data?.result as EvalResult) || null);
    setEvalLoading(false);
  };

  const jump = async (referenceId: string) => {
    const r = await lensRun('research', 'reference-detail', { id: referenceId });
    const ref = r.data?.result?.reference as Reference | undefined;
    if (ref) await onOpenReference(ref);
  };

  const inputCls = 'flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100';
  const btnCls = 'px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-100 rounded-lg disabled:opacity-50';

  return (
    <div className="border border-zinc-800 rounded-xl overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-zinc-300 bg-zinc-900/70 hover:bg-zinc-900 transition-colors">
        <span className="flex items-center gap-1.5">
          <ScanSearch className="w-3.5 h-3.5 text-sky-400" /> Analyze library
        </span>
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="p-3 space-y-4 bg-zinc-950/40">
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-zinc-300">Coverage gaps</p>
            <div className="flex gap-2">
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional)"
                className={inputCls} />
              <button type="button" onClick={runGaps} disabled={gapLoading} className={btnCls}>
                {gapLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Find gaps'}
              </button>
            </div>
            {gapError && <p className="text-[11px] text-red-400">{gapError}</p>}
            {gapResult && (
              gapResult.gaps.length === 0 ? (
                <p className="text-[11px] text-zinc-400">No gaps found across {gapResult.referenceCount} references.</p>
              ) : (
                <ul className="space-y-0.5">
                  {gapResult.gaps.map((g, i) => (
                    <li key={`${g.kind}-${g.year ?? i}`} className="text-[11px] text-zinc-300 border-l-2 border-sky-700/60 pl-2 py-0.5">{gapText(g)}</li>
                  ))}
                </ul>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-zinc-300">Match a question to your sources</p>
            <div className="flex gap-2">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="What are you trying to answer?"
                className={inputCls} />
              <button type="button" onClick={runMatch} disabled={matchLoading || !question.trim()} className={btnCls}>
                {matchLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Match'}
              </button>
            </div>
            {matchError && <p className="text-[11px] text-red-400">{matchError}</p>}
            {matchResult && (
              matchResult.matches.length === 0 ? (
                <p className="text-[11px] text-zinc-400">No references matched that question.</p>
              ) : (
                <div className="space-y-1">
                  {matchResult.matches.map((m) => (
                    <button key={m.referenceId} type="button" onClick={() => jump(m.referenceId)}
                      className="w-full text-left text-[11px] border-l-2 border-sky-700/60 pl-2 py-1 hover:bg-zinc-800/40 rounded-r transition-colors">
                      <span className="text-zinc-200">{m.title}</span>
                      <span className="text-zinc-500"> — matched: {m.matchedTokens.join(', ')}</span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-zinc-300">Evaluate a source</p>
            <div className="flex gap-2">
              <select value={evalId} onChange={(e) => setEvalId(e.target.value)} className={inputCls}>
                <option value="">Choose a reference…</option>
                {references.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
              <button type="button" onClick={runEval} disabled={evalLoading || !evalId} className={btnCls}>
                {evalLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Evaluate'}
              </button>
            </div>
            {references.length === 0 && <p className="text-[11px] text-zinc-500 italic">Add references to evaluate them.</p>}
            {evalError && <p className="text-[11px] text-red-400">{evalError}</p>}
            {evalResult && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn('text-[11px] px-1.5 py-0.5 rounded border capitalize', CREDIBILITY_COLOR[evalResult.credibility] || 'text-zinc-300 border-zinc-700')}>
                  {evalResult.credibility} credibility
                </span>
                {evalResult.signals.map((s) => (
                  <span key={s} className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400">{SIGNAL_LABEL[s] || s}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ResearchLibraryPanel({ onChange }: { onChange: () => void }) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', authors: '', year: '', type: 'article', journal: '', doi: '', tags: '' });
  const [selected, setSelected] = useState<Reference | null>(null);
  const [citations, setCitations] = useState<{ apa: string; mla: string; bibtex: string; chicago?: string } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annForm, setAnnForm] = useState({ page: '', quote: '', text: '' });
  const [pdfs, setPdfs] = useState<PdfAttachment[]>([]);
  const [pdfForm, setPdfForm] = useState({ url: '', filename: '', pages: '' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', authors: '', year: '', journal: '', doi: '', tags: '' });
  const [related, setRelated] = useState<Reference[]>([]);
  const [relateQuery, setRelateQuery] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (query.trim()) params.query = query.trim();
    if (activeTag) params.tag = activeTag;
    const r = await lensRun('research', 'reference-list', params);
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load the library.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setReferences(r.data?.result?.references || []);
    setLoading(false);
  }, [query, activeTag]);

  const refreshTags = useCallback(async () => {
    const r = await lensRun<{ tags: TagCount[] }>('research', 'tag-list', {});
    setTags(r.data?.result?.tags || []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshTags(); }, [refreshTags]);

  const loadRelated = useCallback(async (refId: string) => {
    const r = await lensRun<{ related: Reference[] }>('research', 'reference-related', { id: refId });
    setRelated(r.data?.result?.related || []);
  }, []);

  const openRef = useCallback(async (ref: Reference) => {
    setSelected(ref);
    setEditing(false);
    const r = await lensRun('research', 'reference-detail', { id: ref.id });
    if (r.data?.ok === false) {
      setError(r.data?.error || 'Could not load this reference.');
      return;
    }
    setError(null);
    const baseCitations = r.data?.result?.citations || null;
    setCitations(baseCitations);
    setAnnotations(r.data?.result?.annotations || []);
    const p = await lensRun<{ pdfs: PdfAttachment[] }>('research', 'reference-pdfs', { referenceId: ref.id });
    setPdfs(p.data?.result?.pdfs || []);
    await loadRelated(ref.id);
    // reference-detail only returns apa/mla/bibtex — fetch chicago via cite-format
    // so all four citation styles this domain supports are actually reachable.
    const chi = await lensRun<{ citation: string }>('research', 'cite-format', { id: ref.id, style: 'chicago' });
    if (chi.data?.ok !== false) {
      setCitations((prev) => (prev ? { ...prev, chicago: chi.data?.result?.citation } : prev));
    }
  }, [loadRelated]);

  const startEdit = () => {
    if (!selected) return;
    setEditForm({
      title: selected.title, authors: selected.authors || '', year: selected.year ? String(selected.year) : '',
      journal: selected.journal || '', doi: selected.doi || '', tags: selected.tags.join(', '),
    });
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!selected) return;
    if (!editForm.title.trim()) { setError('Title is required.'); return; }
    const r = await lensRun('research', 'reference-update', {
      id: selected.id, title: editForm.title.trim(), authors: editForm.authors.trim(),
      year: editForm.year ? Number(editForm.year) : null, journal: editForm.journal.trim(), doi: editForm.doi.trim(),
      tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to update'); return; }
    const updated = r.data?.result?.reference as Reference | undefined;
    if (updated) setSelected(updated);
    setEditing(false); setError(null);
    await refresh(); await refreshTags(); onChange();
  };

  const linkRelated = async () => {
    if (!selected || !relateQuery) return;
    const r = await lensRun('research', 'reference-relate', { referenceId: selected.id, relatedId: relateQuery });
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not link'); return; }
    setRelateQuery(''); setError(null);
    await loadRelated(selected.id);
  };

  const unlinkRelated = async (relatedId: string) => {
    if (!selected) return;
    await lensRun('research', 'reference-relate', { referenceId: selected.id, relatedId, unrelate: true });
    await loadRelated(selected.id);
  };

  const attachPdf = async () => {
    if (!selected) return;
    if (!pdfForm.url.trim()) { setError('Provide a PDF URL.'); return; }
    const r = await lensRun('research', 'reference-attach-pdf', {
      referenceId: selected.id, url: pdfForm.url.trim(),
      filename: pdfForm.filename.trim() || undefined,
      pages: pdfForm.pages ? Number(pdfForm.pages) : undefined,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed to attach PDF'); return; }
    setPdfForm({ url: '', filename: '', pages: '' });
    setError(null);
    await openRef(selected);
  };

  const deletePdf = async (id: string) => {
    if (!selected) return;
    await lensRun('research', 'reference-pdf-delete', { id });
    await openRef(selected);
  };

  const add = async () => {
    if (!form.title.trim()) { setError('Title is required.'); return; }
    const r = await lensRun('research', 'reference-add', {
      title: form.title.trim(), authors: form.authors.trim(),
      year: form.year ? Number(form.year) : undefined, type: form.type,
      journal: form.journal.trim(), doi: form.doi.trim(),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setForm({ title: '', authors: '', year: '', type: 'article', journal: '', doi: '', tags: '' });
    setShowAdd(false); setError(null);
    await refresh(); await refreshTags(); onChange();
  };
  const del = async (id: string) => { await lensRun('research', 'reference-delete', { id }); await refresh(); await refreshTags(); onChange(); };
  const setStatus = async (ref: Reference, status: string) => {
    await lensRun('research', 'reference-set-status', { id: ref.id, status });
    await refresh(); onChange();
    if (selected?.id === ref.id) setSelected({ ...ref, status });
  };
  const addAnnotation = async () => {
    if (!selected) return;
    if (!annForm.quote.trim() && !annForm.text.trim()) { setError('Add a quote or note.'); return; }
    await lensRun('research', 'annotation-add', {
      referenceId: selected.id, page: annForm.page ? Number(annForm.page) : undefined,
      quote: annForm.quote.trim(), text: annForm.text.trim(),
    });
    setAnnForm({ page: '', quote: '', text: '' });
    setError(null);
    await openRef(selected); onChange();
  };
  const copy = (text: string) => { try { navigator.clipboard?.writeText(text); } catch { /* ignore */ } };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  // ── Reference detail ──
  if (selected) {
    return (
      <div className="space-y-3">
        <button type="button" onClick={() => setSelected(null)}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> Library
        </button>
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-4">
          {editing ? (
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Title" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Authors" value={editForm.authors} onChange={(e) => setEditForm({ ...editForm, authors: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Year" inputMode="numeric" value={editForm.year} onChange={(e) => setEditForm({ ...editForm, year: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Journal" value={editForm.journal} onChange={(e) => setEditForm({ ...editForm, journal: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="DOI" value={editForm.doi} onChange={(e) => setEditForm({ ...editForm, doi: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Tags (comma-separated)" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <div className="col-span-2 flex gap-2">
                <button type="button" onClick={saveEdit}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Save changes</button>
                <button type="button" onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-xs rounded-lg border border-zinc-700 text-zinc-400 hover:text-zinc-200">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-bold text-zinc-100">{selected.title}</h3>
                <button type="button" onClick={startEdit} aria-label="Edit reference"
                  className="shrink-0 flex items-center gap-1 text-[10px] text-zinc-400 hover:text-red-300 border border-zinc-700 rounded px-1.5 py-0.5">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
              </div>
              <p className="text-xs text-zinc-400">
                {selected.authors || 'Unknown'}{selected.year ? ` · ${selected.year}` : ''}
                {selected.journal ? ` · ${selected.journal}` : ''} · {selected.type}
              </p>
              <div className="flex gap-1 mt-2">
                {['to_read', 'reading', 'read'].map((st) => (
                  <button key={st} type="button" onClick={() => setStatus(selected, st)}
                    className={cn('text-[10px] px-2 py-0.5 rounded border capitalize',
                      selected.status === st ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400')}>
                    {st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {citations && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
            <h4 className="text-xs font-semibold text-zinc-300">Citations</h4>
            {(['apa', 'mla', 'chicago', 'bibtex'] as const).filter((style) => citations[style]).map((style) => (
              <div key={style} className="flex items-start gap-2">
                <span className="text-[10px] uppercase text-zinc-400 w-12 shrink-0 pt-0.5">{style}</span>
                <code className="flex-1 text-[10px] text-zinc-400 break-all whitespace-pre-wrap">{citations[style]}</code>
                <button type="button" onClick={() => copy(citations[style] as string)} aria-label={`Copy ${style} citation`} className="text-zinc-600 hover:text-zinc-300 shrink-0">
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">PDF attachments</h4>
          <div className="grid grid-cols-6 gap-2 mb-2">
            <input placeholder="PDF URL (https://…)" value={pdfForm.url} onChange={(e) => setPdfForm({ ...pdfForm, url: e.target.value })}
              className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Filename" value={pdfForm.filename} onChange={(e) => setPdfForm({ ...pdfForm, filename: e.target.value })}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Pages" inputMode="numeric" value={pdfForm.pages} onChange={(e) => setPdfForm({ ...pdfForm, pages: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={attachPdf}
              className="col-span-6 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Attach PDF</button>
          </div>
          {pdfs.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No PDFs attached.</p>
          ) : (
            <ul className="space-y-1">
              {pdfs.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-[11px] bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1.5">
                  <a href={p.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-zinc-300 hover:text-red-300 min-w-0">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{p.filename}</span>
                    {p.pages ? <span className="text-zinc-600">· {p.pages}p</span> : null}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                  <button type="button" onClick={() => deletePdf(p.id)} aria-label="Delete PDF" className="text-zinc-600 hover:text-rose-400 shrink-0">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Annotations</h4>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-2">
            <input placeholder="Page" inputMode="numeric" value={annForm.page} onChange={(e) => setAnnForm({ ...annForm, page: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Quote" value={annForm.quote} onChange={(e) => setAnnForm({ ...annForm, quote: e.target.value })}
              className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Your note" value={annForm.text} onChange={(e) => setAnnForm({ ...annForm, text: e.target.value })}
              className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={addAnnotation}
              className="bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg">Add</button>
          </div>
          {annotations.length > 0 && (
            <ul className="space-y-1">
              {annotations.map((a) => (
                <li key={a.id} className="text-[11px] border-l-2 border-amber-600/50 pl-2">
                  {a.quote && <p className="text-zinc-300 italic">&ldquo;{a.quote}&rdquo;{a.page ? ` (p.${a.page})` : ''}</p>}
                  {a.text && <p className="text-zinc-400">{a.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1"><Link2 className="w-3.5 h-3.5" /> Related references</h4>
          <div className="flex gap-2 mb-2">
            <select value={relateQuery} onChange={(e) => setRelateQuery(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="">Link a reference…</option>
              {references.filter((r) => r.id !== selected.id && !related.some((x) => x.id === r.id)).map((r) => (
                <option key={r.id} value={r.id}>{r.title}</option>
              ))}
            </select>
            <button type="button" onClick={linkRelated} disabled={!relateQuery}
              className="px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg">Link</button>
          </div>
          {related.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No related references linked yet.</p>
          ) : (
            <ul className="space-y-1">
              {related.map((r) => (
                <li key={r.id} className="flex items-center justify-between text-[11px] bg-zinc-950/60 border border-zinc-800 rounded-lg px-2 py-1.5">
                  <button type="button" onClick={() => openRef(r)} className="text-left text-zinc-300 hover:text-red-300 truncate flex-1">{r.title}</button>
                  <button type="button" onClick={() => unlinkRelated(r.id)} aria-label="Unlink reference" className="text-zinc-600 hover:text-rose-400 shrink-0">
                    <X className="w-3 h-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  if (loadError) {
    return <div className="p-4"><ErrorState message={loadError} onRetry={refresh} /></div>;
  }

  // ── Library list ──
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, author, journal…"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      <HighlightsSection onOpenReference={openRef} />

      <AnalyzeLibrarySection references={references} onOpenReference={openRef} />

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Tag className="w-3 h-3 text-zinc-500" />
          {tags.slice(0, 20).map((t) => (
            <button key={t.tag} type="button"
              onClick={() => setActiveTag((cur) => (cur === t.tag ? null : t.tag))}
              className={cn('text-[10px] px-1.5 py-0.5 rounded border',
                activeTag === t.tag ? 'border-red-700/50 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400 hover:text-zinc-200')}>
              {t.tag} <span className="text-zinc-600">{t.count}</span>
            </button>
          ))}
          {activeTag && (
            <button type="button" onClick={() => setActiveTag(null)} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline">clear</button>
          )}
        </div>
      )}

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="grid grid-cols-2 gap-2 bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <input placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Authors" value={form.authors} onChange={(e) => setForm({ ...form, authors: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Year" inputMode="numeric" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input placeholder="Journal" value={form.journal} onChange={(e) => setForm({ ...form, journal: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="DOI" value={form.doi} onChange={(e) => setForm({ ...form, doi: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Tags (comma-separated)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={add}
            className="col-span-2 bg-red-600 hover:bg-red-500 text-white text-xs font-medium rounded-lg px-2 py-1.5">Add reference</button>
        </div>
      )}

      {references.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No references. Add papers and books to build your library.
        </div>
      ) : (
        <ul className="space-y-2">
          {references.map((r) => (
            <li key={r.id} className="flex items-start justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openRef(r)} className="text-left flex items-start gap-2 min-w-0">
                <BookMarked className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">{r.title}</p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {r.authors || 'Unknown'}{r.year ? ` · ${r.year}` : ''}{r.journal ? ` · ${r.journal}` : ''}
                  </p>
                  {r.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {r.tags.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('text-[10px] uppercase', STATUS_COLOR[r.status])}>{r.status.replace(/_/g, ' ')}</span>
                <button type="button" onClick={() => del(r.id)} aria-label="Delete reference" className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
