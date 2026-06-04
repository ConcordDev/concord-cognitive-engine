'use client';

/**
 * ResearchLibraryPanel — the reference library with add, filters, and a
 * reference detail showing citations, annotations and related items.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, BookMarked, ChevronLeft, Trash2, Copy, FileText, ExternalLink } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reference {
  id: string; title: string; authors: string | null; year: number | null;
  type: string; journal: string | null; doi: string | null; tags: string[]; status: string;
}
interface Annotation { id: string; page: number | null; quote: string | null; text: string | null; color: string }
interface PdfAttachment { id: string; referenceId: string; url: string; filename: string; pages: number | null }

const TYPES = ['article', 'book', 'chapter', 'conference', 'thesis', 'report', 'preprint', 'dataset'];
const STATUS_COLOR: Record<string, string> = {
  to_read: 'text-zinc-400', reading: 'text-amber-400', read: 'text-emerald-400',
};

export function ResearchLibraryPanel({ onChange }: { onChange: () => void }) {
  const [references, setReferences] = useState<Reference[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: '', authors: '', year: '', type: 'article', journal: '', doi: '', tags: '' });
  const [selected, setSelected] = useState<Reference | null>(null);
  const [citations, setCitations] = useState<{ apa: string; mla: string; bibtex: string } | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [annForm, setAnnForm] = useState({ page: '', quote: '', text: '' });
  const [pdfs, setPdfs] = useState<PdfAttachment[]>([]);
  const [pdfForm, setPdfForm] = useState({ url: '', filename: '', pages: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('research', 'reference-list', query.trim() ? { query: query.trim() } : {});
    setReferences(r.data?.result?.references || []);
    setLoading(false);
  }, [query]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openRef = useCallback(async (ref: Reference) => {
    setSelected(ref);
    const r = await lensRun('research', 'reference-detail', { id: ref.id });
    setCitations(r.data?.result?.citations || null);
    setAnnotations(r.data?.result?.annotations || []);
    const p = await lensRun<{ pdfs: PdfAttachment[] }>('research', 'reference-pdfs', { referenceId: ref.id });
    setPdfs(p.data?.result?.pdfs || []);
  }, []);

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
    await refresh(); onChange();
  };
  const del = async (id: string) => { await lensRun('research', 'reference-delete', { id }); await refresh(); onChange(); };
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
          <h3 className="text-base font-bold text-zinc-100">{selected.title}</h3>
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
        </div>

        {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

        {citations && (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
            <h4 className="text-xs font-semibold text-zinc-300">Citations</h4>
            {(['apa', 'mla', 'bibtex'] as const).map((style) => (
              <div key={style} className="flex items-start gap-2">
                <span className="text-[10px] uppercase text-zinc-400 w-12 shrink-0 pt-0.5">{style}</span>
                <code className="flex-1 text-[10px] text-zinc-400 break-all whitespace-pre-wrap">{citations[style]}</code>
                <button type="button" onClick={() => copy(citations[style])} aria-label={`Copy ${style} citation`} className="text-zinc-600 hover:text-zinc-300 shrink-0">
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
              {annotations.map((a) => (
                <li key={a.id} className="text-[11px] border-l-2 border-amber-600/50 pl-2">
                  {a.quote && <p className="text-zinc-300 italic">&ldquo;{a.quote}&rdquo;{a.page ? ` (p.${a.page})` : ''}</p>}
                  {a.text && <p className="text-zinc-400">{a.text}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
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
