'use client';

/**
 * PaperWorkbench — librarian-essentials surface for the paper lens.
 *
 * Covers the seven Zotero/arXiv feature-parity backlog items:
 *  1. PDF attachment + in-app reader
 *  2. PDF annotation + highlights synced to notes
 *  3. One-click capture from DOI/URL
 *  4. Semantic Scholar enrichment (citation counts + references graph)
 *  5. Duplicate detection + dedupe
 *  6. Shared / group libraries
 *  7. Cited-by + new-version alerts
 *
 * Every value shown is real user input or fetched from a free public API
 * (CrossRef, Semantic Scholar) through the paper.* macros. No seed data.
 */

import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  FileUp, FileText, Highlighter, Link2, Sparkles, Copy, Users,
  Bell, Loader2, Trash2, RefreshCw, X, Check, BookOpen, ArrowRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { TreeDiagram, type TreeNode } from '@/components/viz/TreeDiagram';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Annotation {
  id: string;
  page: number;
  quote: string;
  comment: string;
  color: string;
  createdAt: string;
}

interface Enrichment {
  citationCount: number | null;
  influentialCitationCount: number | null;
  referenceCount: number | null;
  fieldsOfStudy: string[];
  tldr: string | null;
  references: { title: string; year: number | null }[];
  citations: { title: string; year: number | null }[];
  enrichedAt: string;
}

interface WorkbenchPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  notes: string;
  pdf?: { fileName: string; sizeBytes: number; attachedAt: string };
  annotations?: Annotation[];
  enrichment?: Enrichment;
  citationCount?: number | null;
}

interface DupGroup {
  key: string;
  kind: string;
  members: { id: string; title: string; year: number | null; addedAt: string }[];
}

interface GroupSummary {
  id: string;
  name: string;
  description: string;
  isOwner: boolean;
  shareCode: string | null;
  memberCount: number;
  paperCount: number;
}

interface SharedPaper {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  addedBy: string;
}

interface Alert {
  id: string;
  paperId: string;
  paperTitle: string;
  kind: string;
  delta: number;
  from: number;
  to: number;
  message: string;
  createdAt: string;
  read: boolean;
}

type Tab = 'reader' | 'capture' | 'dedupe' | 'groups' | 'alerts';

