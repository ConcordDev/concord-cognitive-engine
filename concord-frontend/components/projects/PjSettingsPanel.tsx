'use client';

/**
 * PjSettingsPanel — labels, custom fields, automation rules and task
 * templates for a project.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2, Tag, ListPlus, Zap, FileStack } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface Label { id: string; name: string; color: string }
interface CustomField { id: string; name: string; type: string; options: string[] }
interface Rule {
  id: string; name: string; trigger: string; action: string; actionValue: string;
  condition: { field: string; equals: string } | null; enabled: boolean;
}
interface Template { id: string; name: string; taskDefaults: { title: string; points: number }; subtasks: string[] }

const COLORS = ['red', 'orange', 'amber', 'lime', 'emerald', 'teal', 'sky', 'indigo', 'violet', 'pink', 'zinc'];
const TRIGGERS = ['status_changed', 'task_created', 'assigned', 'priority_changed'];
const ACTIONS = ['set_status', 'set_priority', 'set_assignee', 'add_label', 'set_sprint'];

export function PjSettingsPanel({ projectId, onChange }: { projectId: string; onChange: () => void }) {
  const [labels, setLabels] = useState<Label[]>([]);
  const [fields, setFields] = useState<CustomField[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [lForm, setLForm] = useState({ name: '', color: 'indigo' });
  const [fForm, setFForm] = useState({ name: '', type: 'text', options: '' });
  const [rForm, setRForm] = useState({ name: '', trigger: 'status_changed', action: 'set_priority', actionValue: '' });
  const [tForm, setTForm] = useState({ name: '', title: '', points: '', subtasks: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    const [l, f, r, t] = await Promise.all([
      lensRun('projects', 'label-list', { projectId }),
      lensRun('projects', 'custom-field-list', { projectId }),
      lensRun('projects', 'rule-list', { projectId }),
      lensRun('projects', 'template-list', { projectId }),
    ]);
    setLabels(l.data?.result?.labels || []);
    setFields(f.data?.result?.fields || []);
    setRules(r.data?.result?.rules || []);
    setTemplates(t.data?.result?.templates || []);
    setLoading(false);
    onChange();
  }, [projectId, onChange]);

  useEffect(() => { void refresh(); }, [refresh]);

  const addLabel = async () => {
    if (!lForm.name.trim()) return;
    await lensRun('projects', 'label-create', { projectId, name: lForm.name.trim(), color: lForm.color });
    setLForm({ name: '', color: 'indigo' });
    await refresh();
  };
  const addField = async () => {
    if (!fForm.name.trim()) return;
    await lensRun('projects', 'custom-field-create', {
      projectId, name: fForm.name.trim(), type: fForm.type,
      options: fForm.options.split(',').map((x) => x.trim()).filter(Boolean),
    });
    setFForm({ name: '', type: 'text', options: '' });
    await refresh();
  };
  const addRule = async () => {
    if (!rForm.name.trim()) return;
    await lensRun('projects', 'rule-create', {
      projectId, name: rForm.name.trim(), trigger: rForm.trigger,
      action: rForm.action, actionValue: rForm.actionValue.trim(),
    });
    setRForm({ name: '', trigger: 'status_changed', action: 'set_priority', actionValue: '' });
    await refresh();
  };
  const addTemplate = async () => {
    if (!tForm.name.trim()) return;
    await lensRun('projects', 'template-create', {
      projectId, name: tForm.name.trim(),
      taskDefaults: { title: tForm.title.trim() || tForm.name.trim(), points: Number(tForm.points) || 0 },
      subtasks: tForm.subtasks.split(',').map((x) => x.trim()).filter(Boolean),
    });
    setTForm({ name: '', title: '', points: '', subtasks: '' });
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-5">
      {/* Labels */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Tag className="w-3.5 h-3.5 text-indigo-400" /> Labels
        </h3>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <input placeholder="Label name" value={lForm.name} onChange={(e) => setLForm({ ...lForm, name: e.target.value })} className={inp} />
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setLForm({ ...lForm, color: c })}
                className={cn('w-5 h-5 rounded-full', lForm.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-zinc-900' : '')}
                style={{ background: cssColor(c) }} />
            ))}
          </div>
          <button type="button" onClick={addLabel} className={btn}><Plus className="w-3.5 h-3.5" /> Label</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => (
            <span key={l.id} className="flex items-center gap-1 text-[10px] text-white rounded-lg pl-2 pr-1 py-0.5"
              style={{ background: cssColor(l.color) }}>
              {l.name}
              <button type="button" onClick={() => lensRun('projects', 'label-delete', { id: l.id }).then(refresh)}
                className="opacity-70 hover:opacity-100">×</button>
            </span>
          ))}
          {labels.length === 0 && <Empty text="No labels." />}
        </div>
      </section>

      {/* Custom fields */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <ListPlus className="w-3.5 h-3.5 text-indigo-400" /> Custom fields
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Field name" value={fForm.name} onChange={(e) => setFForm({ ...fForm, name: e.target.value })} className={inp} />
          <select value={fForm.type} onChange={(e) => setFForm({ ...fForm, type: e.target.value })} className={inp}>
            {['text', 'number', 'select', 'date'].map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input placeholder="Options (csv, for select)" value={fForm.options}
            onChange={(e) => setFForm({ ...fForm, options: e.target.value })} className={inp} />
          <button type="button" onClick={addField} className={btn}><Plus className="w-3.5 h-3.5" /> Field</button>
        </div>
        {fields.length === 0 ? <Empty text="No custom fields." /> : (
          <ul className="space-y-1">
            {fields.map((f) => (
              <li key={f.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-200 flex-1">{f.name}</span>
                <span className="text-[10px] text-zinc-400">{f.type}{f.options.length ? ` · ${f.options.join('/')}` : ''}</span>
                <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'custom-field-delete', { id: f.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Automation rules */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <Zap className="w-3.5 h-3.5 text-amber-400" /> Automation rules
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Rule name" value={rForm.name} onChange={(e) => setRForm({ ...rForm, name: e.target.value })} className={inp} />
          <select value={rForm.trigger} onChange={(e) => setRForm({ ...rForm, trigger: e.target.value })} className={inp}>
            {TRIGGERS.map((x) => <option key={x} value={x}>when {x.replace(/_/g, ' ')}</option>)}
          </select>
          <select value={rForm.action} onChange={(e) => setRForm({ ...rForm, action: e.target.value })} className={inp}>
            {ACTIONS.map((x) => <option key={x} value={x}>{x.replace(/_/g, ' ')}</option>)}
          </select>
          <input placeholder="Value (e.g. urgent)" value={rForm.actionValue}
            onChange={(e) => setRForm({ ...rForm, actionValue: e.target.value })} className={inp} />
        </div>
        <button type="button" onClick={addRule} className={cn(btn, 'px-3 py-1.5 mb-2')}>
          <Plus className="w-3.5 h-3.5" /> Add rule
        </button>
        {rules.length === 0 ? <Empty text="No automation rules." /> : (
          <ul className="space-y-1">
            {rules.map((r) => (
              <li key={r.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-200 flex-1">
                  {r.name} <span className="text-zinc-400">— when {r.trigger.replace(/_/g, ' ')} → {r.action.replace(/_/g, ' ')} {r.actionValue}</span>
                </span>
                <button type="button" onClick={() => lensRun('projects', 'rule-toggle', { id: r.id, enabled: !r.enabled }).then(refresh)}
                  className={cn('text-[10px] px-1.5 py-0.5 rounded', r.enabled ? 'bg-emerald-900/50 text-emerald-300' : 'bg-zinc-800 text-zinc-400')}>
                  {r.enabled ? 'on' : 'off'}
                </button>
                <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'rule-delete', { id: r.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Templates */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <FileStack className="w-3.5 h-3.5 text-indigo-400" /> Task templates
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
          <input placeholder="Template name" value={tForm.name} onChange={(e) => setTForm({ ...tForm, name: e.target.value })} className={inp} />
          <input placeholder="Task title" value={tForm.title} onChange={(e) => setTForm({ ...tForm, title: e.target.value })} className={inp} />
          <input placeholder="Points" inputMode="numeric" value={tForm.points}
            onChange={(e) => setTForm({ ...tForm, points: e.target.value })} className={inp} />
          <button type="button" onClick={addTemplate} className={btn}><Plus className="w-3.5 h-3.5" /> Template</button>
        </div>
        <input placeholder="Subtasks (comma-separated)" value={tForm.subtasks}
          onChange={(e) => setTForm({ ...tForm, subtasks: e.target.value })} className={cn(inp, 'w-full mb-2')} />
        {templates.length === 0 ? <Empty text="No templates." /> : (
          <ul className="space-y-1">
            {templates.map((t) => (
              <li key={t.id} className="flex items-center gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                <span className="text-xs text-zinc-200 flex-1">{t.name}
                  <span className="text-[10px] text-zinc-400"> · {t.subtasks.length} subtasks</span>
                </span>
                <button type="button" onClick={() => lensRun('projects', 'template-apply', { id: t.id }).then(refresh)}
                  className="text-[10px] px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded">Apply</button>
                <button aria-label="Delete" type="button" onClick={() => lensRun('projects', 'template-delete', { id: t.id }).then(refresh)}
                  className="text-zinc-600 hover:text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

const inp = 'bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100';
const btn = 'flex items-center justify-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg';
function Empty({ text }: { text: string }) {
  return <p className="text-[11px] text-zinc-400 italic">{text}</p>;
}
function cssColor(c: string): string {
  const map: Record<string, string> = {
    red: '#dc2626', orange: '#ea580c', amber: '#d97706', lime: '#65a30d', emerald: '#059669',
    teal: '#0d9488', sky: '#0284c7', indigo: '#4f46e5', violet: '#7c3aed', pink: '#db2777', zinc: '#52525b',
  };
  return map[c] || '#52525b';
}
