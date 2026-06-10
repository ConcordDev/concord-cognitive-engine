'use client';

/**
 * BoardSettingsPanel — manages a board's labels, automation rules,
 * collaborators, and custom fields. Every action calls a real board.*
 * macro and re-pulls the board detail afterwards. No mock data.
 */

import { useState } from 'react';
import { Tag, Zap, Users, Sliders, Plus, Trash2, X } from 'lucide-react';
import {
  boardMacro,
  WsBoard,
  LABEL_COLORS,
  LABEL_COLOR_DOT,
} from './workspace-types';

const AUTO_ACTIONS = [
  { id: 'check-all-checklist', label: 'Check all checklist items' },
  { id: 'clear-due', label: 'Clear the due date' },
  { id: 'add-label', label: 'Add a label', needsValue: true },
  { id: 'set-assignee', label: 'Set the assignee', needsValue: true },
];
const COLLAB_ROLES = ['viewer', 'editor', 'admin'];
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'checkbox'];

export function BoardSettingsPanel({
  board,
  owner,
  onClose,
  onChanged,
}: {
  board: WsBoard;
  owner: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'labels' | 'automation' | 'collab' | 'fields'>('labels');
  const [err, setErr] = useState<string | null>(null);

  // labels
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('blue');
  // automation
  const [autoCol, setAutoCol] = useState('');
  const [autoAction, setAutoAction] = useState('check-all-checklist');
  const [autoValue, setAutoValue] = useState('');
  // collab
  const [collabUser, setCollabUser] = useState('');
  const [collabRole, setCollabRole] = useState('viewer');
  // fields
  const [fieldName, setFieldName] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [fieldOptions, setFieldOptions] = useState('');

  const run = async (
    macro: string,
    params: Record<string, unknown>,
    reset?: () => void
  ) => {
    setErr(null);
    const r = await boardMacro(macro, params);
    if (r.ok) {
      reset?.();
      onChanged();
    } else {
      setErr(r.error || `${macro} failed`);
    }
  };

  const labels = board.labelDefs || [];
  const automations = board.automations || [];
  const collaborators = board.collaborators || [];
  const fields = board.customFields || [];
  const colName = (id: string) => board.columns.find((c) => c.id === id)?.name || id;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
      <div
        className="w-full max-w-xl rounded-xl border border-white/10 bg-gray-950 shadow-2xl my-8"
        onClick={(e) => e.stopPropagation()} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h2 className="text-lg font-bold text-white">Board Settings</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-white/10 text-gray-400 hover:text-white"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex border-b border-white/10 px-5">
          {(
            [
              { id: 'labels', label: 'Labels', icon: Tag },
              { id: 'automation', label: 'Automation', icon: Zap },
              { id: 'collab', label: 'Sharing', icon: Users },
              { id: 'fields', label: 'Fields', icon: Sliders },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? 'border-purple-500 text-purple-300'
                  : 'border-transparent text-gray-400 hover:text-gray-300'
              }`}
            >
              <t.icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-5 py-4 space-y-4">
          {err && <p className="text-xs text-red-400">{err}</p>}

          {/* LABELS */}
          {tab === 'labels' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {labels.length === 0 && (
                  <p className="text-xs text-gray-400">No labels defined yet.</p>
                )}
                {labels.map((l) => (
                  <div
                    key={l.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]"
                  >
                    <span
                      className={`w-3 h-3 rounded-full ${LABEL_COLOR_DOT[l.color] || 'bg-gray-500'}`}
                    />
                    <span className="text-sm text-gray-300 flex-1">{l.name}</span>
                    <button
                      onClick={() => run('label-delete', { boardId: board.id, labelId: l.id })}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete label"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                <div className="flex gap-1">
                  {LABEL_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setLabelColor(c)}
                      className={`w-6 h-6 rounded ${LABEL_COLOR_DOT[c]} ${
                        labelColor === c ? 'ring-2 ring-white' : 'opacity-60'
                      }`}
                      aria-label={`${c} label color`}
                    />
                  ))}
                </div>
                <input
                  type="text"
                  value={labelName}
                  onChange={(e) => setLabelName(e.target.value)}
                  placeholder="Label name"
                  className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                />
                <button aria-label="Create label"
                  onClick={() =>
                    labelName.trim() &&
                    run(
                      'label-create',
                      { boardId: board.id, name: labelName.trim(), color: labelColor },
                      () => setLabelName('')
                    )
                  }
                  disabled={!labelName.trim()}
                  className="px-2.5 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* AUTOMATION */}
          {tab === 'automation' && (
            <div className="space-y-3">
              <p className="text-[11px] text-gray-400">
                When a card is moved to a column, run an action automatically.
              </p>
              <div className="space-y-1.5">
                {automations.length === 0 && (
                  <p className="text-xs text-gray-400">No automation rules yet.</p>
                )}
                {automations.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]"
                  >
                    <Zap className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 flex-1">
                      Move to <span className="text-cyan-300">{colName(a.columnId)}</span> →{' '}
                      <span className="text-purple-300">{a.action}</span>
                      {a.value && <span className="text-gray-400"> ({a.value})</span>}
                    </span>
                    <button
                      onClick={() =>
                        run('automation-delete', { boardId: board.id, ruleId: a.id })
                      }
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete rule"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <select
                  value={autoCol}
                  onChange={(e) => setAutoCol(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                >
                  <option value="">Select trigger column...</option>
                  {board.columns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select
                  value={autoAction}
                  onChange={(e) => setAutoAction(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                >
                  {AUTO_ACTIONS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </select>
                {AUTO_ACTIONS.find((a) => a.id === autoAction)?.needsValue && (
                  <input
                    type="text"
                    value={autoValue}
                    onChange={(e) => setAutoValue(e.target.value)}
                    placeholder={
                      autoAction === 'add-label' ? 'Label name' : 'Assignee name'
                    }
                    className="w-full px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                  />
                )}
                <button
                  onClick={() =>
                    autoCol &&
                    run(
                      'automation-add',
                      {
                        boardId: board.id,
                        trigger: 'card-moved-to-column',
                        columnId: autoCol,
                        action: autoAction,
                        value: autoValue.trim() || undefined,
                      },
                      () => {
                        setAutoCol('');
                        setAutoValue('');
                      }
                    )
                  }
                  disabled={!autoCol}
                  className="w-full px-3 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                >
                  Add Rule
                </button>
              </div>
            </div>
          )}

          {/* COLLABORATORS */}
          {tab === 'collab' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                <Users className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-sm text-gray-300 flex-1">{owner}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                  owner
                </span>
              </div>
              <div className="space-y-1.5">
                {collaborators.length === 0 && (
                  <p className="text-xs text-gray-400">No collaborators yet.</p>
                )}
                {collaborators.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]"
                  >
                    <Users className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-sm text-gray-300 flex-1">{c.userId}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                      {c.role}
                    </span>
                    <button
                      onClick={() =>
                        run('collaborator-remove', { boardId: board.id, userId: c.userId })
                      }
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Remove collaborator"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={collabUser}
                  onChange={(e) => setCollabUser(e.target.value)}
                  placeholder="User ID"
                  className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                />
                <select
                  value={collabRole}
                  onChange={(e) => setCollabRole(e.target.value)}
                  className="px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                >
                  {COLLAB_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button aria-label="Add collaborator"
                  onClick={() =>
                    collabUser.trim() &&
                    run(
                      'collaborator-add',
                      { boardId: board.id, userId: collabUser.trim(), role: collabRole },
                      () => setCollabUser('')
                    )
                  }
                  disabled={!collabUser.trim()}
                  className="px-2.5 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* CUSTOM FIELDS */}
          {tab === 'fields' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                {fields.length === 0 && (
                  <p className="text-xs text-gray-400">No custom fields yet.</p>
                )}
                {fields.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.03] border border-white/[0.06]"
                  >
                    <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-sm text-gray-300 flex-1">{f.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400">
                      {f.type}
                    </span>
                    <button
                      onClick={() =>
                        run('custom-field-delete', { boardId: board.id, fieldId: f.id })
                      }
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete field"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    placeholder="Field name"
                    className="flex-1 px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                  />
                  <select
                    value={fieldType}
                    onChange={(e) => setFieldType(e.target.value)}
                    className="px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 focus:outline-none focus:border-purple-500/40"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                {fieldType === 'select' && (
                  <input
                    type="text"
                    value={fieldOptions}
                    onChange={(e) => setFieldOptions(e.target.value)}
                    placeholder="Options, comma-separated"
                    className="w-full px-2 py-1.5 text-xs rounded-md bg-white/5 border border-white/10 text-gray-300 placeholder-gray-600 focus:outline-none focus:border-purple-500/40"
                  />
                )}
                <button
                  onClick={() =>
                    fieldName.trim() &&
                    run(
                      'custom-field-add',
                      {
                        boardId: board.id,
                        name: fieldName.trim(),
                        type: fieldType,
                        options:
                          fieldType === 'select'
                            ? fieldOptions
                                .split(',')
                                .map((o) => o.trim())
                                .filter(Boolean)
                            : undefined,
                      },
                      () => {
                        setFieldName('');
                        setFieldOptions('');
                      }
                    )
                  }
                  disabled={!fieldName.trim()}
                  className="w-full px-3 py-1.5 text-xs rounded-md bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 disabled:opacity-40"
                >
                  Add Field
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
