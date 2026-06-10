'use client';

/**
 * IntakeFormsPanel — Clio-parity client intake.
 *
 * Build reusable intake forms with custom fields; a prospect submits
 * responses; a submission converts to a real client contact + open matter
 * in one call. All data is real user input — no seeds.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ClipboardList, Loader2, Plus, Trash2, Send, UserPlus, X, ChevronRight,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface FormField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
}
interface IntakeForm {
  id: string;
  number: string;
  name: string;
  matterType: string;
  description: string;
  fields: FormField[];
  status: string;
  submissionCount: number;
  newCount: number;
  createdAt: string;
}
interface IntakeSubmission {
  id: string;
  number: string;
  formId: string;
  formName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  matterType: string;
  answers: Record<string, string>;
  status: string;
  convertedMatterId: string | null;
  createdAt: string;
}

const FIELD_TYPES = ['text', 'textarea', 'email', 'phone', 'date', 'number', 'select', 'checkbox'];
const MATTER_TYPES = [
  'litigation', 'transactional', 'family', 'probate', 'criminal', 'employment',
  'ip', 'real_estate', 'corporate', 'immigration', 'tax', 'bankruptcy', 'other',
];

interface DraftField {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string;
}

const blankField = (): DraftField => ({ key: '', label: '', type: 'text', required: false, options: '' });

export function IntakeFormsPanel() {
  const [forms, setForms] = useState<IntakeForm[]>([]);
  const [submissions, setSubmissions] = useState<IntakeSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selectedForm, setSelectedForm] = useState<IntakeForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Form-builder draft
  const [formName, setFormName] = useState('');
  const [formMatterType, setFormMatterType] = useState('other');
  const [formDescription, setFormDescription] = useState('');
  const [draftFields, setDraftFields] = useState<DraftField[]>([blankField()]);

  // Submission draft (filling out a form)
  const [submitting, setSubmitting] = useState(false);
  const [subAnswers, setSubAnswers] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fr = await lensRun({ domain: 'legal', action: 'intake-forms-list', input: {} });
      const sr = await lensRun({ domain: 'legal', action: 'intake-submissions-list', input: {} });
      setForms((fr.data?.result?.forms || []) as IntakeForm[]);
      setSubmissions((sr.data?.result?.submissions || []) as IntakeSubmission[]);
    } catch (e) {
      console.error('[IntakeForms] refresh failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function createForm() {
    setError(null);
    if (!formName.trim()) { setError('Form name is required.'); return; }
    const fields = draftFields
      .filter((f) => f.label.trim())
      .map((f) => ({
        key: f.key.trim() || f.label.trim(),
        label: f.label.trim(),
        type: f.type,
        required: f.required,
        options: f.options.split(',').map((s) => s.trim()).filter(Boolean),
      }));
    if (fields.length === 0) { setError('Add at least one field with a label.'); return; }
    try {
      const r = await lensRun({
        domain: 'legal', action: 'intake-forms-create',
        input: { name: formName.trim(), matterType: formMatterType, description: formDescription.trim(), fields },
      });
      if (r.data?.ok === false) { setError(r.data.error || 'Could not create form.'); return; }
      setFormName(''); setFormMatterType('other'); setFormDescription(''); setDraftFields([blankField()]);
      setCreating(false);
      await refresh();
    } catch (e) {
      console.error('[IntakeForms] create failed', e);
      setError('Could not create form.');
    }
  }

  async function deleteForm(id: string) {
    if (!confirm('Delete this intake form?')) return;
    try {
      await lensRun({ domain: 'legal', action: 'intake-forms-delete', input: { id } });
      if (selectedForm?.id === id) setSelectedForm(null);
      await refresh();
    } catch (e) {
      console.error('[IntakeForms] delete failed', e);
    }
  }

  async function submitIntake() {
    if (!selectedForm) return;
    setError(null);
    try {
      const r = await lensRun({
        domain: 'legal', action: 'intake-submit',
        input: { formId: selectedForm.id, answers: subAnswers },
      });
      if (r.data?.ok === false) { setError(r.data.error || 'Submission failed.'); return; }
      setSubAnswers({});
      setSubmitting(false);
      await refresh();
    } catch (e) {
      console.error('[IntakeForms] submit failed', e);
      setError('Submission failed.');
    }
  }

  async function convert(sub: IntakeSubmission) {
    if (!confirm(`Convert "${sub.contactName}" into a client contact + open matter?`)) return;
    try {
      const r = await lensRun({ domain: 'legal', action: 'intake-convert', input: { id: sub.id } });
      if (r.data?.ok === false) { setError(r.data.error || 'Conversion failed.'); return; }
      await refresh();
    } catch (e) {
      console.error('[IntakeForms] convert failed', e);
    }
  }

  function updateDraftField(i: number, patch: Partial<DraftField>) {
    setDraftFields((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 text-xs rounded bg-rose-500/10 border border-rose-500/30 text-rose-200">
          <X className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {/* Forms list */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Client Intake Forms</span>
          <span className="text-[10px] text-gray-400">{forms.length}</span>
          <button
            onClick={() => { setCreating((v) => !v); setError(null); }}
            className="ml-auto px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />New form
          </button>
        </header>

        {creating && (
          <div className="px-4 py-3 border-b border-white/10 space-y-2">
            <div className="grid grid-cols-12 gap-2">
              <input
                value={formName} onChange={(e) => setFormName(e.target.value)}
                placeholder="Form name * (e.g. Personal Injury Intake)"
                className="col-span-7 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
              <select
                value={formMatterType} onChange={(e) => setFormMatterType(e.target.value)}
                className="col-span-5 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              >
                {MATTER_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
              </select>
              <textarea
                value={formDescription} onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Description shown to the prospect" rows={2}
                className="col-span-12 px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
              />
            </div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold pt-1">Fields</div>
            {draftFields.map((f, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <input
                  value={f.label} onChange={(e) => updateDraftField(i, { label: e.target.value })}
                  placeholder="Label *"
                  className="col-span-4 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <select
                  value={f.type} onChange={(e) => updateDraftField(i, { type: e.target.value })}
                  className="col-span-2 px-1.5 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                >
                  {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                {f.type === 'select' ? (
                  <input
                    value={f.options} onChange={(e) => updateDraftField(i, { options: e.target.value })}
                    placeholder="Options (comma-separated)"
                    className="col-span-4 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                  />
                ) : (
                  <div className="col-span-4" />
                )}
                <label className="col-span-1 flex items-center gap-1 text-[10px] text-gray-400">
                  <input type="checkbox" checked={f.required} onChange={(e) => updateDraftField(i, { required: e.target.checked })} />
                  Req
                </label>
                <button
                  aria-label="Remove field"
                  onClick={() => setDraftFields((prev) => prev.filter((_, idx) => idx !== i))}
                  className="col-span-1 p-1 rounded hover:bg-rose-500/20 text-rose-300 justify-self-end"
                  disabled={draftFields.length === 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDraftFields((prev) => [...prev, blankField()])}
                className="px-2 py-1 text-[10px] rounded border border-white/15 text-gray-300 hover:bg-white/5 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" />Add field
              </button>
              <button
                onClick={createForm}
                className="ml-auto px-3 py-1.5 text-xs rounded bg-amber-500 text-black font-bold hover:bg-amber-400"
              >
                Publish form
              </button>
            </div>
          </div>
        )}

        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-xs text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
            </div>
          ) : forms.length === 0 ? (
            <div className="px-3 py-10 text-center text-xs text-gray-400">
              <ClipboardList className="w-6 h-6 mx-auto mb-2 opacity-30" />
              No intake forms yet. Build one to capture prospective clients.
            </div>
          ) : (
            <ul className="divide-y divide-white/5">
              {forms.map((f) => (
                <li
                  key={f.id}
                  className={cn(
                    'px-4 py-2.5 hover:bg-white/[0.02] group flex items-center gap-3 cursor-pointer',
                    selectedForm?.id === f.id && 'bg-amber-500/[0.06]',
                  )}
                  onClick={() => { setSelectedForm(f); setSubAnswers({}); setSubmitting(false); }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate flex items-center gap-2">
                      {f.name}
                      <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-white/5 text-gray-400">{f.matterType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      <span className="font-mono">{f.number}</span>
                      <span> · {f.fields.length} field(s)</span>
                      <span> · {f.submissionCount} submission(s)</span>
                      {f.newCount > 0 && <span className="text-amber-300"> · {f.newCount} new</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-3.5 h-3.5 text-gray-600" />
                  <button aria-label="Delete"
                    onClick={(e) => { e.stopPropagation(); deleteForm(f.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-rose-500/20 text-rose-300"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Submission form (fill out selected form) */}
      {selectedForm && (
        <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
          <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-gray-200">Submit: {selectedForm.name}</span>
            <button
              onClick={() => setSubmitting((v) => !v)}
              className="ml-auto px-2.5 py-1 text-xs rounded bg-emerald-500 text-black font-semibold hover:bg-emerald-400"
            >
              {submitting ? 'Cancel' : 'Fill out'}
            </button>
          </header>
          {submitting && (
            <div className="px-4 py-3 space-y-2">
              {selectedForm.description && (
                <p className="text-xs text-gray-400">{selectedForm.description}</p>
              )}
              {selectedForm.fields.map((field) => (
                <div key={field.key} className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                    {field.label}{field.required && <span className="text-rose-400"> *</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={2}
                      value={subAnswers[field.key] || ''}
                      onChange={(e) => setSubAnswers((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={subAnswers[field.key] || ''}
                      onChange={(e) => setSubAnswers((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    >
                      <option value="">— select —</option>
                      {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : field.type === 'checkbox' ? (
                    <input
                      type="checkbox"
                      checked={subAnswers[field.key] === 'yes'}
                      onChange={(e) => setSubAnswers((p) => ({ ...p, [field.key]: e.target.checked ? 'yes' : '' }))}
                    />
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                      value={subAnswers[field.key] || ''}
                      onChange={(e) => setSubAnswers((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                    />
                  )}
                </div>
              ))}
              <button
                onClick={submitIntake}
                className="w-full px-3 py-1.5 text-xs rounded bg-emerald-500 text-black font-bold hover:bg-emerald-400"
              >
                Submit intake
              </button>
            </div>
          )}
        </div>
      )}

      {/* Submissions */}
      <div className="bg-[#0d1117] border border-amber-500/15 rounded-lg overflow-hidden">
        <header className="px-4 py-2.5 border-b border-white/10 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-amber-400" />
          <span className="text-sm font-semibold text-gray-200">Submissions</span>
          <span className="text-[10px] text-gray-400">{submissions.length}</span>
        </header>
        <div className="max-h-72 overflow-y-auto">
          {submissions.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-gray-400">No submissions yet.</div>
          ) : (
            <ul className="divide-y divide-white/5">
              {submissions.map((sub) => (
                <li key={sub.id} className="px-4 py-2.5 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white truncate flex items-center gap-2">
                      {sub.contactName}
                      <span className={cn(
                        'text-[9px] uppercase px-1.5 py-0.5 rounded',
                        sub.status === 'converted' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300',
                      )}>{sub.status}</span>
                    </div>
                    <div className="text-[10px] text-gray-400 truncate">
                      <span className="font-mono">{sub.number}</span>
                      <span> · {sub.formName}</span>
                      {sub.contactEmail && <span> · {sub.contactEmail}</span>}
                    </div>
                  </div>
                  {sub.status === 'new' ? (
                    <button
                      onClick={() => convert(sub)}
                      className="px-2.5 py-1 text-xs rounded bg-amber-500 text-black font-semibold hover:bg-amber-400 inline-flex items-center gap-1"
                    >
                      <UserPlus className="w-3 h-3" />Convert
                    </button>
                  ) : (
                    <span className="text-[10px] text-emerald-300">Matter opened</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export default IntakeFormsPanel;
