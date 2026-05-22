'use client';

/**
 * MhSafetyPlanPanel — personalized crisis coping plan based on the
 * Stanley-Brown Safety Planning Intervention. Each section holds a list
 * of the user's own items; the saved plan is shown read-first so it is
 * usable in a crisis.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Plus, Trash2, Pencil, Phone } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Section { key: string; label: string }
interface Plan { sections: Record<string, string[]>; sectionsFilled: number; totalSections: number; updatedAt: string }
interface CrisisLine { name: string; phone: string; text: string }
interface PlanResult { plan: Plan | null; sections: Section[]; hasPlan: boolean }
interface TemplateResult { sections: Section[]; crisisLine: CrisisLine; note: string }

export function MhSafetyPlanPanel() {
  const [sections, setSections] = useState<Section[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [crisisLine, setCrisisLine] = useState<CrisisLine | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    const [g, t] = await Promise.all([
      lensRun('mental-health', 'safety-plan-get', {}),
      lensRun('mental-health', 'safety-plan-template', {}),
    ]);
    const got = g.data?.result as PlanResult | null;
    const tpl = t.data?.result as TemplateResult | null;
    setSections(got?.sections || tpl?.sections || []);
    setPlan(got?.plan || null);
    setCrisisLine(tpl?.crisisLine || null);
    setNote(tpl?.note || '');
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const startEdit = () => {
    const d: Record<string, string[]> = {};
    for (const s of sections) d[s.key] = [...(plan?.sections[s.key] || []), ''];
    setDraft(d);
    setEditing(true);
  };

  const setItem = (key: string, idx: number, val: string) => {
    setDraft((p) => ({ ...p, [key]: (p[key] || []).map((x, i) => (i === idx ? val : x)) }));
  };
  const addItem = (key: string) => setDraft((p) => ({ ...p, [key]: [...(p[key] || []), ''] }));
  const removeItem = (key: string, idx: number) => setDraft((p) => ({ ...p, [key]: (p[key] || []).filter((_, i) => i !== idx) }));

  const save = async () => {
    const cleaned: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(draft)) cleaned[k] = v.map((x) => x.trim()).filter(Boolean);
    const r = await lensRun('mental-health', 'safety-plan-save', { sections: cleaned });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setError(null); setEditing(false);
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
          <ShieldCheck className="w-3.5 h-3.5 text-sky-400" /> Safety plan
        </h3>
        {!editing && (
          <button type="button" onClick={startEdit}
            className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300">
            <Pencil className="w-3 h-3" /> {plan ? 'Edit' : 'Build plan'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {crisisLine && (
        <div className="flex items-center gap-2 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          <Phone className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-[11px] text-rose-200">
            In a crisis: <strong>{crisisLine.name}</strong> — call or text <strong>{crisisLine.phone}</strong>.
          </p>
        </div>
      )}

      {note && !editing && <p className="text-[11px] text-zinc-500 italic">{note}</p>}

      {editing ? (
        <div className="space-y-3">
          {sections.map((s) => (
            <div key={s.key} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <p className="text-[11px] font-semibold text-zinc-300 mb-1.5">{s.label}</p>
              <div className="space-y-1.5">
                {(draft[s.key] || []).map((item, i) => (
                  <div key={i} className="flex gap-1">
                    <input value={item} onChange={(e) => setItem(s.key, i, e.target.value)}
                      placeholder="Add an item…"
                      className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
                    <button type="button" onClick={() => removeItem(s.key, i)}
                      className="text-zinc-500 hover:text-rose-400" aria-label="Remove item"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <button type="button" onClick={() => addItem(s.key)}
                  className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300">
                  <Plus className="w-3 h-3" /> Add line
                </button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={save}
              className="flex-1 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 text-white rounded-lg">Save plan</button>
            <button type="button" onClick={() => setEditing(false)}
              className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg">Cancel</button>
          </div>
        </div>
      ) : !plan ? (
        <p className="text-[11px] text-zinc-500 italic py-4 text-center">
          No safety plan yet. Build one while you feel calm, so it is ready if you ever need it.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-zinc-500">
            {plan.sectionsFilled}/{plan.totalSections} sections · updated {plan.updatedAt.slice(0, 10)}
          </p>
          {sections.map((s) => {
            const items = plan.sections[s.key] || [];
            if (!items.length) return null;
            return (
              <div key={s.key} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                <p className="text-[11px] font-semibold text-zinc-300 mb-1">{s.label}</p>
                <ul className="space-y-0.5">
                  {items.map((it, i) => (
                    <li key={i} className="text-xs text-zinc-200 flex items-start gap-1.5">
                      <span className="text-sky-500 mt-0.5">›</span> {it}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
