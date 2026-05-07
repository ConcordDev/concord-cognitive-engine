'use client';

import { useState, useMemo, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Compass, MapPin, Plane, Hotel, Calendar, Plus, Search, X, Trash2, DollarSign, Clock, Star, Globe, Layers, ChevronDown, Map,
  Users, CheckSquare, Square, Luggage,
} from 'lucide-react';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ModeTab = 'trips' | 'itineraries' | 'bookings' | 'packing' | 'map';

interface TripData {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  budget: number;
  spent: number;
  status: 'planning' | 'booked' | 'in-progress' | 'completed';
  notes: string;
  travelers: string[];
  activities: string[];
  lat?: number;
  lng?: number;
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'text-yellow-400 bg-teal-400/10',
  booked: 'text-neon-cyan bg-neon-cyan/10',
  'in-progress': 'text-neon-green bg-neon-green/10',
  completed: 'text-gray-400 bg-gray-400/10',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TravelLensPage() {
  useLensNav('travel');
  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('travel');
  const [tab, setTab] = useState<ModeTab>('trips');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);
  const [newTrip, setNewTrip] = useState({ name: '', destination: '', startDate: '', endDate: '', budget: 0, lat: '', lng: '' });

  // Packing list state
  const [packingItems, setPackingItems] = useState<{ text: string; checked: boolean }[]>([]);
  const [newPackItem, setNewPackItem] = useState('');

  const {
    items, isLoading, isError, error, refetch,
    create, createMut, update, remove, deleteMut,
  } = useLensData<TripData>('travel', 'trip', { seed: [] });

  const trips = useMemo(() =>
    items.map(item => ({
      id: item.id,
      ...item.data,
      name: item.title || item.data?.name || 'Untitled Trip',
    })).filter(t => !search || t.name?.toLowerCase().includes(search.toLowerCase()) || t.destination?.toLowerCase().includes(search.toLowerCase())),
    [items, search]
  );

  const stats = useMemo(() => ({
    total: trips.length,
    planning: trips.filter(t => t.status === 'planning').length,
    booked: trips.filter(t => t.status === 'booked').length,
    inProgress: trips.filter(t => t.status === 'in-progress').length,
    completed: trips.filter(t => t.status === 'completed').length,
    totalBudget: trips.reduce((s, t) => s + (t.budget || 0), 0),
    totalSpent: trips.reduce((s, t) => s + (t.spent || 0), 0),
  }), [trips]);

  // Next upcoming trip countdown
  const nextTrip = useMemo(() => {
    const now = Date.now();
    const upcoming = trips
      .filter(t => t.startDate && new Date(t.startDate).getTime() > now && (t.status === 'booked' || t.status === 'planning'))
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    return upcoming[0] || null;
  }, [trips]);

  const daysUntilNext = nextTrip ? Math.ceil((new Date(nextTrip.startDate).getTime() - Date.now()) / 86400000) : null;

  const TABS: { id: ModeTab; label: string; icon: typeof Globe }[] = [
    { id: 'trips', label: 'Trips', icon: Globe },
    { id: 'packing', label: 'Packing', icon: Luggage },
    { id: 'bookings', label: 'Bookings', icon: Hotel },
    { id: 'map', label: 'Map', icon: Map },
  ];

  const handleCreate = useCallback(async () => {
    if (!newTrip.name.trim()) return;
    await create({
      title: newTrip.name,
      data: {
        name: newTrip.name,
        destination: newTrip.destination,
        startDate: newTrip.startDate,
        endDate: newTrip.endDate,
        budget: newTrip.budget,
        spent: 0,
        status: 'planning',
        notes: '',
        travelers: [],
        activities: [],
        lat: newTrip.lat ? Number(newTrip.lat) : undefined,
        lng: newTrip.lng ? Number(newTrip.lng) : undefined,
      },
    });
    setNewTrip({ name: '', destination: '', startDate: '', endDate: '', budget: 0, lat: '', lng: '' });
    setShowCreate(false);
  }, [newTrip, create]);

