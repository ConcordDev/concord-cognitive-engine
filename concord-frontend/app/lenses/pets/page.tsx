'use client';

import { useState, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import {
  PawPrint, Plus, Search, Trash2, Calendar, Heart,
  Stethoscope, Clock, Star, Layers, ChevronDown, Syringe, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

interface PetData {
  name: string;
  species: string;
  breed: string;
  age: number;
  weight: number;
  vetName: string;
  vetPhone: string;
  nextVetVisit: string;
  medications: string[];
  allergies: string[];
  food: string;
  feedingSchedule: string;
  notes: string;
}

const SPECIES_ICONS: Record<string, string> = {
  dog: 'bg-amber-400/10 text-amber-400',
  cat: 'bg-purple-400/10 text-purple-400',
  bird: 'bg-sky-400/10 text-sky-400',
  fish: 'bg-blue-400/10 text-blue-400',
  rabbit: 'bg-pink-400/10 text-pink-400',
  reptile: 'bg-green-400/10 text-green-400',
};

export default function PetsLensPage() {
  useLensNav('pets');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('pets');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(false);
  const [newPet, setNewPet] = useState({ name: '', species: 'dog', breed: '', age: 0 });

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, remove, deleteMut,
  } = useLensData<PetData>('pets', 'pet', { seed: [] });

  const pets = useMemo(() =>
    items.map(item => ({ id: item.id, ...item.data, name: item.title || item.data?.name || 'Unnamed Pet' }))
      .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.species?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const stats = useMemo(() => ({
    total: pets.length,
    species: [...new Set(pets.map(p => p.species).filter(Boolean))].length,
    needsVet: pets.filter(p => {
      if (!p.nextVetVisit) return false;
      return new Date(p.nextVetVisit) <= new Date(Date.now() + 30 * 86400000);
    }).length,
    onMeds: pets.filter(p => (p.medications?.length || 0) > 0).length,
  }), [pets]);

  const handleCreate = useCallback(async () => {
    if (!newPet.name.trim()) return;
    await create({
      title: newPet.name,
      data: {
        name: newPet.name, species: newPet.species, breed: newPet.breed,
        age: newPet.age, weight: 0, vetName: '', vetPhone: '',
        nextVetVisit: '', medications: [], allergies: [],
        food: '', feedingSchedule: '', notes: '',
      },
    });
    setNewPet({ name: '', species: 'dog', breed: '', age: 0 });
    setShowCreate(false);
  }, [newPet, create]);

  if (isError) return <div className="flex items-center justify-center h-full p-8"><ErrorState error={error?.message} onRetry={refetch} /></div>;

  return (
    <div data-lens-theme="pets" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PawPrint className="w-6 h-6 text-amber-400" />
          <div>
            <h1 className="text-xl font-bold">Pets Lens</h1>
            <p className="text-sm text-gray-400">Pet care & management</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="pets" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> Add Pet
        </button>
      </header>

      <UniversalActions domain="pets" artifactId={items[0]?.id} compact />

      {showCreate && (
        <div className="panel p-4 space-y-3">
          <h3 className="font-semibold">Add a Pet</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newPet.name} onChange={e => setNewPet(p => ({ ...p, name: e.target.value }))} placeholder="Pet name..." className="input-lattice" />
            <select value={newPet.species} onChange={e => setNewPet(p => ({ ...p, species: e.target.value }))} className="input-lattice">
              <option value="dog">Dog</option><option value="cat">Cat</option><option value="bird">Bird</option>
              <option value="fish">Fish</option><option value="rabbit">Rabbit</option><option value="reptile">Reptile</option>
            </select>
            <input value={newPet.breed} onChange={e => setNewPet(p => ({ ...p, breed: e.target.value }))} placeholder="Breed..." className="input-lattice" />
            <input type="number" value={newPet.age || ''} onChange={e => setNewPet(p => ({ ...p, age: Number(e.target.value) }))} placeholder="Age (years)..." className="input-lattice" />
          </div>
          <button onClick={handleCreate} disabled={createMut.isPending || !newPet.name.trim()} className="btn-neon green w-full">
            {createMut.isPending ? 'Adding...' : 'Add Pet'}
          </button>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="lens-card"><PawPrint className="w-5 h-5 text-amber-400 mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Pet Count</p></div>
        <div className="lens-card"><Syringe className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{stats.needsVet}</p><p className="text-sm text-gray-400">Upcoming Vet Visits</p></div>
        <div className="lens-card"><ShieldCheck className="w-5 h-5 text-green-400 mb-2" /><p className="text-2xl font-bold">{stats.onMeds}</p><p className="text-sm text-gray-400">Vaccination Status</p></div>
        <div className="lens-card"><Heart className="w-5 h-5 text-pink-400 mb-2" /><p className="text-2xl font-bold">{stats.species}</p><p className="text-sm text-gray-400">Species</p></div>
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search pets..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          <div className="col-span-full panel p-6 text-center text-gray-400">Loading pets...</div>
        ) : pets.length === 0 ? (
          <div className="col-span-full panel p-6 text-center text-gray-400">No pets added yet.</div>
        ) : pets.map((pet, index) => (
          <motion.div key={pet.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }} className="panel p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white truncate">{pet.name}</h3>
              <button onClick={() => remove(pet.id)} className="text-gray-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs mb-2">
              <span className={cn('px-2 py-0.5 rounded capitalize', SPECIES_ICONS[pet.species] || 'bg-gray-400/10 text-gray-400')}>{pet.species}</span>
              {pet.breed && <span className="px-2 py-0.5 rounded bg-lattice-elevated text-gray-300">{pet.breed}</span>}
              {pet.age > 0 && <span className="px-2 py-0.5 rounded bg-lattice-elevated text-gray-300">{pet.age}y</span>}
            </div>
            {pet.nextVetVisit && (
              <p className="text-xs text-gray-400 flex items-center gap-1"><Calendar className="w-3 h-3" />Vet: {pet.nextVetVisit}</p>
            )}
          </motion.div>
        ))}
      </div>

      <RealtimeDataPanel domain="pets" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-white transition-colors">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="pets" /></div>}
      </div>
    </div>
  );
}
