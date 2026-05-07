'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Star, Orbit as Telescope, Plus, Trash2, Search, Layers, ChevronDown, Globe, Target, Eye, EyeOff, Zap, Loader2 } from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

type CelestialType = 'star' | 'planet' | 'moon' | 'asteroid' | 'comet' | 'galaxy' | 'nebula';

interface CelestialObject {
  name: string;
  type: CelestialType;
  ra: string;
  dec: string;
  magnitude: number;
  distance: string;
  constellation: string;
  notes: string;
}

interface Observation {
  target: string;
  date: string;
  telescope: string;
  conditions: string;
  notes: string;
}

const TYPE_ICONS: Record<CelestialType, { color: string; bg: string; emoji: string }> = {
  star:     { color: 'text-yellow-400',  bg: 'bg-yellow-400/15 border-yellow-400/30',  emoji: '★' },
  planet:   { color: 'text-blue-400',    bg: 'bg-blue-400/15 border-blue-400/30',      emoji: '●' },
  moon:     { color: 'text-gray-300',    bg: 'bg-gray-300/15 border-gray-300/30',      emoji: '◐' },
  asteroid: { color: 'text-orange-400',  bg: 'bg-orange-400/15 border-orange-400/30',  emoji: '◆' },
  comet:    { color: 'text-cyan-400',    bg: 'bg-cyan-400/15 border-cyan-400/30',      emoji: '☄' },
  galaxy:   { color: 'text-purple-400',  bg: 'bg-purple-400/15 border-purple-400/30',  emoji: '◎' },
  nebula:   { color: 'text-pink-400',    bg: 'bg-pink-400/15 border-pink-400/30',      emoji: '✦' },
};

// Deterministic "observable tonight" based on object name hash
function isVisibleTonight(name: string): boolean {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return (hash & 1) === 0;
}

