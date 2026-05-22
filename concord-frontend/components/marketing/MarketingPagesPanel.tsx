'use client';

/**
 * MarketingPagesPanel — landing page / form builder with submission capture.
 * Wires: page-create, page-update, page-list, page-delete, page-submit,
 * page-submissions.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, LayoutTemplate, Trash2, X, Inbox, Send } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type FieldType = 'text' | 'email' | 'phone' | 'select' | 'textarea' | 'checkbox';
const FIELD_TYPES: FieldType[] = ['text', 'email', 'phone', 'select', 'textarea', 'checkbox'];

interface FormField { type: FieldType; label: string; required: boolean; options: string[] }
interface LandingPage {
  id: string; name: string; slug: string; headline: string; subhead: string | null;
  ctaText: string; fields: FormField[]; fieldCount: number; status: string;
  views: number; submissions: number; conversionRate: number;
}
interface Submission { id: string; pageId: string; values: Record<string, string>; submittedAt: string }

export function MarketingPagesPanel() {
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<LandingPage | null>(null);
  const [busy, setBusy] = useState(false);

  const [fName, setFName] = useState('');
  const [fHeadline, setFHeadline] = useState('');
  const [fSubhead, setFSubhead] = useState('');
  const [fCta, setFCta] = useState('');
  const [fFields, setFFields] = useState<FormField[]>([]);

  const [submitFor, setSubmitFor] = useState<LandingPage | null>(null);
  const [submitValues, setSubmitValues] = useState<Record<string, string>>({});

  const [subsFor, setSubsFor] = useState<string | null>(null);
  const [subs, setSubs] = useState<Submission[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'page-list', {});
    setPages(r.data?.result?.pages || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCreate = () => {
    setEditing(null); setCreating(true);
    setFName(''); setFHeadline(''); setFSubhead(''); setFCta(''); setFFields([]);
  };
  const openEdit = (p: LandingPage) => {
    setEditing(p); setCreating(true);
    setFName(p.name); setFHeadline(p.headline); setFSubhead(p.subhead || '');
    setFCta(p.ctaText); setFFields(p.fields.map((f) => ({ ...f, options: [...f.options] })));
  };

  const addField = (type: FieldType) =>
    setFFields((f) => [...f, { type, label: '', required: false, options: [] }]);
  const updateField = (i: number, patch: Partial<FormField>) =>
    setFFields((f) => f.map((fl, idx) => (idx === i ? { ...fl, ...patch } : fl)));
  const removeField = (i: number) => setFFields((f) => f.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!fName.trim()) { setError('Page name is required.'); return; }
    setBusy(true); setError(null);
    const payload = {
      name: fName.trim(), headline: fHeadline.trim(), subhead: fSubhead.trim(),
      ctaText: fCta.trim(), fields: fFields,
    };
    const r = editing
      ? await lensRun('marketing', 'page-update', { id: editing.id, ...payload })
      : await lensRun('marketing', 'page-create', payload);
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCreating(false);
    await refresh();
  };

  const setStatus = async (id: string, status: string) => {
    const r = await lensRun('marketing', 'page-update', { id, status });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'page-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  const openSubmit = (p: LandingPage) => {
    setSubmitFor(p);
    const init: Record<string, string> = {};
    for (const fl of p.fields) init[fl.label] = '';
    setSubmitValues(init);
  };

  const submitForm = async () => {
    if (!submitFor) return;
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'page-submit', { id: submitFor.id, values: submitValues });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Submission failed'); return; }
    setSubmitFor(null);
    await refresh();
  };

  const viewSubs = async (id: string) => {
    setSubsFor(id);
    const r = await lensRun('marketing', 'page-submissions', { id });
    setSubs(r.data?.result?.submissions || []);
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
          <LayoutTemplate className="w-3.5 h-3.5 text-orange-400" /> Landing pages &amp; forms
        </h3>
        <button type="button" onClick={openCreate}
          className="flex items-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg px-3 py-1.5">
          <Plus className="w-3.5 h-3.5" /> New page
        </button>
      </div>

      {pages.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No landing pages. Build a page with a form to capture leads.</p>
      ) : (
        <ul className="space-y-2">
          {pages.map((p) => (
            <li key={p.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{p.name}</p>
                  <p className="text-[11px] text-zinc-500 truncate">/{p.slug} · {p.fieldCount} fields · {p.submissions} submissions · {p.conversionRate}% conv · {p.status}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={() => openEdit(p)}
                    className="text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">Edit</button>
                  {p.status !== 'published'
                    ? <button type="button" onClick={() => setStatus(p.id, 'published')}
                        className="text-[11px] text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded border border-emerald-800/60">Publish</button>
                    : <button type="button" onClick={() => openSubmit(p)}
                        className="flex items-center gap-1 text-[11px] text-blue-300 hover:text-blue-200 px-2 py-1 rounded border border-blue-800/60">
                        <Send className="w-3 h-3" /> Test form
                      </button>}
                  <button type="button" onClick={() => viewSubs(p.id)}
                    className="flex items-center gap-1 text-[11px] text-zinc-300 hover:text-white px-2 py-1 rounded border border-zinc-700">
                    <Inbox className="w-3 h-3" /> Inbox
                  </button>
                  <button type="button" onClick={() => del(p.id)} aria-label="Delete page"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Builder modal */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreating(false)}>
          <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">{editing ? 'Edit' : 'New'} landing page</h4>
              <button type="button" onClick={() => setCreating(false)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            <input placeholder="Page name" value={fName} onChange={(e) => setFName(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Headline" value={fHeadline} onChange={(e) => setFHeadline(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Sub-headline" value={fSubhead} onChange={(e) => setFSubhead(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <input placeholder="CTA button text" value={fCta} onChange={(e) => setFCta(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
            <div className="flex flex-wrap gap-1">
              {FIELD_TYPES.map((t) => (
                <button key={t} type="button" onClick={() => addField(t)}
                  className="text-[10px] capitalize bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded px-2 py-1">+ {t}</button>
              ))}
            </div>
            {fFields.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">Add form fields to capture submissions.</p>
            ) : (
              <ul className="space-y-1.5">
                {fFields.map((fl, i) => (
                  <li key={i} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold">{fl.type}</span>
                      <button type="button" onClick={() => removeField(i)} aria-label="Remove field"
                        className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    <input value={fl.label} onChange={(e) => updateField(i, { label: e.target.value })}
                      placeholder="Field label" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                    {fl.type === 'select' && (
                      <input value={fl.options.join(', ')}
                        onChange={(e) => updateField(i, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                        placeholder="Options (comma-separated)" className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100" />
                    )}
                    <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                      <input type="checkbox" checked={fl.required} onChange={(e) => updateField(i, { required: e.target.checked })} />
                      Required
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCreating(false)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={save} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
                {busy ? 'Saving…' : 'Save page'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit form modal */}
      {submitFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSubmitFor(null)}>
          <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()}>
            <h4 className="text-sm font-semibold text-white">{submitFor.headline}</h4>
            {submitFor.subhead && <p className="text-[11px] text-zinc-400">{submitFor.subhead}</p>}
            {submitFor.fields.map((fl) => (
              <div key={fl.label}>
                <label className="text-[10px] text-zinc-400">{fl.label}{fl.required && <span className="text-rose-400"> *</span>}</label>
                {fl.type === 'textarea' ? (
                  <textarea value={submitValues[fl.label] || ''} rows={3}
                    onChange={(e) => setSubmitValues((v) => ({ ...v, [fl.label]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
                ) : fl.type === 'select' ? (
                  <select value={submitValues[fl.label] || ''}
                    onChange={(e) => setSubmitValues((v) => ({ ...v, [fl.label]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100">
                    <option value="">Select…</option>
                    {fl.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input value={submitValues[fl.label] || ''}
                    type={fl.type === 'email' ? 'email' : fl.type === 'phone' ? 'tel' : 'text'}
                    onChange={(e) => setSubmitValues((v) => ({ ...v, [fl.label]: e.target.value }))}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100" />
                )}
              </div>
            ))}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setSubmitFor(null)}
                className="text-xs text-zinc-400 hover:text-white px-3 py-1.5">Cancel</button>
              <button type="button" onClick={submitForm} disabled={busy}
                className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
                  busy ? 'bg-zinc-700' : 'bg-blue-600 hover:bg-blue-500')}>
                {busy ? 'Submitting…' : submitFor.ctaText}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submissions inbox */}
      {subsFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSubsFor(null)}>
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3"
            onClick={(ev) => ev.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-white">Submissions ({subs.length})</h4>
              <button type="button" onClick={() => setSubsFor(null)} aria-label="Close"><X className="w-4 h-4 text-zinc-400" /></button>
            </div>
            {subs.length === 0 ? (
              <p className="text-[11px] text-zinc-500 italic">No submissions captured yet.</p>
            ) : (
              <ul className="space-y-2">
                {subs.map((sub) => (
                  <li key={sub.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-2">
                    <p className="text-[10px] text-zinc-500 mb-1">{new Date(sub.submittedAt).toLocaleString()}</p>
                    {Object.entries(sub.values).map(([k, v]) => (
                      <p key={k} className="text-[11px] text-zinc-300"><span className="text-zinc-500">{k}:</span> {v || '—'}</p>
                    ))}
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