  if (isError) {
    return (
      <div data-lens-theme="travel" className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div data-lens-theme="travel" className="p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/30 to-teal-500/30 border border-cyan-500/20 flex items-center justify-center">
            <Compass className="w-5 h-5 text-neon-cyan" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Travel Lens</h1>
            <p className="text-sm text-gray-400">Trip planning & travel management</p>
          </div>
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="travel" data={realtimeData || {}} compact />
        </div>
        <button onClick={() => setShowCreate(!showCreate)} className="btn-neon">
          <Plus className="w-4 h-4 mr-2 inline" /> New Trip
        </button>
      </header>

      {/* Upcoming trip countdown */}
      {nextTrip && daysUntilNext !== null && daysUntilNext > 0 && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="panel p-4 bg-gradient-to-r from-cyan-500/10 via-transparent to-teal-500/10 border-cyan-500/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Plane className="w-5 h-5 text-neon-cyan" />
            <div>
              <p className="text-sm font-medium text-white">Next trip: <span className="text-neon-cyan">{nextTrip.name}</span></p>
              <p className="text-xs text-gray-400">{nextTrip.destination ? `${nextTrip.destination} — ` : ''}{nextTrip.startDate}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-neon-cyan">{daysUntilNext}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">days away</p>
          </div>
        </motion.div>
      )}

      <UniversalActions domain="travel" artifactId={items[0]?.id} compact />

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="panel p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Plan a New Trip</h3>
                <button onClick={() => setShowCreate(false)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={newTrip.name} onChange={e => setNewTrip(p => ({ ...p, name: e.target.value }))} placeholder="Trip name..." className="input-lattice" />
                <input value={newTrip.destination} onChange={e => setNewTrip(p => ({ ...p, destination: e.target.value }))} placeholder="Destination..." className="input-lattice" />
                <input type="date" value={newTrip.startDate} onChange={e => setNewTrip(p => ({ ...p, startDate: e.target.value }))} className="input-lattice" />
                <input type="date" value={newTrip.endDate} onChange={e => setNewTrip(p => ({ ...p, endDate: e.target.value }))} className="input-lattice" />
                <input type="number" value={newTrip.budget || ''} onChange={e => setNewTrip(p => ({ ...p, budget: Number(e.target.value) }))} placeholder="Budget..." className="input-lattice" />
                <input type="number" step="any" value={newTrip.lat} onChange={e => setNewTrip(p => ({ ...p, lat: e.target.value }))} placeholder="Latitude (optional)" className="input-lattice" />
                <input type="number" step="any" value={newTrip.lng} onChange={e => setNewTrip(p => ({ ...p, lng: e.target.value }))} placeholder="Longitude (optional)" className="input-lattice" />
              </div>
              <button onClick={handleCreate} disabled={createMut.isPending || !newTrip.name.trim()} className="btn-neon green w-full">
                {createMut.isPending ? 'Creating...' : 'Create Trip'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="lens-card"><Globe className="w-5 h-5 text-neon-cyan mb-2" /><p className="text-2xl font-bold">{stats.total}</p><p className="text-sm text-gray-400">Total Trips</p></div>
        <div className="lens-card"><Calendar className="w-5 h-5 text-yellow-400 mb-2" /><p className="text-2xl font-bold">{stats.planning}</p><p className="text-sm text-gray-400">Planning</p></div>
        <div className="lens-card"><Plane className="w-5 h-5 text-neon-green mb-2" /><p className="text-2xl font-bold">{stats.booked}</p><p className="text-sm text-gray-400">Booked</p></div>
        <div className="lens-card">
          <DollarSign className="w-5 h-5 text-neon-purple mb-2" />
          <p className="text-2xl font-bold">${stats.totalBudget.toLocaleString()}</p>
          <p className="text-sm text-gray-400">Total Budget</p>
          {stats.totalBudget > 0 && (
            <div className="mt-2 w-full bg-white/5 rounded-full h-1.5">
              <div
                className={cn('h-full rounded-full transition-all', stats.totalSpent / stats.totalBudget > 0.8 ? 'bg-red-400' : stats.totalSpent / stats.totalBudget > 0.5 ? 'bg-yellow-400' : 'bg-neon-green')}
                style={{ width: `${Math.min(100, (stats.totalSpent / stats.totalBudget) * 100)}%` }}
              />
            </div>
          )}
        </div>
        <div className="lens-card">
          <DollarSign className="w-5 h-5 text-neon-green mb-2" />
          <p className="text-2xl font-bold">${(stats.totalBudget - stats.totalSpent).toLocaleString()}</p>
          <p className="text-sm text-gray-400">Remaining</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-lattice-surface p-1 rounded-lg border border-lattice-border">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn('flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors', tab === t.id ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400 hover:text-white hover:bg-white/5')}>
            <t.icon className="w-4 h-4" /> {t.label}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab === 'trips' && (
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search trips..." className="w-full bg-lattice-void border border-lattice-border rounded-lg pl-9 pr-3 py-2 text-sm" />
        </div>
      )}

      {/* Trips Tab */}
      {tab === 'trips' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="panel p-6 text-center text-gray-400">Loading trips...</div>
          ) : trips.length === 0 ? (
            <div className="panel p-8 text-center">
              <Compass className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400">No trips planned yet.</p>
              <p className="text-sm text-gray-600 mt-1">Start mapping your next adventure.</p>
              <button onClick={() => setShowCreate(true)} className="mt-4 btn-neon text-sm"><Plus className="w-4 h-4 inline mr-1" /> Plan a Trip</button>
            </div>
          ) : (
            trips.map((trip, i) => {
              const budgetRatio = trip.budget > 0 ? trip.spent / trip.budget : 0;
              const daysUntil = trip.startDate ? Math.ceil((new Date(trip.startDate).getTime() - Date.now()) / 86400000) : null;
              const tripDuration = trip.startDate && trip.endDate ? Math.ceil((new Date(trip.endDate).getTime() - new Date(trip.startDate).getTime()) / 86400000) : null;
              return (
                <motion.div key={trip.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="panel p-4 hover:border-cyan-500/30 transition-all">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white truncate">{trip.name}</h3>
                        <span className={cn('text-xs px-2 py-0.5 rounded', STATUS_COLORS[trip.status || 'planning'])}>{trip.status}</span>
                        {daysUntil !== null && daysUntil > 0 && daysUntil <= 30 && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 font-medium">{daysUntil}d away</span>
                        )}
                      </div>
                      {trip.destination && (
                        <p className="text-sm font-medium bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent mb-1">
                          <MapPin className="w-3 h-3 inline text-neon-cyan mr-1" />{trip.destination}
                        </p>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
                        {trip.startDate && <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{trip.startDate}{trip.endDate ? ` — ${trip.endDate}` : ''}</span>}
                        {tripDuration && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{tripDuration} days</span>}
                        {trip.budget > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3" />${trip.budget.toLocaleString()}</span>}
                        {trip.travelers?.length > 0 && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{trip.travelers.length} travelers</span>}
                        {trip.activities?.length > 0 && <span className="flex items-center gap-1"><Star className="w-3 h-3" />{trip.activities.length} activities</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button onClick={() => { const nextStatus = trip.status === 'planning' ? 'booked' : trip.status === 'booked' ? 'in-progress' : trip.status === 'in-progress' ? 'completed' : 'planning'; update(trip.id, { data: { ...trip, status: nextStatus } as unknown as Partial<TripData> }); }} className="text-gray-500 hover:text-neon-cyan p-1" title="Advance status">
                        <CheckSquare className="w-4 h-4" />
                      </button>
                      <button onClick={() => remove(trip.id)} disabled={deleteMut.isPending} className="text-gray-500 hover:text-red-400 p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {/* Budget progress bar */}
                  {trip.budget > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[10px] text-gray-500 mb-1">
                        <span>${trip.spent?.toLocaleString() || 0} spent</span>
                        <span>${trip.budget.toLocaleString()} budget</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5">
                        <div
                          className={cn('h-full rounded-full transition-all', budgetRatio > 0.8 ? 'bg-red-400' : budgetRatio > 0.5 ? 'bg-yellow-400' : 'bg-neon-green')}
                          style={{ width: `${Math.min(100, budgetRatio * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      )}

      {/* Packing Tab */}
      {tab === 'packing' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input
              value={newPackItem}
              onChange={e => setNewPackItem(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newPackItem.trim()) {
                  setPackingItems(prev => [...prev, { text: newPackItem.trim(), checked: false }]);
                  setNewPackItem('');
                }
              }}
              placeholder="Add item to packing list..."
              className="flex-1 input-lattice"
            />
            <button
              onClick={() => {
                if (newPackItem.trim()) {
                  setPackingItems(prev => [...prev, { text: newPackItem.trim(), checked: false }]);
                  setNewPackItem('');
                }
              }}
              className="btn-neon"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          {packingItems.length > 0 && (
            <div className="panel p-1">
              <div className="flex items-center justify-between px-3 py-2 border-b border-lattice-border">
                <span className="text-xs text-gray-400">{packingItems.filter(i => i.checked).length}/{packingItems.length} packed</span>
                <div className="w-24 bg-white/5 rounded-full h-1.5">
                  <div className="h-full rounded-full bg-neon-cyan transition-all" style={{ width: `${packingItems.length > 0 ? (packingItems.filter(i => i.checked).length / packingItems.length) * 100 : 0}%` }} />
                </div>
              </div>
              {packingItems.map((item, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors group">
                  <button onClick={() => setPackingItems(prev => prev.map((p, j) => j === i ? { ...p, checked: !p.checked } : p))}>
                    {item.checked ? <CheckSquare className="w-4 h-4 text-neon-cyan" /> : <Square className="w-4 h-4 text-gray-500" />}
                  </button>
                  <span className={cn('flex-1 text-sm', item.checked && 'line-through text-gray-600')}>{item.text}</span>
                  <button onClick={() => setPackingItems(prev => prev.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </motion.div>
              ))}
            </div>
          )}
          {packingItems.length === 0 && (
            <div className="panel p-8 text-center">
              <Luggage className="w-10 h-10 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 text-sm">Your packing list is empty.</p>
              <p className="text-xs text-gray-600 mt-1">Add items above to keep track of what to pack.</p>
            </div>
          )}
        </div>
      )}

      {/* Bookings Tab */}
      {tab === 'bookings' && (
        <div className="panel p-8 text-center">
          <Hotel className="w-12 h-12 mx-auto mb-3 text-gray-600" />
          <p className="text-gray-400 text-sm mb-1">Bookings</p>
          <p className="text-xs text-gray-600">Track flights, hotels, car rentals, and activities for your trips.</p>
          <div className="mt-4 grid grid-cols-3 gap-3 max-w-sm mx-auto">
            <div className="panel p-3 text-center"><Plane className="w-5 h-5 mx-auto mb-1 text-neon-cyan" /><p className="text-[10px] text-gray-400">Flights</p></div>
            <div className="panel p-3 text-center"><Hotel className="w-5 h-5 mx-auto mb-1 text-neon-purple" /><p className="text-[10px] text-gray-400">Hotels</p></div>
            <div className="panel p-3 text-center"><Star className="w-5 h-5 mx-auto mb-1 text-yellow-400" /><p className="text-[10px] text-gray-400">Activities</p></div>
          </div>
        </div>
      )}

      {/* Map Tab */}
      {tab === 'map' && (
        <div className="space-y-4">
          {trips.some(t => t.lat && t.lng) ? (
            <div className="panel p-4 space-y-2">
              <h3 className="font-semibold flex items-center gap-2"><Map className="w-4 h-4 text-neon-cyan" /> Trip Destinations</h3>
              <MapView
                markers={trips.filter(t => t.lat && t.lng).map(t => ({ lat: t.lat!, lng: t.lng!, label: t.name, popup: `${t.destination || ''} ${t.status || ''}`.trim() }))}
                className="h-[450px]"
              />
            </div>
          ) : (
            <div className="panel p-8 text-center">
              <Map className="w-12 h-12 mx-auto mb-3 text-gray-600" />
              <p className="text-gray-400 text-sm">No trips with coordinates yet.</p>
              <p className="text-xs text-gray-600 mt-1">Add latitude and longitude when creating trips to see them on the map.</p>
            </div>
          )}
        </div>
      )}

      <RealtimeDataPanel domain="travel" data={realtimeData} isLive={isLive} lastUpdated={lastUpdated} insights={insights} compact />

      <div className="border-t border-white/10">
        <button onClick={() => setShowFeatures(!showFeatures)} className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg">
          <span className="flex items-center gap-2"><Layers className="w-4 h-4" />Lens Features & Capabilities</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', showFeatures && 'rotate-180')} />
        </button>
        {showFeatures && <div className="px-4 pb-4"><LensFeaturePanel lensId="travel" /></div>}
      </div>
    </div>
  );
}