function CelestialCard({
  obj,
  onRemove,
}: {
  obj: CelestialObject & { id: string; title: string };
  onRemove: () => void;
}) {
  const typeInfo = TYPE_ICONS[(obj.type as CelestialType)] || { color: 'text-gray-400', bg: 'bg-white/10 border-white/20', emoji: '•' };
  const visible = isVisibleTonight(obj.name || obj.title || '');

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="panel p-3 flex items-center justify-between group"
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Type badge */}
        <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm border ${typeInfo.bg} ${typeInfo.color}`}>
          {typeInfo.emoji}
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{obj.name || obj.title}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${typeInfo.bg} ${typeInfo.color}`}>
              {(obj.type as string) || 'unknown'}
            </span>
            {/* Visibility indicator */}
            <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
              visible
                ? 'bg-green-400/15 text-green-400 border border-green-400/30'
                : 'bg-gray-600/20 text-gray-500 border border-gray-600/30'
            }`}>
              {visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
              {visible ? 'Tonight' : 'Not visible'}
            </span>
          </div>
          <div className="flex gap-3 mt-0.5 text-xs text-gray-500">
            {obj.constellation && <span>{obj.constellation}</span>}
            {obj.magnitude !== undefined && obj.magnitude !== 0 && <span>Mag {obj.magnitude}</span>}
            {obj.distance && <span>{obj.distance}</span>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
        <button onClick={onRemove} className="text-gray-600 hover:text-red-400">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}

export default function AstronomyLensPage() {
  useLensNav('astronomy');

  const [activeTab, setActiveTab] = useState<'catalog' | 'observations' | 'planning'>('catalog');
  const [showFeatures, setShowFeatures] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupByConstellation, setGroupByConstellation] = useState(false);
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('astronomy');

  const { items: objectItems, isLoading, isError, error, refetch, create, update, remove } = useLensData<Record<string, unknown>>('astronomy', 'object', { seed: [] });
  const { items: obsItems, create: createObs, remove: removeObs } = useLensData<Record<string, unknown>>('astronomy', 'observation', { seed: [] });
  const runAction = useRunArtifact('astronomy');

  const handleAction = useCallback((artifactId: string) => {
    runAction.mutate({ id: artifactId, action: 'analyze' });
  }, [runAction]);

  const objects = objectItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (CelestialObject & { id: string; title: string })[];
  const observations = obsItems.map(i => ({ id: i.id, title: i.title, ...(i.data || {}) })) as unknown as (Observation & { id: string; title: string })[];

  const filtered = objects.filter(o =>
    !searchQuery || (o.name || o.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Constellation grouping
  const groupedByConstellation = useMemo(() => {
    const groups: Record<string, (CelestialObject & { id: string; title: string })[]> = {};
    filtered.forEach(o => {
      const key = (o.constellation as string) || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    return groups;
  }, [filtered]);

  const [newObj, setNewObj] = useState({ name: '', type: 'star' as CelestialType, constellation: '' });

  const addObject = () => {
    if (!newObj.name.trim()) return;
    create({
      title: newObj.name,
      data: { name: newObj.name, type: newObj.type, ra: '', dec: '', magnitude: 0, distance: '', constellation: newObj.constellation, notes: '' },
    });
    setNewObj({ name: '', type: 'star', constellation: '' });
  };

  const [obsForm, setObsForm] = useState({ target: '', telescope: '', conditions: 'clear', notes: '' });

  const logObservation = () => {
    if (!obsForm.target.trim()) return;
    createObs({
      title: `Observation: ${obsForm.target}`,
      data: { target: obsForm.target, date: new Date().toISOString(), telescope: obsForm.telescope, conditions: obsForm.conditions, notes: obsForm.notes },
    });
    setObsForm({ target: '', telescope: '', conditions: 'clear', notes: '' });
  };

  if (isLoading) {
    return (
      <div data-lens-theme="astronomy" className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Scanning the cosmos...</p>
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
    <div data-lens-theme="astronomy" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Telescope className="w-8 h-8 text-indigo-400" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold">Astronomy Lens</h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
              {runAction.isPending && <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />}
            </div>
            <p className="text-sm text-gray-400">Celestial catalog, observation logging, and session planning</p>
          </div>
        </div>
      </header>

      <RealtimeDataPanel domain="astronomy" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />
      <UniversalActions domain="astronomy" artifactId={undefined} compact />
      <DTUExportButton domain="astronomy" data={{}} compact />

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['catalog', 'observations', 'planning'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-indigo-400/20 text-indigo-400 border-b-2 border-indigo-400' : 'text-gray-400 hover:text-white'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search celestial objects..." className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm" />
          </div>

          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Add Object</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={newObj.name} onChange={e => setNewObj({ ...newObj, name: e.target.value })} placeholder="Object name" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <select value={newObj.type} onChange={e => setNewObj({ ...newObj, type: e.target.value as CelestialType })} className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm">
                {(Object.keys(TYPE_ICONS) as CelestialType[]).map(t => (
                  <option key={t} value={t}>{TYPE_ICONS[t as CelestialType].emoji} {t.charAt(0).toUpperCase() + t.slice(1)}</option>
                ))}
              </select>
              <input value={newObj.constellation} onChange={e => setNewObj({ ...newObj, constellation: e.target.value })} placeholder="Constellation" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addObject} className="px-4 py-2 bg-indigo-400/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-400/30">
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
            </div>
          </div>

          {/* View toggles */}
          {filtered.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setGroupByConstellation(!groupByConstellation)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  groupByConstellation
                    ? 'bg-indigo-400/20 text-indigo-400 border border-indigo-400/30'
                    : 'bg-white/5 text-gray-400 hover:text-white'
                }`}
              >
                <Globe className="w-3.5 h-3.5" />
                Group by Constellation
              </button>
              <span className="text-xs text-gray-500">
                {filtered.filter(o => isVisibleTonight(o.name || o.title || '')).length} visible tonight
              </span>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No celestial objects cataloged yet.</p>
          ) : groupByConstellation ? (
            <div className="space-y-4">
              {(Object.entries(groupedByConstellation) as [string, (CelestialObject & { id: string; title: string })[]][]).sort(([a], [b]) => a.localeCompare(b)).map(([constellation, conObjs]) => (
                <div key={constellation}>
                  <h4 className="text-xs text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Star className="w-3 h-3 text-indigo-400" />
                    {constellation}
                    <span className="text-gray-600">({conObjs.length})</span>
                  </h4>
                  <div className="space-y-2 pl-2 border-l border-indigo-400/20">
                    {conObjs.map((obj: CelestialObject & { id: string; title: string }) => <CelestialCard key={obj.id} obj={obj} onRemove={() => { remove(obj.id); }} />)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map(obj => <CelestialCard key={obj.id} obj={obj} onRemove={() => { remove(obj.id); }} />)}
            </div>
          )}
        </div>
      )}

      {activeTab === 'observations' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Log Observation</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
              <input value={obsForm.target} onChange={e => setObsForm({ ...obsForm, target: e.target.value })} placeholder="Target object" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
              <input value={obsForm.telescope} onChange={e => setObsForm({ ...obsForm, telescope: e.target.value })} placeholder="Telescope/equipment" className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm" />
            </div>
            <textarea value={obsForm.notes} onChange={e => setObsForm({ ...obsForm, notes: e.target.value })} placeholder="Observation notes..." className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm resize-none h-20" />
            <button onClick={logObservation} className="mt-2 px-4 py-2 bg-indigo-400/20 text-indigo-400 rounded-lg text-sm hover:bg-indigo-400/30">Log</button>
          </div>

          <div className="space-y-2">
            {observations.map(obs => (
              <div key={obs.id} className="panel p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium">{obs.target || obs.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">{obs.date ? new Date(obs.date).toLocaleDateString() : ''}</span>
                    <button onClick={() => removeObs(obs.id)} className="text-gray-600 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <p className="text-xs text-gray-400">{obs.telescope} - {obs.conditions}</p>
                {obs.notes && <p className="text-xs text-gray-300 mt-1">{obs.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'planning' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2"><Target className="w-4 h-4 text-indigo-400" /> Session Planner</h3>
          <p className="text-gray-500 text-sm text-center py-4">Select objects from your catalog to plan an observation session. Best results with clear skies and low light pollution.</p>
          {objects.length > 0 ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-gray-400 mb-3">
                Suggested targets — sorted by visibility tonight:
              </p>
              {[...objects]
                .sort((a, b) => {
                  const aVis = isVisibleTonight(a.name || a.title || '') ? 0 : 1;
                  const bVis = isVisibleTonight(b.name || b.title || '') ? 0 : 1;
                  return aVis - bVis;
                })
                .slice(0, 6)
                .map(obj => {
                  const typeInfo = TYPE_ICONS[obj.type as CelestialType] || { color: 'text-gray-400', bg: 'bg-white/10 border-white/20', emoji: '•' };
                  const visible = isVisibleTonight(obj.name || obj.title || '');
                  return (
                    <div key={obj.id} className="flex items-center gap-2 p-2 rounded-lg bg-white/5">
                      <span className={`text-sm ${typeInfo.color}`}>{typeInfo.emoji}</span>
                      <span className="text-sm">{obj.name || obj.title}</span>
                      <span className="text-xs text-gray-500">{obj.constellation || obj.type}</span>
                      <button onClick={() => handleAction(obj.id)} className="text-gray-500 hover:text-indigo-400 ml-2" title="Run AI analysis">
                        <Zap className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => update(obj.id, { data: { ...obj, notes: `Updated ${new Date().toLocaleDateString()}` } })} className="text-gray-500 hover:text-yellow-400" title="Mark updated">
                        <Star className="w-3.5 h-3.5" />
                      </button>
                      <span className={`ml-auto flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                        visible
                          ? 'bg-green-400/15 text-green-400'
                          : 'bg-gray-600/20 text-gray-500'
                      }`}>
                        {visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                        {visible ? 'Tonight' : 'Not visible'}
                      </span>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-500 text-sm border border-dashed border-white/10 rounded-lg">
              <p>No celestial objects cataloged yet. Add objects to see your observation log.</p>
            </div>
          )}
        </div>
      )}

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" /> Lens Features & Capabilities</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="astronomy" /></div>}
      </div>
    </div>
  );
}
