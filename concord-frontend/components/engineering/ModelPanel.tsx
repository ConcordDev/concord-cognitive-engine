'use client';

import { Atom, Layers, Plus, Trash2 } from 'lucide-react';
import { MATERIALS } from './types';
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
    toggleSupport,
  } = useEngineeringFea();

  return (
    <div className="space-y-4">
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
                <th className="text-right py-1 px-2">X (ft)</th>
                <th className="text-right py-1 px-2">Y (ft)</th>
                <th className="text-right py-1 px-2">Z (ft)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {model.nodes.map((n, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 px-2">
                    <input
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 font-mono"
                      value={n.id}
                      onChange={(e) => updateNode(i, 'id', e.target.value)}
                    />
                  </td>
                  {(['x', 'y', 'z'] as const).map((f) => (
                    <td key={f} className="py-1 px-2 text-right">
                      <input
                        className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                        value={n[f]}
                        onChange={(e) => updateNode(i, f, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="py-1 px-1">
                    <button onClick={() => removeNode(i)} className="text-gray-600 hover:text-red-400" aria-label="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
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
                      value={m.nodeJ}
                      onChange={(e) => updateMember(i, 'nodeJ', e.target.value)}
                    >
                      {model.nodes.map((n) => (
                        <option key={n.id}>{n.id}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={m.area}
                      onChange={(e) => updateMember(i, 'area', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2 text-right">
                    <input
                      className="w-16 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={m.momentI}
                      onChange={(e) => updateMember(i, 'momentI', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-2">
                    <select
                      className="bg-black/30 border border-white/10 rounded px-1 text-xs"
                      value={m.material || 'A36 Steel'}
                      onChange={(e) => updateMember(i, 'material', e.target.value)}
                    >
                      {Object.keys(MATERIALS).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 px-1">
                    <button onClick={() => removeMember(i)} className="text-gray-600 hover:text-red-400" aria-label="Delete">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4 space-y-2">
        <h3 className="font-semibold text-sm">Supports</h3>
        <div className="flex flex-wrap gap-2">
          {model.nodes.map((n) => {
            const sup = model.supports.find((s) => s.nodeId === n.id);
            return (
              <button
                key={n.id}
                onClick={() => toggleSupport(n.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  sup
                    ? 'bg-neon-cyan/20 border-neon-cyan/50 text-neon-cyan'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/30'
                }`}
              >
                {n.id} {sup ? '⊥ Fixed' : '○ Free'}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
