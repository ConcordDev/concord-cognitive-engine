'use client';

/**
 * ResearchLibraryPanel — the reference library with add, filters, and a
 * reference detail showing citations, annotations and related items.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, BookMarked, BookOpen, ChevronLeft, ChevronDown, Trash2, Copy, FileText, ExternalLink, Pencil, Link2, X, Tag, Highlighter, Upload, BarChart3 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui';
import { ResearchPdfReader } from './ResearchPdfReader';

interface Reference {
  id: string; title: string; authors: string | null; year: number | null;
  type: string; journal: string | null; doi: string | null; tags: string[]; status: string;
  source?: string | null;
}

const SOURCE_LABEL: Record<string, string> = { crossref: 'Crossref', openalex: 'OpenAlex', arxiv: 'arXiv' };
const sourceLabel = (s: string) => SOURCE_LABEL[s] || s;
interface Annotation {
  id: string; page: number | null; quote: string | null; text: string | null; color: string;
  // S4: reader-created annotations carry a structured anchor (page +
  // passage offsets; offsets null until the platform has a PDF text layer).
  anchor?: { page: number | null; startOffset: number | null; endOffset: number | null } | null;
}
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

interface AnalysisItemRead { id: string; title: string; year: number | null }
interface AnalysisEvaluation {
  referenceId: string; title: string; credibility?: string; signals?: string[]; status?: string; error?: string;
}
interface AnalysisGapEntry {
  kind: string; count?: number; references?: { id: string; title: string }[]; year?: number; tags?: string[];
}
interface AnalysisResult {
  question: string | null;
  itemsRead: AnalysisItemRead[];
  evaluations: AnalysisEvaluation[];
  gaps: { referenceCount: number; gaps: AnalysisGapEntry[]; byYear: Record<string, number> } | null;
  matches: {
    question: string; matchCount: number;
    matches: { referenceId: string; title: string; score: number; matchedTokens: string[] }[];
  } | null;
}
interface AnalysisJob {
  id: string; status: string; question: string | null; itemCount: number;
  createdAt: string; completedAt?: string | null;
  result?: AnalysisResult | null; error?: string | null;
}

const CREDIBILITY_COLOR: Record<string, string> = {
  high: 'text-emerald-300 border-emerald-800/60 bg-emerald-950/30',
  moderate: 'text-amber-300 border-amber-800/60 bg-amber-950/30',
  low: 'text-rose-300 border-rose-800/60 bg-rose-950/30',
};

/**
 * AnalyzeLibrarySection — S5 (F3): the library-level "Analyze library"
 * surface. Starts the research.analyze-library background job (source
 * evaluation + gap detection + question matching over the user's own
 * references), polls analysis-get while it runs, and renders what the
 * job produced. Per §7 S5 every output names the items it read: the
 * read list, per-reference evaluations, gap entries and matches all
 * carry titles. On revisit the latest completed run is restored from
 * analysis-list so the surface is not blank. An empty library gets the
 * macro's honest no_references refusal, never a template.
 */
