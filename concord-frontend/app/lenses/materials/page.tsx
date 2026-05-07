'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Box, Layers, Plus, Trash2, Search, ChevronDown, Thermometer, Zap, Shield, FlaskConical, Microscope, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface Material {
  name: string;
  category: string;
  density: number;
  tensileStrength: number;
  thermalConductivity: number;
  meltingPoint: number;
  youngsModulus: number;
  applications: string[];
}

const CATEGORIES = ['Metal', 'Polymer', 'Ceramic', 'Composite', 'Semiconductor', 'Biomaterial'];

export default function MaterialsLensPage() {
  useLensNav('materials');

  const [activeTab, setActiveTab] = useState<'library' | 'compare' | 'properties'>('library');
  const [showFeatures, setShowFeatures] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('materials');

  const { items: materialItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('materials', 'material', { seed: [] });
  const runAction = useRunArtifact('materials');

  const handleAction = useCallback((artifactId: string) => {
    runAction.mutate({ id: artifactId, action: 'analyze' });
  }, [runAction]);

  const materials = materialItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (Material & { id: string; title: string })[];

  const filtered = materials.filter(m => {
    if (categoryFilter !== 'all' && m.category !== categoryFilter) return false;
    if (searchQuery && !(m.name || m.title || '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const [newMat, setNewMat] = useState({ name: '', category: 'Metal' });

  const addMaterial = () => {
    if (!newMat.name.trim()) return;
    create({
      title: newMat.name,
      data: {
        name: newMat.name,
        category: newMat.category,
        density: 0,
        tensileStrength: 0,
        thermalConductivity: 0,
        meltingPoint: 0,
        youngsModulus: 0,
        applications: [],
      },
    });
    setNewMat({ name: '', category: 'Metal' });
  };

  if (isLoading) {
    return (
      <div data-lens-theme="materials" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-zinc-300 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading materials database...</p>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="materials" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Box className="w-8 h-8 text-zinc-300" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Materials Science Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />}
            </div>
            <p className="text-sm text-gray-400">Material properties, comparison, and selection</p>
          </div>
        </div>
      </header>

      <RealtimeDataPanel domain="materials" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="materials" artifactId={undefined} compact />
      <DTUExportButton domain="materials" data={{}} compact />

      {/* Stats Row */}
      {(() => { const cats = [...new Set(materials.map(m => m.category).filter(Boolean))]; const withTests = materials.filter(m => m.tensileStrength > 0 || m.density > 0 || m.meltingPoint > 0).length; const propTypes = ['density', 'tensileStrength', 'thermalConductivity', 'meltingPoint', 'youngsModulus'].filter(p => materials.some(m => (m as unknown as Record<string, number>)[p] > 0)).length; return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="panel p-3"><Box className="w-5 h-5 text-zinc-300 mb-2" /><p className="text-2xl font-bold">{materials.length}</p><p className="text-sm text-gray-400">Catalog Size</p></div>
          <div className="panel p-3"><FlaskConical className="w-5 h-5 text-blue-400 mb-2" /><p className="text-2xl font-bold">{withTests}</p><p className="text-sm text-gray-400">Test Count</p></div>
          <div className="panel p-3"><Microscope className="w-5 h-5 text-green-400 mb-2" /><p className="text-2xl font-bold">{propTypes}</p><p className="text-sm text-gray-400">Property Types</p></div>
          <div className="panel p-3"><Layers className="w-5 h-5 text-purple-400 mb-2" /><p className="text-2xl font-bold">{cats.length}</p><p className="text-sm text-gray-400">Categories</p></div>
        </div>
      ); })()}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['library', 'compare', 'properties'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-zinc-300/20 text-zinc-300 border-b-2 border-zinc-300' : 'text-gray-400 hover:text-white'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'library' && (
        <div className="space-y-4">
          {/* Search & Filter */}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search materials..." className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm" />
            </div>
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
              <option value="all">All Categories</option>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Add Material */}
          <div className="panel p-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input value={newMat.name} onChange={e => setNewMat({ ...newMat, name: e.target.value })} placeholder="Material name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newMat.category} onChange={e => setNewMat({ ...newMat, category: e.target.value })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={addMaterial} className="px-4 py-2 bg-zinc-300/20 text-zinc-300 rounded-lg text-sm hover:bg-zinc-300/30">
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
            </div>
          </div>

          {/* Materials List */}
          <div className="space-y-2">
            {filtered.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No materials found.</p>
            ) : (
              filtered.map((mat, index) => (
                <motion.div key={mat.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="panel p-4 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Box className="w-4 h-4 text-zinc-300" />
                      <span className="font-medium">{mat.name || mat.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-gray-300">{mat.category}</span>
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-gray-400">
                      {mat.density > 0 && <span>Density: {mat.density} g/cm3</span>}
                      {mat.tensileStrength > 0 && <span>Tensile: {mat.tensileStrength} MPa</span>}
                      {mat.meltingPoint > 0 && <span>Melting: {mat.meltingPoint}°C</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleAction(mat.id)} className="text-gray-500 hover:text-neon-cyan" title="Run AI analysis"><Zap className="w-4 h-4" /></button>
                    <button onClick={() => update(mat.id, { data: { ...mat, lastUpdated: new Date().toISOString() } as unknown as Partial<Record<string, unknown>> })} className="text-gray-500 hover:text-yellow-400" title="Update"><FlaskConical className="w-4 h-4" /></button>
                    <button onClick={() => remove(mat.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'compare' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3">Material Comparison</h3>
          <p className="text-gray-500 text-sm text-center py-4">Add at least 2 materials to the library to compare properties side by side.</p>
          {materials.length >= 2 && (
            <div className="overflow-x-auto mt-4">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-white/10">
                  <th className="text-left py-2 px-3">Property</th>
                  {materials.slice(0, 4).map(m => <th key={m.id} className="text-left py-2 px-3">{m.name || m.title}</th>)}
                </tr></thead>
                <tbody>
                  {['density', 'tensileStrength', 'thermalConductivity', 'meltingPoint', 'youngsModulus'].map(prop => (
                    <tr key={prop} className="border-b border-white/5">
                      <td className="py-2 px-3 text-gray-400">{prop.replace(/([A-Z])/g, ' $1').trim()}</td>
                      {materials.slice(0, 4).map(m => <td key={m.id} className="py-2 px-3 font-mono">{(m as unknown as Record<string, unknown>)[prop] as number || '-'}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'properties' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Thermometer className="w-4 h-4 text-orange-400" /> Property Reference</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { name: 'Tensile Strength', desc: 'Maximum stress before fracture', icon: Zap },
              { name: 'Thermal Conductivity', desc: 'Heat transfer rate', icon: Thermometer },
              { name: 'Density', desc: 'Mass per unit volume', icon: Box },
              { name: 'Hardness', desc: 'Resistance to deformation', icon: Shield },
            ].map(prop => (
              <div key={prop.name} className="lens-card">
                <div className="flex items-center gap-2 mb-1">
                  <prop.icon className="w-4 h-4 text-zinc-300" />
                  <span className="font-medium text-sm">{prop.name}</span>
                </div>
                <p className="text-xs text-gray-400">{prop.desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="materials" /></div>}
      </div>
    </div>
  );
}
