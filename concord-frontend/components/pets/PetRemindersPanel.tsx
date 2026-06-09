'use client';

/**
 * PetRemindersPanel — reminders, documents and expenses for the
 * selected pet.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, BellRing, FileText, Receipt, Trash2, Check } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Reminder { id: string; title: string; kind: string; dueDate: string | null; done: boolean; status: string }
interface PetDocument { id: string; title: string; kind: string }

const STATUS_COLOR: Record<string, string> = {
  overdue: 'text-rose-400', due_soon: 'text-amber-400', scheduled: 'text-emerald-400', done: 'text-zinc-400', none: 'text-zinc-400',
};

export function PetRemindersPanel({ petId, onChange }: { petId: string; onChange: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [documents, setDocuments] = useState<PetDocument[]>([]);
  const [expenses, setExpenses] = useState<{ total: number; thisMonth: number; byCategory: Record<string, number> }>({ total: 0, thisMonth: 0, byCategory: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rem, setRem] = useState({ title: '', kind: 'general', dueDate: '' });
  const [doc, setDoc] = useState({ title: '', kind: 'medical' });
  const [exp, setExp] = useState({ category: 'food', amount: '', note: '' });

  const refresh = useCallback(async () => {
    if (!petId) return;
    setLoading(true);
    const [r, d, e] = await Promise.all([
      lensRun('pets', 'reminder-list', { petId }),
      lensRun('pets', 'document-list', { petId }),
      lensRun('pets', 'expense-summary', { petId }),
    ]);
    setReminders(r.data?.result?.reminders || []);
    setDocuments(d.data?.result?.documents || []);
    setExpenses({
      total: e.data?.result?.total || 0,
      thisMonth: e.data?.result?.thisMonth || 0,
      byCategory: e.data?.result?.byCategory || {},
    });
    setLoading(false);
  }, [petId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addReminder = async () => {
    if (!rem.title.trim()) { setError('Reminder title is required.'); return; }
    const r = await lensRun('pets', 'reminder-create', { petId, title: rem.title.trim(), kind: rem.kind, dueDate: rem.dueDate });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setRem({ title: '', kind: 'general', dueDate: '' });
    setError(null);
    await refresh(); onChange();
  };
  const toggleReminder = async (rm: Reminder) => {
    await lensRun('pets', 'reminder-complete', { petId, id: rm.id, reopen: rm.done });
    await refresh(); onChange();
  };
  const delReminder = async (id: string) => { await lensRun('pets', 'reminder-delete', { petId, id }); await refresh(); onChange(); };

  const addDoc = async () => {
    if (!doc.title.trim()) { setError('Document title is required.'); return; }
    const r = await lensRun('pets', 'document-add', { petId, title: doc.title.trim(), kind: doc.kind });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setDoc({ title: '', kind: 'medical' });
    setError(null);
    await refresh();
  };

  const addExpense = async () => {
    const amount = Number(exp.amount);
    if (!amount || amount <= 0) { setError('Expense amount must be greater than zero.'); return; }
    const r = await lensRun('pets', 'expense-log', { petId, category: exp.category, amount, note: exp.note.trim() });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setExp({ category: 'food', amount: '', note: '' });
    setError(null);
    await refresh(); onChange();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Reminders */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <BellRing className="w-3.5 h-3.5 text-teal-400" /> Reminders
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Title" value={rem.title} onChange={(e) => setRem({ ...rem, title: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={rem.kind} onChange={(e) => setRem({ ...rem, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['general', 'vaccine', 'medication', 'grooming', 'vet', 'flea_tick'].map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
          </select>
          <input type="date" value={rem.dueDate} onChange={(e) => setRem({ ...rem, dueDate: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addReminder}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {reminders.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No reminders.</p>
        ) : (
          <ul className="space-y-1">
            {reminders.map((rm) => (
              <li key={rm.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <button type="button" onClick={() => toggleReminder(rm)}
                  className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                    rm.done ? 'bg-teal-600 border-teal-600' : 'border-zinc-600')}>
                  {rm.done && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className={cn('flex-1 text-xs', rm.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{rm.title}</span>
                <span className={cn('text-[10px]', STATUS_COLOR[rm.status] || 'text-zinc-400')}>
                  {rm.dueDate || 'no date'}
                </span>
                <button aria-label="Delete" type="button" onClick={() => delReminder(rm.id)} className="text-zinc-600 hover:text-rose-400">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Documents */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <FileText className="w-3.5 h-3.5 text-teal-400" /> Documents
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <input placeholder="Document title" value={doc.title} onChange={(e) => setDoc({ ...doc, title: e.target.value })}
            className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <select value={doc.kind} onChange={(e) => setDoc({ ...doc, kind: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['medical', 'legal', 'insurance', 'pedigree', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button type="button" onClick={addDoc}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        {documents.length === 0 ? (
          <p className="text-[11px] text-zinc-400 italic">No documents.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {documents.map((d) => (
              <li key={d.id} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border border-zinc-700 text-zinc-300">
                <FileText className="w-3 h-3 text-zinc-400" /> {d.title} <span className="text-zinc-600">· {d.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Expenses */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Receipt className="w-3.5 h-3.5 text-teal-400" /> Expenses
          <span className="text-[10px] text-zinc-400">· ${expenses.total} all-time · ${expenses.thisMonth} this month</span>
        </h3>
        <div className="grid grid-cols-4 gap-2 mb-2">
          <select value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
            {['food', 'vet', 'grooming', 'toys', 'insurance', 'boarding', 'other'].map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <input placeholder="Amount ($)" inputMode="decimal" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <input placeholder="Note" value={exp.note} onChange={(e) => setExp({ ...exp, note: e.target.value })}
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          <button type="button" onClick={addExpense}
            className="flex items-center justify-center gap-1 bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium rounded-lg">
            <Plus className="w-3.5 h-3.5" /> Log
          </button>
        </div>
        {Object.keys(expenses.byCategory).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(expenses.byCategory).map(([cat, amt]) => (
              <span key={cat} className="text-[11px] px-2 py-0.5 rounded-full border border-zinc-700 text-zinc-300 capitalize">
                {cat}: ${amt}
              </span>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
