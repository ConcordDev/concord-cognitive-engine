'use client';

/**
 * MarketingContentPanel — content calendar and A/B tests.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, CalendarRange, FlaskConical, Trash2, Trophy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Content { id: string; title: string; channel: string; type: string; scheduledDate: string | null; status: string }
interface Variant { label: string; visitors: number; conversions: number; conversionRate: number }
interface AbTest { id: string; name: string; variantA: Variant; variantB: Variant; winner: string | null; liftPct: number }

const STATUS_FLOW: Record<string, string> = { draft: 'scheduled', scheduled: 'published' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'text-zinc-400', scheduled: 'text-amber-400', published: 'text-emerald-400', archived: 'text-zinc-600',
};

export function MarketingContentPanel({ onChange }: { onChange: () => void }) {
  const [content, setContent] = useState<Content[]>([]);
  const [tests, setTests] = useState<AbTest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cForm, setCForm] = useState({ title: '', channel: 'content', type: 'post', scheduledDate: '' });
  const [tForm, setTForm] = useState({ name: '', variantA: '', variantB: '' });
  const [recordForm, setRecordForm] = useState<Record<string, { visitors: string; conversions: string }>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [c, t] = await Promise.all([
      lensRun('marketing', 'content-list', {}),
      lensRun('marketing', 'abtest-list', {}),
    ]);
    setContent(c.data?.result?.content || []);
    setTests(t.data?.result?.tests || []);
    setLoading(false);
    onChange();
  }, [onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addContent = async () => {
    if (!cForm.title.trim()) { setError('Content title is required.'); return; }
    const r = await lensRun('marketing', 'content-add', {
      title: cForm.title.trim(), channel: cForm.channel, type: cForm.type, scheduledDate: cForm.scheduledDate,
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setCForm({ title: '', channel: 'content', type: 'post', scheduledDate: '' });
    setError(null);
    await refresh();
  };
  const advanceContent = async (c: Content) => {
    const next = STATUS_FLOW[c.status];
    if (!next) return;
    await lensRun('marketing', 'content-update-status', { id: c.id, status: next });
    await refresh();
  };
  const delContent = async (id: string) => { await lensRun('marketing', 'content-delete', { id }); await refresh(); };

  const createTest = async () => {
    if (!tForm.name.trim()) { setError('Test name is required.'); return; }
    const r = await lensRun('marketing', 'abtest-create', {
      name: tForm.name.trim(), variantA: tForm.variantA.trim(), variantB: tForm.variantB.trim(),
    });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setTForm({ name: '', variantA: '', variantB: '' });
    setError(null);
    await refresh();
  };
  const record = async (testId: string, variant: 'a' | 'b') => {
    const key = `${testId}-${variant}`;
    const f = recordForm[key] || { visitors: '', conversions: '' };
    await lensRun('marketing', 'abtest-record', {
      id: testId, variant, visitors: Number(f.visitors) || 0, conversions: Number(f.conversions) || 0,
    });
    setRecordForm((p) => ({ ...p, [key]: { visitors: '', conversions: '' } }));
    await refresh();
  };
  const delTest = async (id: string) => { await lensRun('marketing', 'abtest-delete', { id }); await refresh(); };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Content calendar */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <CalendarRange className="w-3.5 h-3.5 text-orange-400" /> Content calendar
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Title" value={cForm.title} onChange={(e) => setCForm({ ...cForm, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input type="date" value={cForm.scheduledDate} onChange={(e) => setCForm({ ...cForm, scheduledDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addContent}
            className="flex items-center justify-center gap-1 bg-orange-600 hover:bg-orange-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {content.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No content scheduled.</p>
        ) : (
          <ul className="space-y-1">
            {content.map((c) => (
              <li key={c.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <div>
                  <p className="text-xs text-zinc-200">{c.title}</p>
                  <p className="text-[10px] text-zinc-400 capitalize">{c.channel} · {c.scheduledDate || 'unscheduled'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn('text-[10px] uppercase', STATUS_COLOR[c.status])}>{c.status}</span>
                  {STATUS_FLOW[c.status] && (
                    <button type="button" onClick={() => advanceContent(c)}
                      className="text-[10px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg capitalize">
                      → {STATUS_FLOW[c.status]}
                    </button>
                  )}
                  <button aria-label="Delete" type="button" onClick={() => delContent(c.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A/B tests */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <FlaskConical className="w-3.5 h-3.5 text-orange-400" /> A/B tests
        </h3>
        <div className="grid grid-cols-3 gap-2 mb-2">
          <input placeholder="Test name" value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Variant A" value={tForm.variantA} onChange={(e) => setTForm({ ...tForm, variantA: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Variant B" value={tForm.variantB} onChange={(e) => setTForm({ ...tForm, variantB: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
        </div>
        <button type="button" onClick={createTest}
          className="mb-2 flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-orange-600 hover:bg-orange-500 text-white rounded-lg">
          <Plus className="w-3.5 h-3.5" /> Create test
        </button>
        {tests.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No A/B tests.</p>
        ) : (
          <ul className="space-y-2">
            {tests.map((t) => (
              <li key={t.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-sm font-semibold text-zinc-100">{t.name}</p>
                  <div className="flex items-center gap-2">
                    {t.winner && (
                      <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                        <Trophy className="w-3 h-3" />{t.winner === 'a' ? t.variantA.label : t.variantB.label} +{t.liftPct}%
                      </span>
                    )}
                    <button aria-label="Delete" type="button" onClick={() => delTest(t.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {(['a', 'b'] as const).map((v) => {
                  const variant = v === 'a' ? t.variantA : t.variantB;
                  const key = `${t.id}-${v}`;
                  const f = recordForm[key] || { visitors: '', conversions: '' };
                  return (
                    <div key={v} className={cn('flex items-center gap-1 mb-1 px-2 py-1 rounded',
                      t.winner === v ? 'bg-emerald-950/40' : '')}>
                      <span className="w-24 text-[11px] text-zinc-300 truncate">{variant.label}</span>
                      <span className="text-[11px] text-zinc-400 w-20">{variant.conversionRate}% conv.</span>
                      <input placeholder="visitors" inputMode="numeric" value={f.visitors}
                        onChange={(e) => setRecordForm((p) => ({ ...p, [key]: { ...f, visitors: e.target.value } }))}
                        className="w-20 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                      <input placeholder="conv." inputMode="numeric" value={f.conversions}
                        onChange={(e) => setRecordForm((p) => ({ ...p, [key]: { ...f, conversions: e.target.value } }))}
                        className="w-16 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-100" />
                      <button type="button" onClick={() => record(t.id, v)}
                        className="px-1.5 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded">Add</button>
                    </div>
                  );
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