function AnalyzeLibrarySection() {
  const [question, setQuestion] = useState('');
  const [job, setJob] = useState<AnalysisJob | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => () => { if (pollRef.current) window.clearTimeout(pollRef.current); }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await lensRun<{ analyses: AnalysisJob[] }>('research', 'analysis-list', {});
        const latest = (r.data?.result?.analyses || []).find((a) => a.status === 'complete');
        if (!latest || cancelled) return;
        const g = await lensRun<{ job: AnalysisJob }>('research', 'analysis-get', { id: latest.id });
        if (!cancelled && g.data?.result?.job) setJob(g.data.result.job);
      } catch { /* restoring the last run is best-effort */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const poll = useCallback(async (id: string, tries: number) => {
    try {
      const g = await lensRun<{ job: AnalysisJob }>('research', 'analysis-get', { id });
      const j = g.data?.result?.job;
      if (j) setJob(j);
      if (j && j.status === 'running' && tries > 0) {
        pollRef.current = window.setTimeout(() => { void poll(id, tries - 1); }, 1200);
        return;
      }
      setRunning(false);
    } catch {
      if (tries > 0) {
        pollRef.current = window.setTimeout(() => { void poll(id, tries - 1); }, 1200);
      } else {
        setRunning(false);
      }
    }
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setRunning(true);
    try {
      const r = await lensRun<{ job: AnalysisJob }>('research', 'analyze-library', { question: question.trim() });
      if (r.data?.ok === false) {
        setRunning(false);
        setError(r.data?.reason === 'no_references'
          ? 'Your library is empty — add references first; there is nothing to analyse yet.'
          : (r.data?.error || 'Analysis could not be started.'));
        return;
      }
      const j = r.data?.result?.job;
      if (j) {
        setJob(j);
        void poll(j.id, 40);
      } else {
        setRunning(false);
      }
    } catch {
      setRunning(false);
      setError('Analysis could not be started.');
    }
  }, [question, poll]);

  const result = job?.status === 'complete' ? job.result : null;

  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
      <div className="flex items-center gap-1.5">
        <BarChart3 className="w-3.5 h-3.5 text-red-400" />
        <h4 className="text-xs font-semibold text-zinc-200">Analyze library</h4>
      </div>
      <p className="text-[11px] text-zinc-400">
        Runs source evaluation, gap detection and question matching over your references as a
        background job. Every result names the items it read.
      </p>
      <div className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !running) void run(); }}
          placeholder="Optional: a research question to match against your library"
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        <button type="button" onClick={() => void run()} disabled={running}
          className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white rounded-lg">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {running ? 'Analyzing…' : 'Analyze library'}
        </button>
      </div>
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      {job?.status === 'running' && (
        <p className="text-[11px] text-zinc-400 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          Analyzing your library — reading {job.itemCount} reference{job.itemCount === 1 ? '' : 's'}…
        </p>
      )}
      {job?.status === 'failed' && (
        <p className="text-[11px] text-rose-300">That analysis run failed{job.error ? `: ${job.error}` : '.'}</p>
      )}
      {result && (
        <div className="space-y-3 pt-1">
          <div>
            <p className="text-[11px] text-zinc-400">
              Read {result.itemsRead.length} reference{result.itemsRead.length === 1 ? '' : 's'}
              {result.question ? <> for &ldquo;{result.question}&rdquo;</> : ''}
              {job?.completedAt ? <> · {new Date(job.completedAt).toLocaleString()}</> : ''}:
            </p>
            <ul className="mt-1 space-y-0.5">
              {result.itemsRead.map((i) => (
                <li key={i.id} className="text-[11px] text-zinc-300 truncate">
                  • {i.title}{i.year ? <span className="text-zinc-500"> ({i.year})</span> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-300 mb-1">Source evaluations</p>
            <ul className="space-y-1">
              {result.evaluations.map((e) => (
                <li key={e.referenceId} className="flex items-center gap-2 text-[11px]">
                  <span className="text-zinc-300 truncate flex-1">{e.title}</span>
                  {e.error ? (
                    <span className="text-rose-300 shrink-0">{e.error}</span>
                  ) : (
                    <span className={cn('px-1.5 py-0.5 rounded border shrink-0', CREDIBILITY_COLOR[e.credibility || ''] || 'text-zinc-300 border-zinc-700')}>
                      {e.credibility} · {(e.signals || []).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-300 mb-1">Gaps</p>
            {!result.gaps ? (
              <p className="text-[11px] text-zinc-500 italic">Gap detection returned nothing for this run.</p>
            ) : result.gaps.gaps.length === 0 ? (
              <p className="text-[11px] text-zinc-400">
                No gaps found — every reference carries an abstract, coverage is continuous, and no tag is used only once.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {result.gaps.gaps.map((g, i) => (
                  <li key={`${g.kind}-${i}`} className="text-[11px] text-zinc-300">
                    {g.kind === 'missing_abstract' && (
                      <>Missing an abstract: {(g.references || []).map((r) => r.title).join('; ') || `${g.count ?? 0} reference(s)`}</>
                    )}
                    {g.kind === 'year_gap' && <>No references from {g.year} — a hole in the timeline.</>}
                    {g.kind === 'singleton_tags' && <>Tags used only once: {(g.tags || []).join(', ')}</>}
                    {g.kind !== 'missing_abstract' && g.kind !== 'year_gap' && g.kind !== 'singleton_tags' && <>{g.kind}</>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="text-[11px] font-semibold text-zinc-300 mb-1">Question matches</p>
            {!result.question ? (
              <p className="text-[11px] text-zinc-500 italic">
                No question was given for this run — add one above to match it against your library.
              </p>
            ) : !result.matches || result.matches.matchCount === 0 ? (
              <p className="text-[11px] text-zinc-400">No references mention that question&rsquo;s terms.</p>
            ) : (
              <ul className="space-y-0.5">
                {result.matches.matches.map((m) => (
                  <li key={m.referenceId} className="text-[11px] text-zinc-300 truncate">
                    • {m.title} <span className="text-zinc-500">— matched: {m.matchedTokens.join(', ')}</span>
                  </li>
                ))}
              </ul>
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
  const [identifier, setIdentifier] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [duplicateNote, setDuplicateNote] = useState<Reference | null>(null);
  const hasLoadedRef = useRef(false);
  const [selected, setSelected] = useState<Reference | null>(null);
  const [citations, setCitations] = useState<{ apa: string; mla: string; bibtex: string; chicago?: string; vancouver?: string } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annForm, setAnnForm] = useState({ page: '', quote: '', text: '' });
  const [pdfs, setPdfs] = useState<PdfAttachment[]>([]);
  const [pdfForm, setPdfForm] = useState({ url: '', filename: '', pages: '' });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', authors: '', year: '', journal: '', doi: '', tags: '' });
  const [related, setRelated] = useState<Reference[]>([]);
  const [relateQuery, setRelateQuery] = useState('');
  // S4 (F2): the in-app reader replaces the detail view while open.
  // pdfUrl/source are set when opened from a specific attachment; left
  // unset when opened via server-side resolution (reference-pdf).
  const [reader, setReader] = useState<{ page?: number; pdfUrl?: string; source?: string } | null>(null);
  const pdfFileInputRef = useRef<HTMLInputElement>(null);

  // S3 (F6): the library is loaded whole and the search box filters it
  // client-side, live — the note search's model (a local, exact filter),
  // not a server round-trip per keystroke. The old wiring re-ran
  // reference-list on every keystroke with setLoading(true) up front,
  // and the render below swaps the WHOLE panel (search input included)
  // for a spinner while loading — the input unmounted on the first
  // keystroke, focus died with it, and racing responses could restore a
  // stale list, so in the live surface the box accepted text and the
  // list never filtered. Filtering locally removes that whole chain:
  // no fetch, no unmount, no race. The server-side reference-list query
  // stays for other consumers.
  const refresh = useCallback(async () => {
    if (!hasLoadedRef.current) setLoading(true);
    const r = await lensRun('research', 'reference-list', {});
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load the library.');
      setLoading(false);
      return;
    }
    setLoadError(null);
    setReferences(r.data?.result?.references || []);
    hasLoadedRef.current = true;
    setLoading(false);
  }, []);

  // Case-insensitive substring over title / authors / journal / DOI /
  // tags — the same field set reference-list's query matches server-side.
  const visibleReferences = useMemo(() => {
    const q = query.trim().toLowerCase();
    return references.filter((r) => {
      if (activeTag && !r.tags.includes(activeTag)) return false;
      if (!q) return true;
      return r.title.toLowerCase().includes(q)
        || (r.authors || '').toLowerCase().includes(q)
        || (r.journal || '').toLowerCase().includes(q)
        || (r.doi || '').toLowerCase().includes(q)
        || r.tags.some((t) => t.includes(q));
    });
  }, [references, query, activeTag]);

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
    setReader(null);
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
    // Fetch chicago + vancouver via cite-format as well, so every
    // citation style this domain supports is actually reachable here
    // (reference-detail's own citations object also carries them now).
    const chi = await lensRun<{ citation: string }>('research', 'cite-format', { id: ref.id, style: 'chicago' });
    if (chi.data?.ok !== false) {
      setCitations((prev) => (prev ? { ...prev, chicago: chi.data?.result?.citation } : prev));
    }
    const van = await lensRun<{ citation: string }>('research', 'cite-format', { id: ref.id, style: 'vancouver' });
    if (van.data?.ok !== false) {
      setCitations((prev) => (prev ? { ...prev, vancouver: van.data?.result?.citation } : prev));
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

  // S4 (F2): upload a PDF file through the platform's existing artifact
  // story — POST /api/artifact/upload stores the bytes as the user's own
  // artifact (the ArtifactUploader pattern: raw body + X- headers), and
  // the ACL-gated /api/artifact/:dtuId/stream URL is filed on the
  // reference through the existing reference-attach-pdf macro. No new
  // storage or serving mechanism is introduced here.
  const uploadPdfFile = async (file: File): Promise<boolean> => {
    if (!selected) return false;
    try {
      const res = await fetch('/api/artifact/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': file.type || 'application/pdf',
          'X-Filename': encodeURIComponent(file.name),
          'X-Title': encodeURIComponent(file.name),
          'X-Domain': 'research',
        },
        body: file,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data.dtuId) {
        setError(data?.error || `Upload failed (${res.status})`);
        return false;
      }
      const r = await lensRun('research', 'reference-attach-pdf', {
        referenceId: selected.id, url: `/api/artifact/${data.dtuId}/stream`, filename: file.name,
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Failed to attach the uploaded PDF'); return false; }
      setError(null);
      onChange();
      return true;
    } catch {
      setError('Upload failed — the file could not be sent.');
      return false;
    }
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
    // S3 (F8): reference-add passes the same duplicate gate as imports.
    // On a hit nothing was filed — say so, keep the form open, and offer
    // the existing record instead of silently "adding" a twin.
    const dupRef = (r.data?.result as { duplicate?: boolean; reference?: Reference } | undefined)?.duplicate
      ? (r.data?.result as { reference?: Reference }).reference
      : undefined;
    if (dupRef) {
      setDuplicateNote(dupRef);
      setError(null);
      await refresh(); await refreshTags(); onChange();
      return;
    }
    setDuplicateNote(null);
    setForm({ title: '', authors: '', year: '', type: 'article', journal: '', doi: '', tags: '' });
    setShowAdd(false); setError(null);
    await refresh(); await refreshTags(); onChange();
  };
  const addByIdentifier = async () => {
    const id = identifier.trim();
    if (!id) { setImportError('Paste a DOI, an arXiv ID, or a doi.org / arxiv.org link.'); setImportMsg(null); return; }
    setImporting(true); setImportMsg(null); setImportError(null);
    const r = await lensRun('research', 'academic-resolve-import', { identifier: id });
    setImporting(false);
    const ref = r.data?.result?.reference as Reference | undefined;
    if (r.data?.ok === false || !ref) {
      setImportError(
        r.data?.error === 'not_found'
          ? 'No reference found for that identifier.'
          : (r.data?.message || r.data?.error || 'Could not resolve that identifier.'),
      );
      return;
    }
    if ((r.data?.result as { duplicate?: boolean } | undefined)?.duplicate) {
      setImportMsg(`Already in your library: "${ref.title}" is already filed.`);
    } else {
      setImportMsg(`Imported "${ref.title}" via ${ref.source ? sourceLabel(ref.source) : 'the scholarly record'}.`);
    }
    setIdentifier('');
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

  // ── In-app reader (S4) ──
  if (selected && reader) {
    return (
      <ResearchPdfReader
        referenceId={selected.id}
        title={selected.title}
        initialPage={reader.page}
        initialPdfUrl={reader.pdfUrl}
        initialSource={reader.source}
        onClose={() => { void openRef(selected); }}
        onUpload={uploadPdfFile}
        onChanged={onChange}
      />
    );
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
                {selected.source ? ` · via ${sourceLabel(selected.source)}` : ''}
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
            {(['apa', 'mla', 'chicago', 'vancouver', 'bibtex'] as const).filter((style) => citations[style]).map((style) => (
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
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-semibold text-zinc-300">PDF attachments</h4>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setReader({})}
                className="flex items-center gap-1 text-[10px] font-medium bg-red-600 hover:bg-red-500 text-white rounded px-2 py-1">
                <BookOpen className="w-3 h-3" /> Read in Concord
              </button>
              <button type="button" onClick={() => pdfFileInputRef.current?.click()}
                className="flex items-center gap-1 text-[10px] text-zinc-300 hover:text-zinc-100 border border-zinc-700 rounded px-2 py-1">
                <Upload className="w-3 h-3" /> Upload PDF
              </button>
              <input ref={pdfFileInputRef} type="file" accept="application/pdf,.pdf" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void uploadPdfFile(f).then((ok) => { if (ok && selected) void openRef(selected); });
                }} />
            </div>
          </div>
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
            <p className="text-[11px] text-zinc-400 italic">No PDFs attached — “Read in Concord” still checks arXiv and open-access sources for this reference.</p>
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
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button"
                      onClick={() => setReader({ pdfUrl: p.url, source: p.url.startsWith('/api/artifact/') ? 'upload' : 'attached' })}
                      aria-label="Read PDF in Concord" className="text-zinc-400 hover:text-red-300">
                      <BookOpen className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => deletePdf(p.id)} aria-label="Delete PDF" className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Annotations</h4>
          <div className="grid grid-cols-4 gap-2 mb-2">
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
              {annotations.map((a) => {
                const target = a.anchor?.page || a.page;
                const body = (
                  <>
                    {a.quote && <p className="text-zinc-300 italic">&ldquo;{a.quote}&rdquo;{target ? ` (p.${target})` : ''}</p>}
                    {a.text && <p className="text-zinc-400">{a.text}</p>}
                  </>
                );
                // S4: an annotation with a page opens the reader at that
                // page — the passage's home is the document, not this list.
                return (
                  <li key={a.id} className="text-[11px] border-l-2 border-amber-600/50 pl-2">
                    {target ? (
                      <button type="button" onClick={() => setReader({ page: target })} className="text-left w-full hover:bg-zinc-800/40 rounded-r px-1 -ml-1">
                        {body}
                      </button>
                    ) : body}
                  </li>
                );
              })}
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
        <button type="button" onClick={() => { setDuplicateNote(null); setShowAdd((v) => !v); }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      </div>

      <HighlightsSection onOpenReference={openRef} />

      <AnalyzeLibrarySection />

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
          {duplicateNote && (
            <div className="col-span-2 flex items-center gap-2 text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900/40 rounded-lg px-2 py-1.5">
              <span className="flex-1">Already in your library: &ldquo;{duplicateNote.title}&rdquo; is already filed — nothing new was added.</span>
              <button type="button"
                onClick={() => { setShowAdd(false); setDuplicateNote(null); void openRef(duplicateNote); }}
                className="underline hover:text-amber-200 shrink-0">Open it</button>
            </div>
          )}
          <div className="col-span-2 border-t border-zinc-800 pt-2">
            <p className="text-[11px] text-zinc-400 mb-1.5">…or add by identifier — a DOI, an arXiv ID, or a doi.org / arxiv.org link, resolved from the scholarly record:</p>
            <div className="flex gap-2">
              <input placeholder="10.1038/nature16961 or 1706.03762" value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void addByIdentifier(); }}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addByIdentifier} disabled={importing || !identifier.trim()}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-100 rounded-lg border border-zinc-700">
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Import'}
              </button>
            </div>
            {importMsg && <p className="text-[11px] text-emerald-300 mt-1.5">{importMsg}</p>}
            {importError && <p className="text-[11px] text-rose-300 mt-1.5">{importError}</p>}
          </div>
        </div>
      )}

      {references.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          No references. Add papers and books to build your library.
        </div>
      ) : visibleReferences.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-10 border border-zinc-800 rounded-xl">
          {query.trim()
            ? `No references match "${query.trim()}".`
            : 'No references carry the selected tag.'}
        </div>
      ) : (
        <>
        {(query.trim() || activeTag) && (
          <p className="text-[11px] text-zinc-500">Showing {visibleReferences.length} of {references.length} references</p>
        )}
        <ul className="space-y-2">
          {visibleReferences.map((r) => (
            <li key={r.id} className="flex items-start justify-between bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <button type="button" onClick={() => openRef(r)} className="text-left flex items-start gap-2 min-w-0">
                <BookMarked className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100">{r.title}</p>
                  <p className="text-[11px] text-zinc-400 truncate">
                    {r.authors || 'Unknown'}{r.year ? ` · ${r.year}` : ''}{r.journal ? ` · ${r.journal}` : ''}
                    {r.source ? ` · via ${sourceLabel(r.source)}` : ''}
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
        </>
      )}
    </div>
  );
}
