'use client';

import { useState } from 'react';
import { Atom, Layers, Plus, Trash2, X } from 'lucide-react';
import { MATERIALS } from './types';
import { NumCell } from './NumCell';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** Nodes / members / supports — extracted from engineering page Model tab. */
export function ModelPanel() {
  const {
    model,
    addNode,
    updateNode,
    removeNode,
    addMember,
    updateMember,
    removeMember,
    cycleSupport,
    referencesFor,
    modelNotice,
    clearModelNotice,
    modelSaveState,
  } = useEngineeringFea();
  // Two-step delete: the first click arms the row, the second deletes.
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  const saveLabel: Record<typeof modelSaveState, string> = {
    loading: 'Loading your saved model…',
    idle: 'New model. Changes save to your account.',
    saving: 'Saving…',
    saved: 'Saved to your account',
    error: 'Not saved. Check your connection.',
  };

  const deleteBtn = (key: string, label: string, onDelete: () =>
    void) =>
    armedDelete === key ? (
      <button
        onClick={() => {
          setArmedDelete(null);
          onDelete();
        }}
        className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] whitespace-nowrap"
        aria-label={`Confirm delete ${label}`}
      >
        Delete {label}?
      </button>
    ) : (
      <button
        onClick={() => setArmedDelete(key)}
        className="text-gray-600 hover:text-red-400"
        aria-label={`Delete ${label}`}
      >
        <Trash2 className="w-3 h-3" />
      </button>
    );

  return (
    <div className="space-y-4">
      <p
        data-testid="model-save-state"
        data-state={modelSaveState}
        className={`text-xs ${modelSaveState === 'error' ? 'text-red-400' : 'text-gray-400'}`}
      >
        {saveLabel[modelSaveState]}
      </p>
      {modelNotice && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
        >
          <span className="flex-1">{modelNotice}</span>
          <button onClick={clearModelNotice} aria-label="Dismiss" className="text-amber-300 hover:text-amber-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Atom className="w-4 h-4 text-neon-cyan" /> Nodes
          </h3>
          <button
            onClick={addNode}
            className="text-xs px-2 py-1 bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            Node
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left py-1 px-2">ID</th>
                <th className="text-right py-1 px-2">X (in)</th>
                <th className="text-right py-1 px-2">Y (in)</th>
                <th className="text-right py-1 px-2">Z (in)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.nodes.map((n, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 px-2">
                    <input
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 font-mono"
                      aria-label="Node id"
                      value={n.id}
                      onChange={(e) => updateNode(i, 'id', e.target.value)}
                    />
                  </td>
                  {(['x', 'y', 'z'] as const).map((f) => (
                    <td key={f} className="py-1 px-2 text-right">
                      <NumCell
                        className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                        value={n[f]}
                        ariaLabel={`${n.id} ${f}`}
                        onCommit={(v) => updateNode(i, f, String(v))}
                      />
                    </td>
                  ))}
                  <td className="py-1 px-1">
                    {deleteBtn(`node-${i}`, n.id, () => removeNode(i))}
                    {referencesFor(n.id).length > 0 && (
                      <span className="sr-only">{n.id} is referenced; deleting it will be refused with the references named</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-purple-400" /> Members
          </h3>
          <button
            onClick={addMember}
            className="text-xs px-2 py-1 bg-purple-500/20 text-purple-400 rounded hover:bg-purple-500/30"
          >
            <Plus className="w-3 h-3 inline mr-1" />
            Member
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-400 border-b border-white/10">
                <th className="text-left py-1 px-2">ID</th>
                <th className="text-left py-1 px-2">Node I</th>
                <th className="text-left py-1 px-2">Node J</th>
                <th className="text-right py-1 px-2">A (in²)</th>
                <th className="text-right py-1 px-2">I (in⁴)</th>
                <th className="text-left py-1 px-2">Material</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.members.map((m, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 px-2 font-mono">{m.id}</td>
                  <td className="py-1 px-2">
                    <select
                      className="bg-black/30 border border-white/10 rounded px-1"
                      aria-label="Member start node"
                      value={m.nodeI}
                      onChange={(e) => updateMember(i, 'nodeI', e.target.value)}
                    >
                      {model.nodes.map((n) => (
                        <option key={n.id}>{n.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-2">
                    <select
                      className="bg-black/30 border border-white/10 rounded px-1"
                      aria-label="Member end node"
                      value={m.nodeJ}
                      onChange={(e) => updateMember(i, 'nodeJ', e.target.value)}
                    >
                      {model.nodes.map((n) => (
                        <option key={n.id}>{n.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-2 text-right">
                    <NumCell
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={m.area}
                      ariaLabel={`${m.id} area`}
                      onCommit={(v) => updateMember(i, 'area', String(v))}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <NumCell
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={m.momentI}
                      ariaLabel={`${m.id} moment of inertia`}
                      onCommit={(v) => updateMember(i, 'momentI', String(v))}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <select
                      className="bg-black/30 border border-white/10 rounded px-1 text-xs"
                      aria-label="Member material"
                      value={m.material || 'A36 Steel'}
                      onChange={(e) => updateMember(i, 'material', e.target.value)}
                    >
                      {Object.keys(MATERIALS).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    {deleteBtn(`member-${i}`, m.id, () => removeMember(i))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4 space-y-2">
        <h3 className="font-semibold text-sm">Supports</h3>
        <p className="text-[11px] text-gray-400">
          Select a node to cycle its support: Free → Fixed → Pinned → Roller. Pinned restrains translation
          (x/y/z); a roller restrains the vertical (y) only — a simply supported beam is a pinned node plus a
          roller node.
        </p>
        <div className="flex flex-wrap gap-2">
          {model.nodes.map((n) => {
            const sup = model.supports.find((s) => s.nodeId === n.id);
            const label = sup
              ? sup.type === 'fixed'
                ? '⊥ Fixed'
                : sup.type === 'pinned'
                  ? '⊓ Pinned'
                  : '◯ Roller'
              : '○ Free';
            return (
              <button
                key={n.id}
                onClick={() => cycleSupport(n.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  sup
                    ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {n.id} {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
