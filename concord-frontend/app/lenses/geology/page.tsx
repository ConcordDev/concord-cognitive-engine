'use client';

import dynamic from 'next/dynamic';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mountain,
  MapPin,
  Plus,
  Trash2,
  Search,
  Layers,
  Gem,
  Map,
  Zap,
  Loader2,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { UniversalActions } from '@/components/lens/UniversalActions';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';
import { LensPageShell } from '@/components/lens/LensPageShell';

type RockType = 'igneous' | 'sedimentary' | 'metamorphic';

interface Sample {
  name: string;
  rockType: RockType;
  mineralComposition: string[];
  location: string;
  coordinates: { lat: number; lng: number } | null;
  formation: string;
  age: string;
  notes: string;
}

interface FieldSite {
  name: string;
  location: string;
  description: string;
  samples: number;
  lastVisited: string;
  lat?: number;
  lng?: number;
}

const ROCK_COLORS: Record<RockType, string> = {
  igneous: 'text-red-400',
  sedimentary: 'text-yellow-400',
  metamorphic: 'text-purple-400',
};

export default function GeologyLensPage() {
  const [activeTab, setActiveTab] = useState<'samples' | 'sites' | 'stratigraphy' | 'map'>(
    'samples'
  );
  const [searchQuery, setSearchQuery] = useState('');

  const {
    items: sampleItems,
    isLoading,
    isError,
    error,
    refetch,
    create,
    update,
    remove,
  } = useLensData<Record<string, unknown>>('geology', 'sample', { seed: [] });
  const {
    items: siteItems,
    create: createSite,
    remove: removeSite,
  } = useLensData<Record<string, unknown>>('geology', 'site', { seed: [] });
  const runAction = useRunArtifact('geology');

  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = useCallback(
    (artifactId: string) => {
      setActionError(null);
      runAction.mutate(
        { id: artifactId, action: 'analyze' },
        {
          onError: (e) => {
            console.error('Action failed:', e);
            setActionError(`Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
          },
        }
      );
    },
    [runAction]
  );

  const samples = sampleItems.map((i) => ({
    id: i.id,
    title: i.title,
    ...(i.data || {}),
  })) as unknown as (Sample & { id: string; title: string })[];
  const sites = siteItems.map((i) => ({
    id: i.id,
    title: i.title,
    ...(i.data || {}),
  })) as unknown as (FieldSite & { id: string; title: string })[];

  const [newSample, setNewSample] = useState({
    name: '',
    rockType: 'igneous' as RockType,
    location: '',
  });
  const [newSite, setNewSite] = useState({
    name: '',
    location: '',
    description: '',
    lat: '',
    lng: '',
  });

  const addSample = () => {
    if (!newSample.name.trim()) return;
    create({
      title: newSample.name,
      data: {
        name: newSample.name,
        rockType: newSample.rockType,
        mineralComposition: [],
        location: newSample.location,
        coordinates: null,
        formation: '',
        age: '',
        notes: '',
      },
    });
    setNewSample({ name: '', rockType: 'igneous', location: '' });
  };

  const addSite = () => {
    if (!newSite.name.trim()) return;
    createSite({
      title: newSite.name,
      data: {
        name: newSite.name,
        location: newSite.location,
        description: newSite.description,
        samples: 0,
        lastVisited: new Date().toISOString(),
        lat: newSite.lat ? Number(newSite.lat) : undefined,
        lng: newSite.lng ? Number(newSite.lng) : undefined,
      },
    });
    setNewSite({ name: '', location: '', description: '', lat: '', lng: '' });
  };

  return (
    <LensPageShell
      domain="geology"
      title="Geology Lens"
      description="Rock samples, field sites, and stratigraphic analysis"
      headerIcon={<Mountain className="w-6 h-6 text-orange-400" />}
      isLoading={isLoading}
      isError={isError}
      error={error}
      onRetry={refetch}
      actions={
        runAction.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin text-orange-400" />
        ) : undefined
      }
    >
      {actionError && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2 text-sm text-red-400 flex items-center justify-between">
          <span>{actionError}</span>
          <button
            onClick={() => setActionError(null)}
            className="text-red-400 hover:text-red-300 ml-2"
          >
            &times;
          </button>
        </div>
      )}

      <UniversalActions domain="geology" artifactId={undefined} compact />

      {/* Stat Cards — earth science metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Samples', value: samples.length, icon: Gem, color: 'text-purple-400' },
          { label: 'Field Sites', value: sites.length, icon: MapPin, color: 'text-orange-400' },
          {
            label: 'Igneous',
            value: samples.filter((s) => s.rockType === 'igneous').length,
            icon: Mountain,
            color: 'text-red-400',
          },
          {
            label: 'Sedimentary',
            value: samples.filter((s) => s.rockType === 'sedimentary').length,
            icon: Layers,
            color: 'text-yellow-400',
          },
        ].map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="panel p-3"
          >
            <stat.icon className={`w-4 h-4 mb-1 ${stat.color}`} />
            <div className="text-xl font-bold">{stat.value}</div>
            <div className="text-[10px] text-gray-500 uppercase">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Rock Type Distribution Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center gap-2"
      >
        <span className="text-[10px] text-gray-500 shrink-0">Rock Types</span>
        <div className="flex-1 h-3 rounded-full overflow-hidden flex bg-white/5">
          {samples.length > 0 ? (
            <>
              <div
                className="bg-red-500/60 h-full"
                style={{
                  width: `${(samples.filter((s) => s.rockType === 'igneous').length / samples.length) * 100}%`,
                }}
                title="Igneous"
              />
              <div
                className="bg-yellow-500/60 h-full"
                style={{
                  width: `${(samples.filter((s) => s.rockType === 'sedimentary').length / samples.length) * 100}%`,
                }}
                title="Sedimentary"
              />
              <div
                className="bg-purple-500/60 h-full"
                style={{
                  width: `${(samples.filter((s) => s.rockType === 'metamorphic').length / samples.length) * 100}%`,
                }}
                title="Metamorphic"
              />
            </>
          ) : (
            <div className="bg-white/10 h-full w-full" />
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-gray-500 shrink-0">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-500/60" />
            Ign
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500/60" />
            Sed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-purple-500/60" />
            Met
          </span>
        </div>
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-white/10 pb-2">
        {(['samples', 'sites', 'stratigraphy', 'map'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium transition-colors ${activeTab === tab ? 'bg-orange-400/20 text-orange-400 border-b-2 border-orange-400' : 'text-gray-400 hover:text-white'}`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'samples' && (
        <div className="space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search samples..."
              className="w-full bg-black/30 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>

          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Add Sample</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                value={newSample.name}
                onChange={(e) => setNewSample({ ...newSample, name: e.target.value })}
                placeholder="Sample name"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <select
                value={newSample.rockType}
                onChange={(e) =>
                  setNewSample({ ...newSample, rockType: e.target.value as RockType })
                }
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              >
                <option value="igneous">Igneous</option>
                <option value="sedimentary">Sedimentary</option>
                <option value="metamorphic">Metamorphic</option>
              </select>
              <input
                value={newSample.location}
                onChange={(e) => setNewSample({ ...newSample, location: e.target.value })}
                placeholder="Collection location"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={addSample}
                className="px-4 py-2 bg-orange-400/20 text-orange-400 rounded-lg text-sm hover:bg-orange-400/30"
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {samples.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">No samples collected yet.</p>
            ) : (
              samples
                .filter(
                  (s) =>
                    !searchQuery ||
                    (s.name || s.title || '').toLowerCase().includes(searchQuery.toLowerCase())
                )
                .map((sample) => (
                  <div key={sample.id} className="panel p-4 flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Gem
                          className={`w-4 h-4 ${ROCK_COLORS[sample.rockType as RockType] || 'text-gray-400'}`}
                        />
                        <span className="font-medium">{sample.name || sample.title}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-white/10 text-gray-300">
                          {sample.rockType}
                        </span>
                      </div>
                      <div className="flex gap-4 mt-1 text-xs text-gray-400">
                        {sample.location && (
                          <span>
                            <MapPin className="w-3 h-3 inline" /> {sample.location}
                          </span>
                        )}
                        {sample.age && <span>Age: {sample.age}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleAction(sample.id)}
                        className="text-gray-500 hover:text-neon-cyan"
                        title="Run AI analysis"
                      >
                        <Zap className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() =>
                          update(sample.id, {
                            data: {
                              ...sample,
                              lastUpdated: new Date().toISOString(),
                            } as unknown as Partial<Record<string, unknown>>,
                          })
                        }
                        className="text-gray-500 hover:text-yellow-400"
                        title="Update"
                      >
                        <Gem className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => remove(sample.id)}
                        className="text-gray-500 hover:text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'sites' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3">Add Field Site</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
              <input
                value={newSite.name}
                onChange={(e) => setNewSite({ ...newSite, name: e.target.value })}
                placeholder="Site name"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <input
                value={newSite.location}
                onChange={(e) => setNewSite({ ...newSite, location: e.target.value })}
                placeholder="Location"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="any"
                value={newSite.lat}
                onChange={(e) => setNewSite({ ...newSite, lat: e.target.value })}
                placeholder="Latitude"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="any"
                value={newSite.lng}
                onChange={(e) => setNewSite({ ...newSite, lng: e.target.value })}
                placeholder="Longitude"
                className="bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-sm"
              />
              <button
                onClick={addSite}
                className="px-4 py-2 bg-orange-400/20 text-orange-400 rounded-lg text-sm hover:bg-orange-400/30"
              >
                <Plus className="w-4 h-4 inline mr-1" /> Add Site
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {sites.map((site) => (
              <div key={site.id} className="panel p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-orange-400" />
                    <span className="font-medium">{site.name || site.title}</span>
                  </div>
                  <button
                    onClick={() => removeSite(site.id)}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">{site.location}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'map' && (
        <div className="space-y-4">
          <div className="panel p-4">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Map className="w-4 h-4 text-orange-400" /> Field Sites Map
            </h3>
            <MapView
              markers={[
                ...sites
                  .filter((s) => s.lat && s.lng)
                  .map((s) => ({
                    lat: s.lat!,
                    lng: s.lng!,
                    label: s.name || s.title,
                    popup: s.location || '',
                  })),
                ...samples
                  .filter((s) => s.coordinates?.lat && s.coordinates?.lng)
                  .map((s) => ({
                    lat: s.coordinates!.lat,
                    lng: s.coordinates!.lng,
                    label: s.name || s.title,
                    popup: `${s.rockType || ''} - ${s.location || ''}`,
                  })),
              ]}
              className="h-[500px]"
            />
          </div>
        </div>
      )}

      {activeTab === 'stratigraphy' && (
        <div className="panel p-4">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4 text-orange-400" /> Stratigraphic Column
          </h3>
          <div className="space-y-1">
            {[
              {
                era: 'Cenozoic',
                period: 'Quaternary',
                age: '2.6 Ma - Present',
                color: 'bg-yellow-500/20',
              },
              { era: 'Cenozoic', period: 'Neogene', age: '23 - 2.6 Ma', color: 'bg-yellow-600/20' },
              {
                era: 'Cenozoic',
                period: 'Paleogene',
                age: '66 - 23 Ma',
                color: 'bg-orange-500/20',
              },
              {
                era: 'Mesozoic',
                period: 'Cretaceous',
                age: '145 - 66 Ma',
                color: 'bg-green-500/20',
              },
              { era: 'Mesozoic', period: 'Jurassic', age: '201 - 145 Ma', color: 'bg-blue-500/20' },
              {
                era: 'Mesozoic',
                period: 'Triassic',
                age: '252 - 201 Ma',
                color: 'bg-purple-500/20',
              },
              { era: 'Paleozoic', period: 'Permian', age: '299 - 252 Ma', color: 'bg-red-500/20' },
            ].map((layer) => (
              <div
                key={layer.period}
                className={`flex items-center justify-between p-3 rounded-lg ${layer.color}`}
              >
                <div>
                  <span className="text-sm font-medium">{layer.period}</span>
                  <span className="text-xs text-gray-400 ml-2">{layer.era}</span>
                </div>
                <span className="text-xs text-gray-400">{layer.age}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="geology" />
      </div>
    </LensPageShell>
  );
}
