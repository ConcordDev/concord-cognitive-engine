'use client';

/**
 * TripWorkspace — TripIt / Google Travel feature-parity workbench for a
 * single trip. This is the ONE trip-detail surface in the travel lens (the
 * 2026-07-09 rebuild consolidated three separate, partially-overlapping
 * trip-detail UIs — the page's own generic-artifact "trip" CRUD,
 * `TravelTripsPanel`'s itinerary/booking/checklist forms, and this
 * component's map/agenda/weather/search/import/status/share/budget tabs —
 * into this single component so there is exactly one place a trip's
 * itinerary, bookings, packing list, budget and collaborators live).
 *
 * Tabs: itinerary add/list, map (geocode + pins + route), day-by-day
 * agenda, destination weather forecast (Open-Meteo), live flight/hotel
 * search (OpenSky + OSM Overpass) + booking add/import, flight-status
 * tracking, collaborative trip sharing, packing checklist, and a
 * per-category budget breakdown with live currency conversion.
 *
 * All data is real: user input or live free public APIs, all via the
 * `travel` domain's registered macros. No mock data.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Loader2, MapPin, CalendarDays, CloudSun, Plane, Hotel, Mail,
  Radar, Users, PieChart, ChevronLeft, RefreshCw, Plus, Trash2, X,
  ListPlus, Luggage, Check,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const MapView = dynamic(() => import('@/components/common/MapView'), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceTrip {
  id: string;
  name: string;
  destination: string;
  startDate: string | null;
  endDate: string | null;
}

interface ItineraryItem {
  id: string;
  title: string;
  day: string | null;
  time: string | null;
  category: string;
  location: string | null;
  note?: string | null;
  lat?: number;
  lng?: number;
  resolvedAddress?: string | null;
}

interface MapPoint {
  id: string;
  title: string;
  lat: number;
  lng: number;
  day: string | null;
  time: string | null;
  category: string;
  address: string | null;
}

interface AgendaDay {
  day: string;
  dayNumber: number;
  weekday: string;
  items: ItineraryItem[];
  itemCount: number;
}

interface WeatherDay {
  date: string;
  tempMax: number | null;
  tempMin: number | null;
  precipChance: number | null;
  condition: string;
}

interface LiveFlight {
  icao24: string;
  callsign: string;
  originCountry: string;
  latitude: number | null;
  longitude: number | null;
  baroAltitudeM: number | null;
  velocityMs: number | null;
}

interface Lodging {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  stars: string | null;
  website: string | null;
}

interface Collaborator {
  userId: string;
  role: string;
  sharedAt: string;
}

interface BudgetLine {
  category: string;
  planned: number;
  booked: number;
  remaining: number;
  overBudget: boolean;
  utilization: number | null;
}

interface BudgetBreakdown {
  lines: BudgetLine[];
  totalPlanned: number;
  totalBooked: number;
  totalRemaining: number;
  currency: string;
  displayCurrency?: string;
  fxRate?: number;
  converted?: { totalPlanned: number; totalBooked: number; totalRemaining: number };
}

interface Booking {
  id: string;
  type: string;
  provider: string | null;
  confirmationCode: string | null;
  cost: number;
  date: string | null;
  note: string | null;
}

interface ChecklistItem {
  id: string;
  item: string;
  category: string;
  done: boolean;
}

type WsTab = 'itinerary' | 'map' | 'agenda' | 'weather' | 'flights' | 'bookings' | 'status' | 'share' | 'budget' | 'packing';

const TABS: { id: WsTab; label: string; icon: typeof MapPin }[] = [
  { id: 'itinerary', label: 'Itinerary', icon: ListPlus },
  { id: 'map', label: 'Map', icon: MapPin },
  { id: 'agenda', label: 'Agenda', icon: CalendarDays },
  { id: 'weather', label: 'Weather', icon: CloudSun },
  { id: 'flights', label: 'Search', icon: Plane },
  { id: 'bookings', label: 'Bookings', icon: Mail },
  { id: 'status', label: 'Flight status', icon: Radar },
  { id: 'packing', label: 'Packing', icon: Luggage },
  { id: 'share', label: 'Collaborate', icon: Users },
  { id: 'budget', label: 'Budget', icon: PieChart },
];

const ITIN_CATEGORIES = ['sightseeing', 'food', 'transport', 'lodging', 'activity', 'meeting', 'rest'];
const BOOKING_TYPES = ['flight', 'hotel', 'car', 'rail', 'activity', 'cruise'];

const CATEGORY_COLOR: Record<string, string> = {
  sightseeing: 'text-sky-400', food: 'text-amber-400', transport: 'text-cyan-400',
  lodging: 'text-purple-400', activity: 'text-emerald-400', meeting: 'text-rose-400', rest: 'text-zinc-400',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TripWorkspace({ trip, onBack }: { trip: WorkspaceTrip; onBack: () => void }) {
  const [tab, setTab] = useState<WsTab>('itinerary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Itinerary + map
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([]);
  const [itinForm, setItinForm] = useState({ title: '', day: '', time: '', category: 'sightseeing', location: '', note: '' });
  const [mapPoints, setMapPoints] = useState<MapPoint[]>([]);
  const [routeKm, setRouteKm] = useState(0);
  const [ungeocoded, setUngeocoded] = useState(0);
  const [geocoding, setGeocoding] = useState<string | null>(null);

  // Agenda
  const [agenda, setAgenda] = useState<AgendaDay[]>([]);
  const [unscheduled, setUnscheduled] = useState<ItineraryItem[]>([]);

  // Weather
  const [weatherCoords, setWeatherCoords] = useState({ lat: '', lng: '' });
  const [weather, setWeather] = useState<{ days: WeatherDay[]; tempUnit: string } | null>(null);

  // Flight/hotel search
  const [airlineFilter, setAirlineFilter] = useState('');
  const [liveFlights, setLiveFlights] = useState<LiveFlight[]>([]);
  const [hotelCoords, setHotelCoords] = useState({ lat: '', lng: '' });
  const [lodging, setLodging] = useState<Lodging[]>([]);

  // Bookings (manual add + list) + email import
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingTotal, setBookingTotal] = useState(0);
  const [bookForm, setBookForm] = useState({ type: 'flight', provider: '', cost: '', date: '' });
  const [emailText, setEmailText] = useState('');
  const [importResult, setImportResult] = useState<{
    type: string; confirmationCode: string | null; provider: string | null; cost: number; date: string | null; confidence: number;
  } | null>(null);

  // Flight status
  const [callsign, setCallsign] = useState('');
  const [flightStatus, setFlightStatus] = useState<Record<string, unknown> | null>(null);

  // Packing checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [ckItem, setCkItem] = useState('');
  const [ckCategory, setCkCategory] = useState('general');

  // Collaboration
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [shareForm, setShareForm] = useState({ collaborator: '', role: 'editor' });

  // Budget
  const [displayCurrency, setDisplayCurrency] = useState('USD');
  const [breakdown, setBreakdown] = useState<BudgetBreakdown | null>(null);
  const [budgetForm, setBudgetForm] = useState<Record<string, string>>({
    flights: '', accommodation: '', food: '', activities: '', transport: '',
  });

  // ── Loaders ───────────────────────────────────────────────────────────

  const loadItinerary = useCallback(async () => {
    const r = await lensRun('travel', 'itinerary-list', { tripId: trip.id });
    if (r.data?.ok) setItinerary((r.data.result?.items as ItineraryItem[]) || []);
  }, [trip.id]);

  const loadMap = useCallback(async () => {
    const r = await lensRun('travel', 'itinerary-map', { tripId: trip.id });
    if (r.data?.ok) {
      const res = r.data.result as { points: MapPoint[]; routeKm: number; ungeocoded: number };
      setMapPoints(res.points || []);
      setRouteKm(res.routeKm || 0);
      setUngeocoded(res.ungeocoded || 0);
    }
  }, [trip.id]);

  const loadAgenda = useCallback(async () => {
    const r = await lensRun('travel', 'itinerary-agenda', { tripId: trip.id });
    if (r.data?.ok) {
      const res = r.data.result as { agenda: AgendaDay[]; unscheduled: ItineraryItem[] };
      setAgenda(res.agenda || []);
      setUnscheduled(res.unscheduled || []);
    }
  }, [trip.id]);

  const loadBookings = useCallback(async () => {
    const r = await lensRun('travel', 'booking-list', { tripId: trip.id });
    if (r.data?.ok) {
      const res = r.data.result as { bookings: Booking[]; totalCost: number };
      setBookings(res.bookings || []);
      setBookingTotal(res.totalCost || 0);
    }
  }, [trip.id]);

  const loadChecklist = useCallback(async () => {
    const r = await lensRun('travel', 'checklist-list', { tripId: trip.id });
    if (r.data?.ok) setChecklist((r.data.result?.items as ChecklistItem[]) || []);
  }, [trip.id]);

  useEffect(() => {
    void loadItinerary(); void loadMap(); void loadAgenda(); void loadBookings(); void loadChecklist();
  }, [loadItinerary, loadMap, loadAgenda, loadBookings, loadChecklist]);

  // ── Itinerary actions ────────────────────────────────────────────────

  const addItinItem = useCallback(async () => {
    if (!itinForm.title.trim()) { setError('Itinerary item title is required.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'itinerary-add', {
        tripId: trip.id, title: itinForm.title.trim(), day: itinForm.day, time: itinForm.time,
        category: itinForm.category, location: itinForm.location.trim(), note: itinForm.note.trim(),
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Could not add item.'); return; }
      setItinForm({ title: '', day: '', time: '', category: 'sightseeing', location: '', note: '' });
      await Promise.all([loadItinerary(), loadAgenda(), loadMap()]);
    } finally { setBusy(false); }
  }, [itinForm, trip.id, loadItinerary, loadAgenda, loadMap]);

  const delItinItem = useCallback(async (id: string) => {
    await lensRun('travel', 'itinerary-delete', { tripId: trip.id, id });
    await Promise.all([loadItinerary(), loadAgenda(), loadMap()]);
  }, [trip.id, loadItinerary, loadAgenda, loadMap]);

  const geocodeItem = useCallback(async (item: ItineraryItem) => {
    setGeocoding(item.id);
    setError(null);
    try {
      const r = await lensRun('travel', 'itinerary-geocode', { tripId: trip.id, id: item.id });
      if (r.data?.ok) {
        await loadItinerary();
        await loadMap();
      } else {
        setError(r.data?.error || 'Could not geocode this item.');
      }
    } finally {
      setGeocoding(null);
    }
  }, [trip.id, loadItinerary, loadMap]);

  // ── Weather / search ─────────────────────────────────────────────────

  const fetchWeather = useCallback(async () => {
    const lat = Number(weatherCoords.lat);
    const lng = Number(weatherCoords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setError('Enter valid coordinates.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'weather-forecast', { lat, lng });
      if (r.data?.ok) setWeather(r.data.result as { days: WeatherDay[]; tempUnit: string });
      else setError(r.data?.error || 'Weather unavailable.');
    } finally { setBusy(false); }
  }, [weatherCoords]);

  const searchFlights = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'flight-search', { airline: airlineFilter.trim() });
      if (r.data?.ok) setLiveFlights((r.data.result?.flights as LiveFlight[]) || []);
      else setError(r.data?.error || 'Flight search unavailable.');
    } finally { setBusy(false); }
  }, [airlineFilter]);

  const searchHotels = useCallback(async () => {
    const lat = Number(hotelCoords.lat);
    const lng = Number(hotelCoords.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setError('Enter valid coordinates.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'hotel-search', { lat, lng });
      if (r.data?.ok) setLodging((r.data.result?.lodging as Lodging[]) || []);
      else setError(r.data?.error || 'Hotel search unavailable.');
    } finally { setBusy(false); }
  }, [hotelCoords]);

  // ── Bookings ─────────────────────────────────────────────────────────

  const addBooking = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'booking-add', {
        tripId: trip.id, type: bookForm.type, provider: bookForm.provider.trim(),
        cost: Number(bookForm.cost) || 0, date: bookForm.date,
      });
      if (r.data?.ok === false) { setError(r.data?.error || 'Could not add booking.'); return; }
      setBookForm({ type: 'flight', provider: '', cost: '', date: '' });
      await loadBookings();
    } finally { setBusy(false); }
  }, [bookForm, trip.id, loadBookings]);

  const delBooking = useCallback(async (id: string) => {
    await lensRun('travel', 'booking-delete', { tripId: trip.id, id });
    await loadBookings();
  }, [trip.id, loadBookings]);

  const importBooking = useCallback(async () => {
    if (!emailText.trim()) { setError('Paste a confirmation email first.'); return; }
    setBusy(true); setError(null); setImportResult(null);
    try {
      const r = await lensRun('travel', 'booking-import', { tripId: trip.id, emailText: emailText.trim() });
      if (r.data?.ok) {
        setImportResult(r.data.result?.parsed as typeof importResult);
        setEmailText('');
        await Promise.all([loadItinerary(), loadAgenda(), loadBookings()]);
      } else {
        setError(r.data?.error || 'Could not parse this email.');
      }
    } finally { setBusy(false); }
  }, [emailText, trip.id, loadItinerary, loadAgenda, loadBookings]);

  const trackFlight = useCallback(async () => {
    if (!callsign.trim()) { setError('Enter a flight callsign.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'flight-status', { callsign: callsign.trim() });
      if (r.data?.ok) setFlightStatus(r.data.result as Record<string, unknown>);
      else setError(r.data?.error || 'Flight status unavailable.');
    } finally { setBusy(false); }
  }, [callsign]);

  // ── Packing checklist ────────────────────────────────────────────────

  const addChecklistItem = useCallback(async () => {
    if (!ckItem.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'checklist-add', { tripId: trip.id, item: ckItem.trim(), category: ckCategory.trim() || 'general' });
      if (r.data?.ok === false) { setError(r.data?.error || 'Could not add item.'); return; }
      setCkItem('');
      await loadChecklist();
    } finally { setBusy(false); }
  }, [ckItem, ckCategory, trip.id, loadChecklist]);

  const toggleChecklistItem = useCallback(async (id: string) => {
    await lensRun('travel', 'checklist-toggle', { tripId: trip.id, id });
    await loadChecklist();
  }, [trip.id, loadChecklist]);

  const removeChecklistItem = useCallback(async (id: string) => {
    await lensRun('travel', 'checklist-toggle', { tripId: trip.id, id, remove: true });
    await loadChecklist();
  }, [trip.id, loadChecklist]);

  // ── Collaboration ────────────────────────────────────────────────────

  const shareTrip = useCallback(async () => {
    if (!shareForm.collaborator.trim()) { setError('Enter a collaborator user id.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'trip-share', {
        tripId: trip.id, collaborator: shareForm.collaborator.trim(), role: shareForm.role,
      });
      if (r.data?.ok) {
        setCollaborators((r.data.result?.collaborators as Collaborator[]) || []);
        setShareForm({ collaborator: '', role: 'editor' });
      } else {
        setError(r.data?.error || 'Could not share trip.');
      }
    } finally { setBusy(false); }
  }, [shareForm, trip.id]);

  const unshareTrip = useCallback(async (userId: string) => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'trip-unshare', { tripId: trip.id, collaborator: userId });
      if (r.data?.ok) setCollaborators((r.data.result?.collaborators as Collaborator[]) || []);
      else setError(r.data?.error || 'Could not remove collaborator.');
    } finally { setBusy(false); }
  }, [trip.id]);

  // ── Budget ───────────────────────────────────────────────────────────

  const loadBreakdown = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const r = await lensRun('travel', 'budget-breakdown', { tripId: trip.id, displayCurrency });
      if (r.data?.ok) setBreakdown(r.data.result as BudgetBreakdown);
      else setError(r.data?.error || 'Budget breakdown unavailable.');
    } finally { setBusy(false); }
  }, [trip.id, displayCurrency]);

  useEffect(() => {
    if (tab === 'budget') void loadBreakdown();
  }, [tab, loadBreakdown]);

  const saveBudget = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const categories: Record<string, number> = {};
      for (const [k, v] of Object.entries(budgetForm)) {
        const n = Number(v);
        if (v.trim() && Number.isFinite(n) && n >= 0) categories[k] = n;
      }
      const r = await lensRun('travel', 'budget-set', { tripId: trip.id, categories });
      if (r.data?.ok === false) { setError(r.data?.error || 'Could not save budget.'); return; }
      await loadBreakdown();
    } finally { setBusy(false); }
  }, [budgetForm, trip.id, loadBreakdown]);

  const markers = useMemo(
    () => mapPoints.map((p) => ({
      lat: p.lat, lng: p.lng, label: p.title,
      popup: [p.day, p.time, p.category, p.address].filter(Boolean).join(' · '),
    })),
    [mapPoints],
  );

  const checklistDone = checklist.filter((c) => c.done).length;

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200">
          <ChevronLeft className="w-3.5 h-3.5" /> All trips
        </button>
        <span className="text-xs text-zinc-400">
          <MapPin className="w-3 h-3 inline mr-1" />{trip.destination}
          {trip.startDate ? ` · ${trip.startDate}${trip.endDate ? ` → ${trip.endDate}` : ''}` : ''}
        </span>
      </div>
      <h3 className="text-base font-bold text-zinc-100">{trip.name}</h3>

      <div className="flex gap-1 flex-wrap bg-zinc-900/60 border border-zinc-800 p-1 rounded-lg">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => { setTab(t.id); setError(null); }}
            className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-colors',
              tab === t.id ? 'bg-sky-600/20 text-sky-300' : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/5')}>
            <t.icon className="w-3.5 h-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* ── Itinerary tab ── */}
      {tab === 'itinerary' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <input placeholder="Activity" value={itinForm.title} onChange={(e) => setItinForm({ ...itinForm, title: e.target.value })}
              className="md:col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input type="date" value={itinForm.day} onChange={(e) => setItinForm({ ...itinForm, day: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="HH:MM" value={itinForm.time} onChange={(e) => setItinForm({ ...itinForm, time: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={itinForm.category} onChange={(e) => setItinForm({ ...itinForm, category: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              {ITIN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={addItinItem} disabled={busy}
              className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Add
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Location" value={itinForm.location} onChange={(e) => setItinForm({ ...itinForm, location: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Note" value={itinForm.note} onChange={(e) => setItinForm({ ...itinForm, note: e.target.value })}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
          </div>
          {itinerary.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No itinerary items yet. Add the first one above.</p>
          ) : (
            <ul className="space-y-1">
              {itinerary.map((it) => (
                <li key={it.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs text-zinc-200 truncate">{it.title}</p>
                    <p className="text-[10px] text-zinc-400 capitalize truncate">
                      {[it.day, it.time, it.category, it.location].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button aria-label="Delete itinerary item" type="button" onClick={() => delItinItem(it.id)} className="text-zinc-600 hover:text-rose-400 shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Map tab ── */}
      {tab === 'map' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-zinc-400">
              {mapPoints.length} pinned · {ungeocoded} unpinned
              {routeKm > 0 && <span className="text-sky-400"> · {routeKm} km route</span>}
            </p>
            <button type="button" onClick={() => { void loadMap(); }}
              className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
          {markers.length > 0 ? (
            <MapView markers={markers} className="h-[380px]" />
          ) : (
            <div className="text-center text-zinc-400 text-xs italic py-8 border border-zinc-800 rounded-xl">
              No pinned itinerary items yet. Geocode an item below to plot it.
            </div>
          )}
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Itinerary items</h4>
            {itinerary.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">No itinerary items on this trip yet — add one in the Itinerary tab.</p>
            ) : (
              <ul className="space-y-1">
                {itinerary.map((it) => {
                  const pinned = Number.isFinite(it.lat) && Number.isFinite(it.lng);
                  return (
                    <li key={it.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs text-zinc-200 truncate">{it.title}</p>
                        <p className="text-[10px] text-zinc-400 truncate">
                          {it.resolvedAddress || it.location || 'No location set'}
                        </p>
                      </div>
                      {pinned ? (
                        <span className="text-[10px] text-emerald-400 flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3" /> pinned
                        </span>
                      ) : (
                        <button type="button" disabled={geocoding === it.id}
                          onClick={() => geocodeItem(it)}
                          className="text-[10px] px-2 py-1 rounded bg-sky-600/20 text-sky-300 hover:bg-sky-600/30 disabled:opacity-40 shrink-0">
                          {geocoding === it.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Pin on map'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Agenda tab ── */}
      {tab === 'agenda' && (
        <div className="space-y-3">
          {agenda.length === 0 && unscheduled.length === 0 ? (
            <div className="text-center text-zinc-400 text-xs italic py-8 border border-zinc-800 rounded-xl">
              No itinerary items yet. Add items in the Itinerary tab to build a day-by-day agenda.
            </div>
          ) : (
            <>
              {agenda.map((d) => (
                <div key={d.day} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-xs font-bold text-sky-300">Day {d.dayNumber}</span>
                    <span className="text-[11px] text-zinc-400">{d.weekday}, {d.day}</span>
                    <span className="text-[10px] text-zinc-400 ml-auto">{d.itemCount} items</span>
                  </div>
                  {d.items.length === 0 ? (
                    <p className="text-[11px] text-zinc-400 italic">Nothing scheduled.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {d.items.map((it) => (
                        <li key={it.id} className="flex items-center gap-3">
                          <span className="text-[11px] font-mono text-zinc-400 w-12 shrink-0">{it.time || '--:--'}</span>
                          <span className="text-xs text-zinc-200 flex-1">{it.title}</span>
                          <span className={cn('text-[10px] capitalize', CATEGORY_COLOR[it.category] || 'text-zinc-400')}>
                            {it.category}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {unscheduled.length > 0 && (
                <div className="bg-zinc-900/40 border border-dashed border-zinc-800 rounded-xl p-3">
                  <p className="text-[11px] font-semibold text-zinc-400 mb-1.5">Unscheduled ({unscheduled.length})</p>
                  <ul className="space-y-1">
                    {unscheduled.map((it) => (
                      <li key={it.id} className="text-xs text-zinc-300">• {it.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Weather tab ── */}
      {tab === 'weather' && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Latitude" inputMode="decimal" value={weatherCoords.lat}
              onChange={(e) => setWeatherCoords((p) => ({ ...p, lat: e.target.value }))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <input placeholder="Longitude" inputMode="decimal" value={weatherCoords.lng}
              onChange={(e) => setWeatherCoords((p) => ({ ...p, lng: e.target.value }))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <button type="button" onClick={fetchWeather} disabled={busy}
              className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CloudSun className="w-3.5 h-3.5" />} Forecast
            </button>
          </div>
          <p className="text-[10px] text-zinc-400">
            Tip: geocode an itinerary item on the Map tab, then copy its coordinates here.
          </p>
          {weather && (
            weather.days.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">No forecast data returned.</p>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {weather.days.map((d) => (
                  <div key={d.date} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                    <p className="text-[10px] text-zinc-400">{d.date}</p>
                    <p className="text-xs text-zinc-200 mt-0.5">{d.condition}</p>
                    <p className="text-sm font-bold text-zinc-100 mt-1">
                      {d.tempMax}{weather.tempUnit} <span className="text-zinc-400 text-xs font-normal">/ {d.tempMin}{weather.tempUnit}</span>
                    </p>
                    {d.precipChance != null && (
                      <p className="text-[10px] text-sky-400 mt-0.5">{d.precipChance}% precip</p>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Flight + hotel search tab ── */}
      {tab === 'flights' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1">
              <Plane className="w-3.5 h-3.5 text-sky-400" /> Live air traffic (OpenSky)
            </h4>
            <div className="flex gap-2">
              <input placeholder="Airline ICAO prefix (e.g. UAL)" value={airlineFilter}
                onChange={(e) => setAirlineFilter(e.target.value.toUpperCase())}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 font-mono uppercase" />
              <button type="button" onClick={searchFlights} disabled={busy}
                className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Search'}
              </button>
            </div>
            {liveFlights.length > 0 && (
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {liveFlights.map((f) => (
                  <li key={f.icao24} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <span className="text-xs font-mono text-zinc-200">{f.callsign}</span>
                    <span className="text-[10px] text-zinc-400">
                      {f.originCountry} · {f.baroAltitudeM != null ? `${Math.round(f.baroAltitudeM)}m` : '—'}
                      {f.velocityMs != null ? ` · ${Math.round(f.velocityMs * 3.6)} km/h` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[10px] text-zinc-400 mt-1.5">
              Live airborne traffic for inspiration — real ticket prices need a licensed GDS API.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1">
              <Hotel className="w-3.5 h-3.5 text-purple-400" /> Lodging near a point (OpenStreetMap)
            </h4>
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="Latitude" inputMode="decimal" value={hotelCoords.lat}
                onChange={(e) => setHotelCoords((p) => ({ ...p, lat: e.target.value }))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Longitude" inputMode="decimal" value={hotelCoords.lng}
                onChange={(e) => setHotelCoords((p) => ({ ...p, lng: e.target.value }))}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={searchHotels} disabled={busy}
                className="px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : 'Search'}
              </button>
            </div>
            {lodging.length > 0 && (
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {lodging.map((l) => (
                  <li key={l.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <span className="text-xs text-zinc-200 truncate">
                      {l.name}
                      <span className="text-[10px] text-zinc-400 ml-1.5 capitalize">{l.kind}</span>
                    </span>
                    {l.website ? (
                      <a href={l.website} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] text-sky-400 hover:underline shrink-0">site</a>
                    ) : l.stars ? (
                      <span className="text-[10px] text-amber-400 shrink-0">{l.stars}★</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* ── Bookings tab (manual add + list + email import) ── */}
      {tab === 'bookings' && (
        <div className="space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Add a booking</h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <select value={bookForm.type} onChange={(e) => setBookForm({ ...bookForm, type: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
                {BOOKING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="Provider" value={bookForm.provider} onChange={(e) => setBookForm({ ...bookForm, provider: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input placeholder="Cost ($)" inputMode="decimal" value={bookForm.cost} onChange={(e) => setBookForm({ ...bookForm, cost: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <input type="date" value={bookForm.date} onChange={(e) => setBookForm({ ...bookForm, date: e.target.value })}
                className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addBooking} disabled={busy}
                className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg">
                <Plus className="w-3.5 h-3.5" /> Book
              </button>
            </div>
          </div>

          {bookings.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">No bookings yet.</p>
          ) : (
            <ul className="space-y-1">
              <li className="text-[10px] text-zinc-400 px-1">Total booked: <span className="text-zinc-200 font-mono">${bookingTotal}</span></li>
              {bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <span className="text-xs text-zinc-200 capitalize">
                    {b.type}{b.provider ? ` · ${b.provider}` : ''}{b.date ? ` · ${b.date}` : ''}
                    {b.confirmationCode ? ` · #${b.confirmationCode}` : ''}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-zinc-400 font-mono">${b.cost}</span>
                    <button aria-label="Delete booking" type="button" onClick={() => delBooking(b.id)} className="text-zinc-600 hover:text-rose-400">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="border-t border-zinc-800 pt-3">
            <h4 className="text-xs font-semibold text-zinc-300 mb-2 flex items-center gap-1">
              <Mail className="w-3.5 h-3.5 text-sky-400" /> Import from a forwarded confirmation email
            </h4>
            <p className="text-[11px] text-zinc-400 mb-2">
              Paste a forwarded confirmation email — Concord parses the booking type, confirmation
              code, provider, cost and date into a real booking + itinerary item.
            </p>
            <textarea value={emailText} onChange={(e) => setEmailText(e.target.value)} rows={6}
              placeholder="Paste the full confirmation email text here…"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100 font-mono" />
            <button type="button" onClick={importBooking} disabled={busy || !emailText.trim()}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} Import booking
            </button>
            {importResult && (
              <div className="mt-2 bg-zinc-900/70 border border-emerald-900/50 rounded-xl p-3 space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold">
                  Parsed booking · confidence {importResult.confidence}/4
                </p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-300">
                  <span>Type: <span className="text-zinc-100 capitalize">{importResult.type}</span></span>
                  <span>Code: <span className="text-zinc-100">{importResult.confirmationCode || '—'}</span></span>
                  <span>Provider: <span className="text-zinc-100">{importResult.provider || '—'}</span></span>
                  <span>Cost: <span className="text-zinc-100">${importResult.cost}</span></span>
                  <span>Date: <span className="text-zinc-100">{importResult.date || '—'}</span></span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Flight status tab ── */}
      {tab === 'status' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input placeholder="Flight callsign (e.g. UAL837)" value={callsign}
              onChange={(e) => setCallsign(e.target.value.toUpperCase())}
              className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 font-mono uppercase" />
            <button type="button" onClick={trackFlight} disabled={busy}
              className="px-3 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Track'}
            </button>
          </div>
          {flightStatus && (
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Radar className="w-4 h-4 text-sky-400" />
                <span className="text-sm font-bold text-zinc-100">{String(flightStatus.callsign)}</span>
                <span className={cn('text-[10px] px-2 py-0.5 rounded uppercase font-semibold',
                  flightStatus.status === 'airborne' ? 'bg-emerald-500/20 text-emerald-300'
                    : flightStatus.status === 'on_ground' ? 'bg-amber-500/20 text-amber-300'
                      : 'bg-zinc-700 text-zinc-400')}>
                  {String(flightStatus.status).replace(/_/g, ' ')}
                </span>
              </div>
              {flightStatus.found ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-300">
                  <span>Origin: <span className="text-zinc-100">{String(flightStatus.originCountry)}</span></span>
                  <span>Altitude: <span className="text-zinc-100">{flightStatus.baroAltitudeM != null ? `${Math.round(Number(flightStatus.baroAltitudeM))} m` : '—'}</span></span>
                  <span>Speed: <span className="text-zinc-100">{flightStatus.velocityMs != null ? `${Math.round(Number(flightStatus.velocityMs) * 3.6)} km/h` : '—'}</span></span>
                  <span>Heading: <span className="text-zinc-100">{flightStatus.headingDeg != null ? `${Math.round(Number(flightStatus.headingDeg))}°` : '—'}</span></span>
                  {flightStatus.latitude != null && flightStatus.longitude != null && (
                    <span className="col-span-2">Position: <span className="text-zinc-100 font-mono">
                      {Number(flightStatus.latitude).toFixed(3)}, {Number(flightStatus.longitude).toFixed(3)}
                    </span></span>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-zinc-400 italic">{String(flightStatus.note || 'No live state.')}</p>
              )}
            </div>
          )}
          <p className="text-[10px] text-zinc-400">Live state vectors via OpenSky Network — free, keyless.</p>
        </div>
      )}

      {/* ── Packing checklist tab ── */}
      {tab === 'packing' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-400">
            <span>{checklistDone}/{checklist.length} packed</span>
            {checklist.length > 0 && (
              <div className="w-24 bg-white/5 rounded-full h-1.5">
                <div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${(checklistDone / checklist.length) * 100}%` }} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Item to pack" value={ckItem} onChange={(e) => setCkItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void addChecklistItem(); }}
              className="col-span-2 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <div className="flex gap-1">
              <input placeholder="Category" value={ckCategory} onChange={(e) => setCkCategory(e.target.value)}
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
              <button type="button" onClick={addChecklistItem} disabled={busy || !ckItem.trim()}
                className="px-2.5 py-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {checklist.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">Packing list is empty. Add the first item above — it's saved to this trip, not just this browser tab.</p>
          ) : (
            <ul className="space-y-1">
              {checklist.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-xs bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <button type="button" onClick={() => toggleChecklistItem(c.id)}
                    className={cn('w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      c.done ? 'bg-sky-600 border-sky-600' : 'border-zinc-600')}>
                    {c.done && <Check className="w-3 h-3 text-white" />}
                  </button>
                  <span className={cn('flex-1', c.done ? 'text-zinc-400 line-through' : 'text-zinc-200')}>{c.item}</span>
                  <span className="text-[10px] text-zinc-500 capitalize">{c.category}</span>
                  <button aria-label="Remove packing item" type="button" onClick={() => removeChecklistItem(c.id)} className="text-zinc-600 hover:text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Collaboration tab ── */}
      {tab === 'share' && (
        <div className="space-y-3">
          <p className="text-xs text-zinc-400">
            Share this trip with travel companions. Editors can co-edit; viewers see it read-only.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <input placeholder="Companion user id" value={shareForm.collaborator}
              onChange={(e) => setShareForm((p) => ({ ...p, collaborator: e.target.value }))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100" />
            <select value={shareForm.role} onChange={(e) => setShareForm((p) => ({ ...p, role: e.target.value }))}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100">
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            <button type="button" onClick={shareTrip} disabled={busy}
              className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Share
            </button>
          </div>
          {collaborators.length === 0 ? (
            <p className="text-[11px] text-zinc-400 italic">Not shared with anyone yet.</p>
          ) : (
            <ul className="space-y-1">
              {collaborators.map((c) => (
                <li key={c.userId} className="flex items-center justify-between bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-xs text-zinc-200">{c.userId}</p>
                    <p className="text-[10px] text-zinc-400 capitalize">{c.role}</p>
                  </div>
                  <button type="button" onClick={() => unshareTrip(c.userId)} className="text-zinc-600 hover:text-rose-400" aria-label="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Budget breakdown tab ── */}
      {tab === 'budget' && (
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 mb-2">Planned budget by category</h4>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
              {Object.keys(budgetForm).map((cat) => (
                <input key={cat} placeholder={cat} inputMode="decimal" value={budgetForm[cat]}
                  onChange={(e) => setBudgetForm((p) => ({ ...p, [cat]: e.target.value.replace(/[^\d.]/g, '') }))}
                  className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize placeholder:capitalize" />
              ))}
              <button type="button" onClick={saveBudget} disabled={busy}
                className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg px-2 py-1.5">
                Save budget
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400">Display currency</span>
            <select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)}
              className="bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-100">
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'INR'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button type="button" onClick={loadBreakdown} disabled={busy}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />} Recompute
            </button>
          </div>
          {breakdown && (
            breakdown.lines.length === 0 ? (
              <p className="text-[11px] text-zinc-400 italic">
                No budget categories or bookings yet. Set a budget and add bookings to see the breakdown.
              </p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                    <p className="text-[10px] text-zinc-400">Planned</p>
                    <p className="text-sm font-bold text-zinc-100">
                      {breakdown.converted ? breakdown.converted.totalPlanned : breakdown.totalPlanned} {breakdown.displayCurrency || breakdown.currency}
                    </p>
                  </div>
                  <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                    <p className="text-[10px] text-zinc-400">Booked</p>
                    <p className="text-sm font-bold text-sky-300">
                      {breakdown.converted ? breakdown.converted.totalBooked : breakdown.totalBooked} {breakdown.displayCurrency || breakdown.currency}
                    </p>
                  </div>
                  <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2.5">
                    <p className="text-[10px] text-zinc-400">Remaining</p>
                    <p className={cn('text-sm font-bold', breakdown.totalRemaining < 0 ? 'text-rose-400' : 'text-emerald-300')}>
                      {breakdown.converted ? breakdown.converted.totalRemaining : breakdown.totalRemaining} {breakdown.displayCurrency || breakdown.currency}
                    </p>
                  </div>
                </div>
                {breakdown.fxRate && breakdown.displayCurrency !== 'USD' && (
                  <p className="text-[10px] text-zinc-400">
                    Live ECB rate: 1 USD = {breakdown.fxRate} {breakdown.displayCurrency}. Base figures in USD.
                  </p>
                )}
                <ul className="space-y-1.5">
                  {breakdown.lines.map((l) => (
                    <li key={l.category} className="bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-zinc-200 capitalize">{l.category}</span>
                        <span className={cn('text-[11px] font-mono', l.overBudget ? 'text-rose-400' : 'text-zinc-400')}>
                          ${l.booked} / ${l.planned}
                        </span>
                      </div>
                      {l.planned > 0 && (
                        <div className="w-full bg-white/5 rounded-full h-1.5">
                          <div className={cn('h-full rounded-full', l.overBudget ? 'bg-rose-400' : 'bg-sky-500')}
                            style={{ width: `${Math.min(100, (l.booked / l.planned) * 100)}%` }} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}
