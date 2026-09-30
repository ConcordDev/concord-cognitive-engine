'use client';

import { BarChart3, Grid3x3, Loader2, Zap } from 'lucide-react';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** Model summary, mesh generate, Run FEA — extracted from Analysis tab. */
export function AnalysisPanel() {
  const {
    model,
    meshDivisions,
    setMeshDivisions,
    meshStats,
    generateMesh,
    runFEA,
    running,
    status,
  } = useEngineeringFea();

  return (
    <div className="space-y-4">
      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-neon-cyan" /> Model Summary
        </h3>
        <div className="grid grid-cols-4 gap-2 text-center text-xs">
          {[
            { label: 'Nodes', value: model.nodes.length, color: 'text-neon-cyan' },
            { label: 'Members', value: model.members.length, color: 'text-purple-400' },
            { label: 'Loads', value: model.loads.length, color: 'text-orange-400' },
            { label: 'Supports', value: model.supports.length, color: 'text-green-400' },
          ].map((s) => (
            <div key={s.label} className="bg-black/20 rounded-lg p-2">
              <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
              <p className="text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-purple-400" /> Mesh Generation
        </h3>
        <p className="text-xs text-gray-400">
          Subdivide each structural member into N beam elements for a finer deflection curve before solving.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-gray-400">Divisions / member</label>
          <input
            type="number"
            min={1}
            max={20}
            value={meshDivisions}
            onChange={(e) => setMeshDivisions(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
            className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-sm font-mono"
          />
          <button
            onClick={generateMesh}
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/20 text-purple-400 rounded text-sm hover:bg-purple-500/30"
          >
            <Grid3x3 className="w-4 h-4" /> Generate Mesh
          </button>
        </div>
        {meshStats && (
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {[
              { label: 'Divisions', value: meshStats.divisions },
              { label: 'Mesh Nodes', value: meshStats.meshNodes },
              { label: 'Elements', value: meshStats.meshElements },
              { label: 'Avg El. Len', value: meshStats.avgElementLength.toFixed(2) },
            ].map((s) => (
              <div key={s.label} className="bg-black/20 rounded-lg p-2">
                <p className="text-base font-bold text-purple-400">{s.value}</p>
                <p className="text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel p-4 space-y-3">
        <h3 className="font-semibold text-sm">Run Analysis</h3>
        <p className="text-xs text-gray-400">
          Direct-stiffness-method solve, computed synchronously — a 200-member frame solves in under 20ms,
          so there is no job queue or polling to wait on.
        </p>
        <button
          onClick={runFEA}
          disabled={running || model.members.length === 0}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-neon-cyan text-black rounded-lg font-bold hover:bg-neon-cyan/90 disabled:opacity-50"
        >
          {running ? <Loader2 className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
          {running ? status : `Run FEA (${model.members.length} members)`}
        </button>
      </div>
    </div>
  );
}
