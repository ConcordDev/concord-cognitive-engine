'use client';

import { useState } from 'react';
import { FolderOpen, Plus, Save, Trash2 } from 'lucide-react';
import { NumCell } from './NumCell';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** Point loads + saved load cases — extracted from engineering page Loads tab. */
export function LoadsPanel() {
  const {
    model,
    addLoad,
    updateLoad,
    removeLoad,
    loadCases,
    lcName,
    setLcName,
    saveLoadCase,
    applyLoadCase,
    deleteLoadCase,
  } = useEngineeringFea();
  const [armedDelete, setArmedDelete] = useState<string | null>(null);

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Point Loads</h3>
        <button
          onClick={addLoad}
          className="text-xs px-2 py-1 bg-orange-500/20 text-orange-400 rounded hover:bg-orange-500/30"
        >
          <Plus className="w-3 h-3 inline mr-1" />
          Load
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 border-b border-white/10">
              <th className="text-left py-1 px-2">Node</th>
              <th className="text-right py-1 px-2">Fx (lb)</th>
              <th className="text-right py-1 px-2">Fy (lb)</th>
              <th className="text-right py-1 px-2">Fz (lb)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.loads.map((l, i) => (
              <tr key={i} className="border-b border-white/5">
                <td className="py-1 px-2">
                  <select
                    className="bg-black/30 border border-white/10 rounded px-1"
                    aria-label="Load node"
                    value={l.nodeId}
                    onChange={(e) => updateLoad(i, 'nodeId', e.target.value)}
                  >
                    {model.nodes.map((n) => (
                      <option key={n.id}>{n.id}</option>
                    ))}
                  </select>
                </td>
                {(['Fx', 'Fy', 'Fz'] as const).map((f) => (
                  <td key={f} className="py-1 px-2 text-right">
                    <NumCell
                      className="w-20 bg-black/30 border border-white/10 rounded px-1 text-right font-mono"
                      value={l[f] ?? 0}
                      ariaLabel={`Load ${i + 1} ${f}`}
                      onCommit={(v) => updateLoad(i, f, String(v))}
                    />
                  </td>
                ))}
                <td className="py-1 px-1">
                  {armedDelete === `load-${i}` ? (
                    <button
                      onClick={() => {
                        setArmedDelete(null);
                        removeLoad(i);
                      }}
                      className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] whitespace-nowrap"
                      aria-label="Confirm delete load"
                    >
                      Delete?
                    </button>
                  ) : (
                    <button
                      onClick={() => setArmedDelete(`load-${i}`)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label="Delete load"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {model.loads.length === 0 && (
        <p className="text-center text-gray-400 text-xs py-4">No loads defined. Add point loads above.</p>
      )}

      <div className="border-t border-white/10 pt-3 mt-3 space-y-2">
        <h4 className="font-semibold text-xs flex items-center gap-2">
          <FolderOpen className="w-3.5 h-3.5 text-purple-400" /> Load Cases
        </h4>
        <div className="flex items-center gap-2">
          <input
            value={lcName}
            onChange={(e) => setLcName(e.target.value)}
            placeholder="Load case name"
            aria-label="Load case name"
            className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs"
          />
          <button
            onClick={saveLoadCase}
            className="flex items-center gap-1 px-3 py-1 bg-purple-500/20 text-purple-400 rounded text-xs hover:bg-purple-500/30"
          >
            <Save className="w-3 h-3" /> Save current loads + supports
          </button>
        </div>
        {loadCases.length === 0 ? (
          <p className="text-xs text-gray-400">
            No saved load cases. Save the current loads/supports to reuse them.
          </p>
        ) : (
          <div className="space-y-1">
            {loadCases.map((lc) => (
              <div key={lc.id} className="flex items-center justify-between bg-black/20 rounded px-2 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs truncate">{lc.name}</p>
                  <p className="text-[10px] text-gray-400">
                    {lc.loads.length} loads · {lc.supports.length} supports
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => applyLoadCase(lc)}
                    className="text-xs px-2 py-0.5 bg-neon-cyan/20 text-neon-cyan rounded hover:bg-neon-cyan/30"
                  >
                    Apply
                  </button>
                  {armedDelete === `lc-${lc.id}` ? (
                    <button
                      onClick={() => {
                        setArmedDelete(null);
                        void deleteLoadCase(lc.id);
                      }}
                      className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 text-[10px] whitespace-nowrap"
                      aria-label={`Confirm delete load case ${lc.name}`}
                    >
                      Delete “{lc.name}”?
                    </button>
                  ) : (
                    <button
                      onClick={() => setArmedDelete(`lc-${lc.id}`)}
                      className="text-gray-600 hover:text-red-400"
                      aria-label={`Delete load case ${lc.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