const TABS: { id: Tab; label: string; icon: typeof FileText }[] = [
  { id: 'reader', label: 'PDF Reader', icon: FileText },
  { id: 'capture', label: 'Capture', icon: Link2 },
  { id: 'dedupe', label: 'Dedupe', icon: Copy },
  { id: 'groups', label: 'Group Libraries', icon: Users },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

const HL_COLORS = ['yellow', 'green', 'blue', 'pink', 'orange'];
const HL_CLASS: Record<string, string> = {
  yellow: 'bg-amber-400/20 border-amber-400/50',
  green: 'bg-emerald-400/20 border-emerald-400/50',
  blue: 'bg-sky-400/20 border-sky-400/50',
  pink: 'bg-pink-400/20 border-pink-400/50',
  orange: 'bg-orange-400/20 border-orange-400/50',
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaperWorkbench() {
  const [tab, setTab] = useState<Tab>('reader');
  const [papers, setPapers] = useState<WorkbenchPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refreshPapers = useCallback(async () => {
    const r = await lensRun<{ papers: WorkbenchPaper[] }>('paper', 'paper-list', {});
    if (r.data?.ok) setPapers(r.data.result?.papers || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refreshPapers(); }, [refreshPapers]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-violet-400" />
        <h3 className="text-sm font-bold text-zinc-100">Research Workbench</h3>
        <span className="text-[11px] text-zinc-400">PDF reader · capture · dedupe · groups · alerts</span>
      </div>

      <div className="flex gap-1 mb-3 flex-wrap">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.id} onClick={() => { setTab(t.id); setErr(null); }}
              className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded font-medium transition-colors',
                tab === t.id ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800')}>
              <Icon className="w-3 h-3" />{t.label}
            </button>
          );
        })}
      </div>

      {err && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-rose-300 bg-rose-950/40 border border-rose-900/60 rounded px-2 py-1.5">
          <X className="w-3 h-3 shrink-0" />{err}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-zinc-400"><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : (
        <>
          {tab === 'reader' && <ReaderTab papers={papers} busy={busy} setBusy={setBusy} setErr={setErr} onChanged={refreshPapers} />}
          {tab === 'capture' && <CaptureTab busy={busy} setBusy={setBusy} setErr={setErr} onCaptured={refreshPapers} />}
          {tab === 'dedupe' && <DedupeTab busy={busy} setBusy={setBusy} setErr={setErr} onMerged={refreshPapers} />}
          {tab === 'groups' && <GroupsTab papers={papers} busy={busy} setBusy={setBusy} setErr={setErr} />}
          {tab === 'alerts' && <AlertsTab busy={busy} setBusy={setBusy} setErr={setErr} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reader tab — PDF attach + in-app reader + annotation + enrichment
// (backlog items 1, 2, 4)
// ---------------------------------------------------------------------------

interface TabProps {
  busy: string | null;
  setBusy: (v: string | null) => void;
  setErr: (v: string | null) => void;
}

function ReaderTab({ papers, busy, setBusy, setErr, onChanged }:
  { papers: WorkbenchPaper[]; onChanged: () => Promise<void> } & TabProps) {
  const [selId, setSelId] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draft, setDraft] = useState({ page: '1', quote: '', comment: '', color: 'yellow' });

  const sel = useMemo(() => papers.find(p => p.id === selId) || null, [papers, selId]);

  const loadPaper = useCallback(async (id: string) => {
    setSelId(id);
    setPdfUrl(null);
    const [pdf, ann] = await Promise.all([
      lensRun<{ hasPdf: boolean; dataUrl?: string }>('paper', 'paper-pdf-get', { paperId: id }),
      lensRun<{ annotations: Annotation[] }>('paper', 'paper-annotations', { paperId: id }),
    ]);
    if (pdf.data?.ok && pdf.data.result?.hasPdf) setPdfUrl(pdf.data.result.dataUrl || null);
    if (ann.data?.ok) setAnnotations(ann.data.result?.annotations || []);
  }, []);

  const attachPdf = useCallback(async (file: File) => {
    if (!selId) return;
    if (file.type !== 'application/pdf') { setErr('Only PDF files can be attached.'); return; }
    setBusy('attach');
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('read failed'));
      fr.readAsDataURL(file);
    });
    const r = await lensRun('paper', 'paper-pdf-attach', { paperId: selId, dataUrl, fileName: file.name });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'attach failed'); return; }
    setErr(null);
    setPdfUrl(dataUrl);
    await onChanged();
  }, [selId, setBusy, setErr, onChanged]);

  const removePdf = useCallback(async () => {
    if (!selId) return;
    setBusy('remove');
    await lensRun('paper', 'paper-pdf-remove', { paperId: selId });
    setBusy(null);
    setPdfUrl(null);
    await onChanged();
  }, [selId, setBusy, onChanged]);

  const addAnnotation = useCallback(async () => {
    if (!selId || !draft.quote.trim()) return;
    setBusy('annotate');
    const r = await lensRun<{ annotation: Annotation }>('paper', 'paper-annotate', {
      paperId: selId, page: Number(draft.page) || 1, quote: draft.quote.trim(),
      comment: draft.comment.trim(), color: draft.color,
    });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'annotate failed'); return; }
    setErr(null);
    setDraft({ page: draft.page, quote: '', comment: '', color: draft.color });
    const ann = await lensRun<{ annotations: Annotation[] }>('paper', 'paper-annotations', { paperId: selId });
    if (ann.data?.ok) setAnnotations(ann.data.result?.annotations || []);
  }, [selId, draft, setBusy, setErr]);

  const delAnnotation = useCallback(async (annotationId: string) => {
    if (!selId) return;
    await lensRun('paper', 'paper-annotation-delete', { paperId: selId, annotationId });
    setAnnotations(prev => prev.filter(a => a.id !== annotationId));
  }, [selId]);

  const syncToNotes = useCallback(async () => {
    if (!selId) return;
    setBusy('sync');
    const r = await lensRun('paper', 'paper-annotations-sync', { paperId: selId });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'sync failed'); return; }
    setErr(null);
    await onChanged();
  }, [selId, setBusy, setErr, onChanged]);

  const enrich = useCallback(async () => {
    if (!selId) return;
    setBusy('enrich');
    const r = await lensRun('paper', 'paper-enrich', { paperId: selId });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'enrichment failed'); return; }
    setErr(null);
    await onChanged();
  }, [selId, setBusy, setErr, onChanged]);

  if (papers.length === 0) {
    return <p className="text-xs text-zinc-400 italic py-6 text-center">No papers yet — save one in the Paper Library above, then attach a PDF here.</p>;
  }

  const refTree: TreeNode | null = sel?.enrichment && sel.enrichment.references.length > 0
    ? {
        id: 'root', label: sel.title.slice(0, 48),
        children: sel.enrichment.references.slice(0, 12).map((r, i) => ({
          id: `ref-${i}`, label: `${r.title.slice(0, 44)}${r.year ? ` (${r.year})` : ''}`,
        })),
      }
    : null;

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      {/* Paper picker */}
      <ul className="space-y-1 max-h-[460px] overflow-y-auto">
        {papers.map(p => (
          <li key={p.id}>
            <button onClick={() => loadPaper(p.id)}
              className={cn('w-full text-left px-2 py-1.5 rounded text-[11px] transition-colors',
                selId === p.id ? 'bg-violet-600/20 border border-violet-600/50 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-800')}>
              <span className="line-clamp-2">{p.title}</span>
              <span className="flex items-center gap-1.5 mt-0.5 text-[9px] text-zinc-400">
                {p.pdf && <FileText className="w-2.5 h-2.5 text-emerald-400" />}
                {(p.annotations?.length || 0) > 0 && <span>{p.annotations?.length} hl</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* Reader pane */}
      <div className="min-w-0">
        {!sel ? (
          <p className="text-xs text-zinc-400 italic py-6 text-center">Select a paper to read.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-zinc-100 truncate">{sel.title}</p>
              <button onClick={enrich} disabled={busy === 'enrich'}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40">
                {busy === 'enrich' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}Enrich
              </button>
            </div>

            {/* PDF attach / reader */}
            {pdfUrl ? (
              <div className="space-y-1.5">
                <object data={pdfUrl} type="application/pdf" className="w-full h-[340px] rounded-lg border border-zinc-800 bg-zinc-900">
                  <p className="p-4 text-[11px] text-zinc-400">
                    PDF preview unavailable in this browser.{' '}
                    <a href={pdfUrl} download={sel.pdf?.fileName || 'paper.pdf'} className="text-violet-400 underline">Download</a>
                  </p>
                </object>
                <div className="flex items-center justify-between text-[10px] text-zinc-400">
                  <span>{sel.pdf?.fileName} · {sel.pdf ? fmtBytes(sel.pdf.sizeBytes) : ''}</span>
                  <button onClick={removePdf} disabled={busy === 'remove'} className="text-rose-400 hover:text-rose-300 inline-flex items-center gap-1">
                    <Trash2 className="w-3 h-3" />Remove PDF
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-1.5 h-[120px] rounded-lg border border-dashed border-zinc-700 bg-zinc-900/40 cursor-pointer hover:border-violet-600/60">
                {busy === 'attach' ? <Loader2 className="w-5 h-5 animate-spin text-violet-400" /> : <FileUp className="w-5 h-5 text-zinc-400" />}
                <span className="text-[11px] text-zinc-400">Attach a PDF (max 12 MB)</span>
                <input type="file" accept="application/pdf" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void attachPdf(f); e.target.value = ''; }} />
              </label>
            )}

            {/* Annotation composer */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Highlighter className="w-3 h-3 text-violet-400" />
                <span className="text-[11px] font-semibold text-zinc-200">New highlight</span>
              </div>
              <div className="flex gap-1.5">
                <input value={draft.page} onChange={e => setDraft({ ...draft, page: e.target.value })} placeholder="pg"
                  className="w-12 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
                <input value={draft.quote} onChange={e => setDraft({ ...draft, quote: e.target.value })} placeholder="Highlighted passage"
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              </div>
              <input value={draft.comment} onChange={e => setDraft({ ...draft, comment: e.target.value })} placeholder="Comment (optional)"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200" />
              <div className="flex items-center gap-1.5">
                {HL_COLORS.map(c => (
                  <button key={c} onClick={() => setDraft({ ...draft, color: c })} aria-label={`Highlight ${c}`}
                    className={cn('w-4 h-4 rounded-full border', HL_CLASS[c], draft.color === c && 'ring-2 ring-white/60')} />
                ))}
                <button onClick={addAnnotation} disabled={!draft.quote.trim() || busy === 'annotate'}
                  className="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">
                  {busy === 'annotate' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Highlighter className="w-3 h-3" />}Add
                </button>
              </div>
            </div>

            {/* Annotation list */}
            {annotations.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-zinc-400 uppercase tracking-wide">{annotations.length} highlight{annotations.length === 1 ? '' : 's'}</span>
                  <button onClick={syncToNotes} disabled={busy === 'sync'}
                    className="inline-flex items-center gap-1 text-[10px] text-violet-400 hover:text-violet-300 disabled:opacity-40">
                    {busy === 'sync' ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}Sync to notes
                  </button>
                </div>
                {annotations.map(a => (
                  <div key={a.id} className={cn('group rounded border-l-2 px-2 py-1', HL_CLASS[a.color])}>
                    <div className="flex items-start gap-2">
                      <span className="text-[9px] text-zinc-400 shrink-0 mt-0.5">p.{a.page}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] text-zinc-200">{a.quote}</p>
                        {a.comment && <p className="text-[10px] text-zinc-400 mt-0.5 italic">— {a.comment}</p>}
                      </div>
                      <button aria-label="Delete" onClick={() => delAnnotation(a.id)} className="opacity-0 group-hover:opacity-100 text-rose-400 shrink-0">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Enrichment */}
            {sel.enrichment && (
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span className="text-[11px] font-semibold text-zinc-200">Semantic Scholar</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([['Citations', sel.enrichment.citationCount],
                     ['Influential', sel.enrichment.influentialCitationCount],
                     ['References', sel.enrichment.referenceCount]] as const).map(([l, v]) => (
                    <div key={l} className="bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-center">
                      <p className="text-sm font-bold text-zinc-100">{v ?? '—'}</p>
                      <p className="text-[9px] text-zinc-400 uppercase">{l}</p>
                    </div>
                  ))}
                </div>
                {sel.enrichment.tldr && <p className="text-[11px] text-zinc-400 italic">{sel.enrichment.tldr}</p>}
                {sel.enrichment.fieldsOfStudy.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {sel.enrichment.fieldsOfStudy.map(f => (
                      <span key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-300">{f}</span>
                    ))}
                  </div>
                )}
                {refTree && (
                  <div>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wide mb-1">References graph</p>
                    <div className="max-h-[200px] overflow-auto">
                      <TreeDiagram root={refTree} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capture tab — one-click DOI/URL capture (backlog item 3)
// ---------------------------------------------------------------------------

function CaptureTab({ busy, setBusy, setErr, onCaptured }:
  { onCaptured: () => Promise<void> } & TabProps) {
  const [input, setInput] = useState('');
  const [captured, setCaptured] = useState<WorkbenchPaper | null>(null);

  const capture = useCallback(async () => {
    if (!input.trim()) return;
    setBusy('capture');
    setCaptured(null);
    const r = await lensRun<{ paper: WorkbenchPaper }>('paper', 'paper-capture', { url: input.trim() });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'capture failed'); return; }
    setErr(null);
    setCaptured(r.data.result?.paper || null);
    setInput('');
    await onCaptured();
  }, [input, setBusy, setErr, onCaptured]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-400">
        Paste a DOI or a doi.org URL — metadata is fetched from CrossRef and saved straight into your library.
      </p>
      <div className="flex gap-1.5">
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void capture(); }}
          placeholder="10.1038/nature14539  or  https://doi.org/10.1038/nature14539"
          className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200" />
        <button onClick={capture} disabled={!input.trim() || busy === 'capture'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white font-semibold disabled:opacity-40">
          {busy === 'capture' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}Capture
        </button>
      </div>
      {captured && (
        <div className="bg-emerald-950/30 border border-emerald-900/60 rounded-lg p-3 space-y-1">
          <div className="flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] font-semibold text-emerald-300">Added to library</span>
          </div>
          <p className="text-xs font-semibold text-zinc-100">{captured.title}</p>
          <p className="text-[10px] text-zinc-400">
            {captured.authors.slice(0, 4).join(', ')}{captured.authors.length > 4 ? ' et al.' : ''}
            {captured.year ? ` · ${captured.year}` : ''}
          </p>
          {captured.doi && <p className="text-[10px] text-zinc-400 font-mono">{captured.doi}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dedupe tab — duplicate detection + merge (backlog item 5)
// ---------------------------------------------------------------------------

function DedupeTab({ busy, setBusy, setErr, onMerged }:
  { onMerged: () => Promise<void> } & TabProps) {
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [scanned, setScanned] = useState(false);
  const [total, setTotal] = useState(0);

  const scan = useCallback(async () => {
    setBusy('scan');
    const r = await lensRun<{ duplicateGroups: DupGroup[]; totalPapers: number }>('paper', 'paper-find-duplicates', {});
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'scan failed'); return; }
    setErr(null);
    setGroups(r.data.result?.duplicateGroups || []);
    setTotal(r.data.result?.totalPapers || 0);
    setScanned(true);
  }, [setBusy, setErr]);

  const merge = useCallback(async (g: DupGroup) => {
    setBusy(`merge-${g.key}`);
    const r = await lensRun('paper', 'paper-merge-duplicates', { ids: g.members.map(m => m.id) });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'merge failed'); return; }
    setErr(null);
    await onMerged();
    await scan();
  }, [setBusy, setErr, onMerged, scan]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-400">
          Finds records that share a DOI or have an identical normalised title.
        </p>
        <button onClick={scan} disabled={busy === 'scan'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40">
          {busy === 'scan' ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}Scan library
        </button>
      </div>
      {scanned && groups.length === 0 && (
        <p className="text-xs text-emerald-400 italic py-4 text-center">No duplicates across {total} paper{total === 1 ? '' : 's'}.</p>
      )}
      {!scanned && <p className="text-xs text-zinc-400 italic py-4 text-center">Run a scan to detect duplicates.</p>}
      {groups.map(g => (
        <div key={g.key} className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wide text-amber-400">
              {g.kind} match · {g.members.length} copies
            </span>
            <button onClick={() => merge(g)} disabled={busy === `merge-${g.key}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">
              {busy === `merge-${g.key}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Copy className="w-3 h-3" />}Merge
            </button>
          </div>
          <ul className="space-y-0.5">
            {g.members.map(m => (
              <li key={m.id} className="text-[11px] text-zinc-300 flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-zinc-600 shrink-0" />
                <span className="truncate">{m.title}{m.year ? ` (${m.year})` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Groups tab — shared / group libraries (backlog item 6)
// ---------------------------------------------------------------------------

function GroupsTab({ papers, busy, setBusy, setErr }:
  { papers: WorkbenchPaper[] } & TabProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openPapers, setOpenPapers] = useState<SharedPaper[]>([]);
  const [addId, setAddId] = useState('');

  const refresh = useCallback(async () => {
    const r = await lensRun<{ groups: GroupSummary[] }>('paper', 'group-list', {});
    if (r.data?.ok) setGroups(r.data.result?.groups || []);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setBusy('grp-create');
    const r = await lensRun('paper', 'group-create', { name: name.trim() });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'create failed'); return; }
    setErr(null);
    setName('');
    await refresh();
  }, [name, setBusy, setErr, refresh]);

  const join = useCallback(async () => {
    if (!joinCode.trim()) return;
    setBusy('grp-join');
    const r = await lensRun('paper', 'group-join', { shareCode: joinCode.trim() });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'join failed'); return; }
    setErr(null);
    setJoinCode('');
    await refresh();
  }, [joinCode, setBusy, setErr, refresh]);

  const open = useCallback(async (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    const r = await lensRun<{ papers: SharedPaper[] }>('paper', 'group-papers', { groupId: id });
    if (r.data?.ok) setOpenPapers(r.data.result?.papers || []);
  }, [openId]);

  const addPaper = useCallback(async (groupId: string) => {
    if (!addId) return;
    setBusy('grp-add');
    const r = await lensRun('paper', 'group-add-paper', { groupId, paperId: addId });
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'add failed'); return; }
    setErr(null);
    setAddId('');
    const pr = await lensRun<{ papers: SharedPaper[] }>('paper', 'group-papers', { groupId });
    if (pr.data?.ok) setOpenPapers(pr.data.result?.papers || []);
    await refresh();
  }, [addId, setBusy, setErr, refresh]);

  const removePaper = useCallback(async (groupId: string, paperId: string) => {
    await lensRun('paper', 'group-remove-paper', { groupId, paperId });
    setOpenPapers(prev => prev.filter(p => p.id !== paperId));
    await refresh();
  }, [refresh]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="New group name"
          className="flex-1 min-w-[140px] bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200" />
        <button onClick={create} disabled={!name.trim() || busy === 'grp-create'}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">
          {busy === 'grp-create' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}Create
        </button>
        <input value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} placeholder="Join code"
          className="w-28 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 font-mono" />
        <button onClick={join} disabled={!joinCode.trim() || busy === 'grp-join'}
          className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40">Join</button>
      </div>

      {groups.length === 0 && <p className="text-xs text-zinc-400 italic py-4 text-center">No group libraries yet — create one or join with a code.</p>}

      <ul className="space-y-1.5">
        {groups.map(g => (
          <li key={g.id} className="bg-zinc-900/60 border border-zinc-800 rounded-lg">
            <button onClick={() => open(g.id)} className="w-full flex items-center gap-2 px-3 py-2 text-left">
              <Users className="w-3.5 h-3.5 text-violet-400 shrink-0" />
              <span className="text-xs font-semibold text-zinc-100 min-w-0 flex-1 truncate">{g.name}</span>
              <span className="text-[10px] text-zinc-400">{g.memberCount} member{g.memberCount === 1 ? '' : 's'} · {g.paperCount} paper{g.paperCount === 1 ? '' : 's'}</span>
              {g.isOwner && g.shareCode && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-violet-300">{g.shareCode}</span>
              )}
            </button>
            {openId === g.id && (
              <div className="px-3 pb-2.5 border-t border-zinc-800 pt-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <select value={addId} onChange={e => setAddId(e.target.value)}
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-[11px] text-zinc-200">
                    <option value="">Add a paper from your library…</option>
                    {papers.map(p => <option key={p.id} value={p.id}>{p.title.slice(0, 60)}</option>)}
                  </select>
                  <button onClick={() => addPaper(g.id)} disabled={!addId || busy === 'grp-add'}
                    className="px-2 py-1 text-[11px] rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40">Add</button>
                </div>
                {openPapers.length === 0 ? (
                  <p className="text-[11px] text-zinc-400 italic">No shared papers yet.</p>
                ) : openPapers.map(p => (
                  <div key={p.id} className="group flex items-center gap-2 text-[11px] text-zinc-300">
                    <span className="w-1 h-1 rounded-full bg-zinc-600 shrink-0" />
                    <span className="truncate min-w-0 flex-1">{p.title}{p.year ? ` (${p.year})` : ''}</span>
                    <button aria-label="Delete" onClick={() => removePaper(g.id, p.id)} className="opacity-0 group-hover:opacity-100 text-rose-400">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts tab — cited-by + new-version alerts (backlog item 7)
// ---------------------------------------------------------------------------

function AlertsTab({ busy, setBusy, setErr }: TabProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    const r = await lensRun<{ alerts: Alert[]; unread: number; checkedAt: string | null }>('paper', 'paper-alerts-list', {});
    if (r.data?.ok) {
      setAlerts(r.data.result?.alerts || []);
      setUnread(r.data.result?.unread || 0);
      setCheckedAt(r.data.result?.checkedAt || null);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const check = useCallback(async () => {
    setBusy('check');
    const r = await lensRun('paper', 'paper-check-alerts', {});
    setBusy(null);
    if (!r.data?.ok) { setErr(r.data?.error || 'check failed'); return; }
    setErr(null);
    await refresh();
  }, [setBusy, setErr, refresh]);

  const markRead = useCallback(async (alertId: string) => {
    await lensRun('paper', 'paper-alert-read', { alertId });
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, read: true } : a));
    setUnread(u => Math.max(0, u - 1));
  }, []);

  const markAll = useCallback(async () => {
    await lensRun('paper', 'paper-alert-read', { all: true });
    setAlerts(prev => prev.map(a => ({ ...a, read: true })));
    setUnread(0);
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-zinc-400">
          Re-queries Semantic Scholar for new citations of every saved paper with a DOI or arXiv id.
        </p>
        <div className="flex items-center gap-1.5">
          {unread > 0 && (
            <button onClick={markAll} className="text-[10px] text-zinc-400 hover:text-zinc-200">Mark all read</button>
          )}
          <button onClick={check} disabled={busy === 'check'}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40">
            {busy === 'check' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}Check now
          </button>
        </div>
      </div>
      {checkedAt && <p className="text-[10px] text-zinc-400">Last checked {new Date(checkedAt).toLocaleString()}</p>}
      {alerts.length === 0 ? (
        <p className="text-xs text-zinc-400 italic py-4 text-center">No alerts yet — run a check to scan for new citations.</p>
      ) : (
        <ul className="space-y-1">
          {alerts.map(a => (
            <li key={a.id}
              className={cn('flex items-start gap-2 rounded-lg border px-2.5 py-1.5',
                a.read ? 'border-zinc-800 bg-zinc-900/40' : 'border-violet-700/50 bg-violet-950/30')}>
              <Bell className={cn('w-3 h-3 shrink-0 mt-0.5', a.read ? 'text-zinc-600' : 'text-violet-400')} />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-200">{a.message}</p>
                <p className="text-[9px] text-zinc-400 mt-0.5">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              {!a.read && (
                <button aria-label="Confirm" onClick={() => markRead(a.id)} className="shrink-0 text-[10px] text-violet-400 hover:text-violet-300">
                  <Check className="w-3 h-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
