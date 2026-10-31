'use client';

/**
 * ResearchPdfReader — the in-app PDF reader for the Research lens (S4, F2).
 *
 * Resolution is the server's job (`research.reference-pdf`: attached →
 * arXiv → the record's own .pdf link → Unpaywall's best OA location);
 * this component renders what it is given and says honestly when no PDF
 * exists. The document renders in the browser's built-in viewer inside
 * the lens — no new tab — with the reference's annotations alongside.
 *
 * Anchoring, stated plainly: annotations created here carry a structured
 * anchor ({ page, startOffset, endOffset }) through `annotation-add`.
 * The page is real — it is the page the reader is showing. The offsets
 * are null in this build: the platform has no PDF text layer (no pdf.js
 * in the bundle, no server-side extraction), so the built-in viewer
 * cannot hand a text selection to Concord and nothing here pretends it
 * measured one. The user pastes the passage as the quote; the anchor
 * files it against the page. Clicking an annotation reopens the reader
 * at its page (the built-in viewer honours the #page= fragment).
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ChevronLeft, ChevronRight, ExternalLink, X, Highlighter, Upload, Anchor as AnchorIcon } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface PdfAnchor { page: number | null; startOffset: number | null; endOffset: number | null }
interface ReaderAnnotation { id: string; page: number | null; quote: string | null; text: string | null; color: string; anchor?: PdfAnchor | null }
interface ResolvedPdf {
  pdfUrl: string | null; source: string | null; filename?: string | null;
  pages?: number | null; reason?: string; message?: string;
}

const SOURCE_COPY: Record<string, string> = {
  attached: 'Attached PDF',
  upload: 'Uploaded PDF',
  arxiv: 'arXiv PDF',
  unpaywall: 'Open-access PDF via Unpaywall',
  direct: 'PDF at the record’s link',
};

interface Props {
  referenceId: string;
  title: string;
  initialPage?: number;
  initialPdfUrl?: string;
  initialSource?: string;
  onClose: () => void;
  onUpload?: (file: File) => Promise<boolean>;
  onChanged?: () => void;
}

export function ResearchPdfReader({ referenceId, title, initialPage, initialPdfUrl, initialSource, onClose, onUpload, onChanged }: Props) {
  const [resolved, setResolved] = useState<ResolvedPdf | null>(
    initialPdfUrl ? { pdfUrl: initialPdfUrl, source: initialSource || (initialPdfUrl.startsWith('/api/artifact/') ? 'upload' : 'attached') } : null,
  );
  const [resolving, setResolving] = useState(!initialPdfUrl);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [page, setPage] = useState(Math.max(1, initialPage || 1));
  const [pageInput, setPageInput] = useState(String(Math.max(1, initialPage || 1)));
  const [annotations, setAnnotations] = useState<ReaderAnnotation[]>([]);
  const [quote, setQuote] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const resolve = useCallback(async () => {
    setResolving(true);
    const r = await lensRun<ResolvedPdf>('research', 'reference-pdf', { referenceId });
    if (r.data?.ok === false) {
      setResolveError(r.data?.error || 'Could not resolve a PDF for this reference.');
      setResolving(false);
      return;
    }
    setResolveError(null);
    setResolved((r.data?.result as ResolvedPdf | undefined) || { pdfUrl: null, source: null });
    setResolving(false);
  }, [referenceId]);

  useEffect(() => { if (!initialPdfUrl) void resolve(); }, [resolve, initialPdfUrl]);

  const loadAnnotations = useCallback(async () => {
    const r = await lensRun<{ annotations: ReaderAnnotation[] }>('research', 'annotation-list', { referenceId });
    setAnnotations(r.data?.result?.annotations || []);
  }, [referenceId]);

  useEffect(() => { void loadAnnotations(); }, [loadAnnotations]);

  const jumpTo = (p: number) => {
    const next = Math.max(1, Math.round(p) || 1);
    setPage(next);
    setPageInput(String(next));
  };

  const addAnnotation = async () => {
    if (!quote.trim() && !note.trim()) { setError('Add a quote or a note first.'); return; }
    setSaving(true);
    const r = await lensRun('research', 'annotation-add', {
      referenceId, page, quote: quote.trim(), text: note.trim(),
      anchor: { page },
    });
    setSaving(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Could not save the annotation.'); return; }
    setQuote(''); setNote(''); setError(null);
    setNotice(`Annotation saved on page ${page}.`);
    await loadAnnotations();
    onChanged?.();
  };

  const handleUpload = async (file: File) => {
    if (!onUpload) return;
    setUploading(true);
    const ok = await onUpload(file);
    setUploading(false);
    if (ok) await resolve();
  };

  const pdfUrl = resolved?.pdfUrl || null;
  // The built-in viewer honours #page= on load; keying the iframe by URL
  // + page remounts it at the requested page on an explicit jump.
  const frameSrc = pdfUrl ? `${pdfUrl}${pdfUrl.includes('#') ? '' : `#page=${page}`}` : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onClose}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 shrink-0">
          <ChevronLeft className="w-3.5 h-3.5" /> Reference
        </button>
        <h3 className="text-sm font-bold text-zinc-100 truncate flex-1">{title}</h3>
        {resolved?.source && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-400 shrink-0">
            {SOURCE_COPY[resolved.source] || resolved.source}
          </span>
        )}
        <button type="button" onClick={onClose} aria-label="Close reader" className="text-zinc-500 hover:text-zinc-300 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/40 rounded-lg px-3 py-2">{notice}</div>}

      {resolving ? (
        <div className="flex items-center justify-center py-16 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : resolveError ? (
        <div className="text-center text-zinc-400 text-sm py-10 border border-zinc-800 rounded-xl space-y-2">
          <p>{resolveError}</p>
          <button type="button" onClick={onClose} className="text-xs text-red-300 underline">Back to the reference</button>
        </div>
      ) : !pdfUrl ? (
        <div className="text-center text-zinc-400 text-sm py-10 border border-zinc-800 rounded-xl space-y-3 px-4">
          <p>{resolved?.message || 'No PDF is available for this reference yet.'}</p>
          {onUpload && (
            <label className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-500 text-white rounded-lg cursor-pointer', uploading && 'opacity-50 pointer-events-none')}>
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload a PDF
              <input type="file" accept="application/pdf,.pdf" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void handleUpload(f); }} />
            </label>
          )}
          <p className="text-[11px] text-zinc-500">…or attach a PDF link from the reference page.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => jumpTo(page - 1)} disabled={page <= 1} aria-label="Previous page"
              className="p-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100 disabled:opacity-40">
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-zinc-400">Page</span>
            <input value={pageInput} inputMode="numeric"
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') jumpTo(Number(pageInput)); }}
              onBlur={() => jumpTo(Number(pageInput))}
              className="w-14 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100 text-center" />
            {resolved?.pages ? <span className="text-[11px] text-zinc-500">of {resolved.pages}</span> : null}
            <button type="button" onClick={() => jumpTo(page + 1)} aria-label="Next page"
              className="p-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-zinc-100">
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <span className="flex-1" />
            <a href={pdfUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-red-300">
              Open in new tab <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <iframe key={frameSrc || undefined} src={frameSrc || undefined} title={`PDF — ${title}`}
            className="w-full h-[65vh] bg-zinc-900 border border-zinc-800 rounded-xl" />

          <p className="text-[11px] text-zinc-500">
            Select a passage in the viewer and paste it as the quote — the annotation anchors to the page
            you’re on. (The built-in viewer can’t pass a selection to Concord directly yet, so the quote is pasted, not captured.)
          </p>

          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1.5">
              <Highlighter className="w-3.5 h-3.5 text-amber-400" /> Annotate page {page}
            </h4>
            <div className="grid grid-cols-4 gap-2">
              <input placeholder="Quote — the passage, pasted" value={quote} onChange={(e) => setQuote(e.target.value)}
                className="col-span-4 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Your note" value={note} onChange={(e) => setNote(e.target.value)}
                className="col-span-3 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addAnnotation} disabled={saving}
                className="bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg">
                {saving ? 'Saving…' : 'Add'}
              </button>
            </div>
          </div>
        </>
      )}

      {annotations.length > 0 && (
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
          <h4 className="text-xs font-semibold text-zinc-300 mb-2">Annotations on this paper</h4>
          <ul className="space-y-1">
            {annotations.map((a) => {
              const target = a.anchor?.page || a.page;
              return (
                <li key={a.id}>
                  <button type="button" disabled={!target || !pdfUrl}
                    onClick={() => { if (target) jumpTo(target); }}
                    className="w-full text-left text-[11px] border-l-2 border-amber-600/50 pl-2 py-1 hover:bg-zinc-800/40 rounded-r transition-colors disabled:cursor-default">
                    {a.quote && (
                      <p className="text-zinc-300 italic">
                        &ldquo;{a.quote}&rdquo;{target ? ` (p.${target})` : ''}
                        {a.anchor ? <AnchorIcon className="inline w-3 h-3 ml-1 text-amber-500" /> : null}
                      </p>
                    )}
                    {a.text && <p className="text-zinc-400">{a.text}</p>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
