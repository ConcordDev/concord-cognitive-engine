'use client';

/**
 * MhWorksheetsPanel — guided CBT/DBT exercise modules: thought records,
 * cognitive reframing, Check the Facts, Opposite Action. Fill a template,
 * save it, and review completed worksheets.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ClipboardList, Trash2, ChevronDown } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface TplField { key: string; label: string; type: string }
interface Template { id: string; title: string; modality: string; fieldCount: number; fields: TplField[] }
interface Worksheet { id: string; templateId: string; title: string; modality: string; responses: Record<string, string | null>; answered: number; totalFields: number; date: string }

export function MhWorksheetsPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTpl, setActiveTpl] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [openWs, setOpenWs] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, w] = await Promise.all([
      lensRun('mental-health', 'worksheet-templates', {}),
      lensRun('mental-health', 'worksheet-list', {}),
    ]);
    setTemplates(t.data?.result?.templates || []);
    setWorksheets(w.data?.result?.worksheets || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const tpl = templates.find((x) => x.id === activeTpl) || null;

  const save = async () => {
    if (!tpl) return;
    setSaving(true);
    const r = await lensRun('mental-health', 'worksheet-save', { templateId: tpl.id, responses });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setSaving(false); return; }
    setResponses({}); setActiveTpl(null); setError(null);
    await refresh();
    setSaving(false);
  };

  const del = async (id: string) => {
    await lensRun('mental-health', 'worksheet-delete', { id });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ClipboardList className="w-3.5 h-3.5 text-sky-400" /> Guided exercises
        </h3>
        {!tpl ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {templates.map((t) => (
              <button key={t.id} type="button" onClick={() => { setActiveTpl(t.id); setResponses({}); }}
                className="bg-zinc-900/70 border border-zinc-800 hover:border-sky-700 rounded-xl p-3 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-zinc-100">{t.title}</span>
                  <span className="text-[10px] font-mono rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">{t.modality}</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">{t.fieldCount} steps</p>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-100">{tpl.title}</span>
              <button type="button" onClick={() => { setActiveTpl(null); setResponses({}); }}
                className="text-[11px] text-zinc-400 hover:text-zinc-300">Cancel</button>
            </div>
            {tpl.fields.map((f) => (
              <label key={f.key} className="block">
                <span className="text-[11px] text-zinc-400">{f.label}</span>
                <textarea value={responses[f.key] || ''}
                  onChange={(e) => setResponses((p) => ({ ...p, [f.key]: e.target.value }))}
                  rows={2}
                  className="w-full mt-0.5 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 resize-y" />
              </label>
            ))}
            <button type="button" onClick={save} disabled={saving}
              className="w-full px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
              {saving ? 'Saving…' : 'Save worksheet'}
            </button>
          </div>
        )}
      </section>

      <section>
        <h3 className="text-xs font-semibold text-zinc-300 mb-2">Completed ({worksheets.length})</h3>
        {worksheets.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No worksheets completed yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {worksheets.map((w) => {
              const open = openWs === w.id;
              return (
                <li key={w.id} className="bg-zinc-900/70 border border-zinc-800 rounded-lg">
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button type="button" onClick={() => setOpenWs(open ? null : w.id)}
                      className="flex items-center gap-2 flex-1 text-left">
                      <ChevronDown className={cn('w-3.5 h-3.5 text-zinc-400 transition-transform', open && 'rotate-180')} />
                      <span className="text-xs text-zinc-200">{w.title}</span>
                      <span className="text-[10px] text-zinc-400">{w.date}</span>
                      <span className="text-[10px] text-zinc-400">{w.answered}/{w.totalFields}</span>
                    </button>
                    <button type="button" onClick={() => del(w.id)} className="text-zinc-400 hover:text-rose-400" aria-label="Delete worksheet">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {open && (
                    <div className="px-3 pb-3 space-y-1.5 border-t border-zinc-800 pt-2">
                      {Object.entries(w.responses).filter(([, v]) => v).map(([k, v]) => (
                        <div key={k}>
                          <p className="text-[10px] text-zinc-400 uppercase">{k}</p>
                          <p className="text-xs text-zinc-200">{v}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
