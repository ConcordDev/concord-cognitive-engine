'use client';

import { useState } from 'react';
import { FlaskConical, Loader2, Search, XCircle } from 'lucide-react';
import { formatModulus } from '@/lib/material-format';
import { useEngineeringFea } from './EngineeringFeaProvider';

/** Backend material library — extracted from engineering page Materials tab. */
export function MaterialsPanel() {
  const {
    libMaterials,
    matCategories,
    matFilter,
    setMatFilter,
    matLoading,
    matError,
    loadMaterials,
  } = useEngineeringFea();
  // FIX-engineering-006: the lens had no in-lens search at all — the
  // only search was the global lens-name palette. The materials
  // library is this lens's named catalog; search it by name here,
  // composing with the category filter.
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const visible = libMaterials.filter(
    (m) => (matFilter === 'all' || m.category === matFilter) && (!q || m.label.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-gray-400" />
        <input
          data-testid="engineering-material-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search materials by name…"
          aria-label="Search materials by name"
          className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-gray-500 focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap gap-1">
        {['all', ...matCategories].map((c) => (
          <button
            key={c}
            onClick={() => setMatFilter(c)}
            className={`px-3 py-1 rounded-full text-xs capitalize ${
              matFilter === c
                ? 'bg-neon-cyan/20 text-neon-cyan border border-neon-cyan/40'
                : 'bg-white/5 text-gray-400 border border-white/10'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      {matLoading ? (
        <div role="status" aria-live="polite" className="panel p-8 text-center text-gray-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
          Loading material library…
        </div>
      ) : matError ? (
        <div role="alert" className="panel p-8 text-center space-y-3 border border-red-500/30">
          <XCircle className="w-8 h-8 text-red-400 mx-auto" />
          <p className="text-sm text-red-400">{matError}</p>
          <button
            onClick={loadMaterials}
            className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
          >
            Retry
          </button>
        </div>
      ) : libMaterials.length === 0 ? (
        <div className="panel p-8 text-center space-y-3">
          <FlaskConical className="w-8 h-8 text-gray-600 mx-auto" />
          <p className="text-gray-400 text-sm">No materials in the library yet.</p>
          <button
            onClick={loadMaterials}
            className="px-4 py-2 bg-neon-cyan/20 text-neon-cyan rounded-lg text-sm hover:bg-neon-cyan/30"
          >
            Reload library
          </button>
        </div>
      ) : (
        visible.length === 0 ? (
          <div className="panel p-8 text-center">
            <p className="text-gray-400 text-sm">No materials match &lsquo;{query.trim()}&rsquo;{matFilter !== 'all' ? ` in ${matFilter}` : ''}.</p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visible
            .map((mat) => (
              <div key={mat.id} className="panel p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-purple-400" />
                  <h3 className="font-medium text-sm">{mat.label}</h3>
                  <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-gray-400 capitalize">
                    {mat.category}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-black/20 rounded p-2 text-center">
                    <p className="text-gray-400">E</p>
                    <p className="font-mono text-neon-cyan">{formatModulus(mat.E)}</p>
                  </div>
                  <div className="bg-black/20 rounded p-2 text-center">
                    <p className="text-gray-400">σ_yield</p>
                    <p className="font-mono text-green-400">{mat.yield} MPa</p>
                  </div>
                  <div className="bg-black/20 rounded p-2 text-center">
                    <p className="text-gray-400">σ_ult</p>
                    <p className="font-mono text-orange-400">{mat.ultimate} MPa</p>
                  </div>
                  <div className="bg-black/20 rounded p-2 text-center">
                    <p className="text-gray-400">ρ</p>
                    <p className="font-mono text-yellow-400">{mat.density} kg/m³</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-gray-400">
                  <p>
                    ν <span className="text-white font-mono">{mat.poisson}</span>
                  </p>
                  <p>
                    CTE <span className="text-white font-mono">{mat.cte}µ/K</span>
                  </p>
                  <p>
                    k <span className="text-white font-mono">{mat.thermalK}</span>
                  </p>
                  <p>
                    $/kg <span className="text-white font-mono">${mat.costPerKg}</span>
                  </p>
                </div>
              </div>
            ))}
        </div>
        )
      )}
    </div>
  );
}
