'use client';

/**
 * FashionAIStylistPanel — weather-aware AI outfit generation. Pulls a
 * real Open-Meteo forecast for the user's location and assembles
 * head-to-toe looks from the real wardrobe via fashion.ai-outfit-generate.
 */

import { useCallback, useState } from 'react';
import { Loader2, Wand2, CloudSun, MapPin, Save, Thermometer } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface WeatherDay { date: string; tempMax: number | null; tempMin: number | null; kind: string; precipChance: number | null }
interface WeatherCurrent { temp: number | null; kind: string; precipitation: number | null }
interface OutfitPiece { id: string; name: string; category: string; color: string | null }
interface GenOutfit { rank: number; itemIds: string[]; items: OutfitPiece[]; totalCost: number; rationale: string }

const OCCASIONS = ['casual', 'work', 'formal', 'date', 'workout', 'travel'];
const WEATHER_ICON: Record<string, string> = {
  clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', fog: 'Fog', storm: 'Storm',
};

export function FashionAIStylistPanel({ onChange }: { onChange: () => void }) {
  const [current, setCurrent] = useState<WeatherCurrent | null>(null);
  const [days, setDays] = useState<WeatherDay[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [occasion, setOccasion] = useState('casual');
  const [manualTemp, setManualTemp] = useState('');
  const [outfits, setOutfits] = useState<GenOutfit[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedRanks, setSavedRanks] = useState<Set<number>>(new Set());

  const loadWeather = useCallback(() => {
    setError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('Geolocation unavailable — enter a temperature manually below.');
      return;
    }
    setLoadingWeather(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const r = await lensRun('fashion', 'weather-forecast', {
          lat: pos.coords.latitude, lon: pos.coords.longitude,
        });
        setLoadingWeather(false);
        if (r.data?.ok === false) { setError(r.data?.error || 'Weather unavailable'); return; }
        setCurrent((r.data?.result?.current as WeatherCurrent) || null);
        const dd = (r.data?.result?.days as WeatherDay[]) || [];
        setDays(dd);
        if (dd[0]) setSelectedDate(dd[0].date);
      },
      () => { setLoadingWeather(false); setError('Location denied — enter a temperature manually below.'); },
      { timeout: 10000 },
    );
  }, []);

  const generate = async () => {
    setError(null);
    const day = days.find((d) => d.date === selectedDate);
    let temp: number | null = null;
    let weatherKind = 'clear';
    if (manualTemp.trim() !== '' && Number.isFinite(Number(manualTemp))) {
      temp = Number(manualTemp);
    } else if (day) {
      temp = day.tempMax != null && day.tempMin != null ? (day.tempMax + day.tempMin) / 2 : day.tempMax;
      weatherKind = day.kind;
    } else if (current) {
      temp = current.temp;
      weatherKind = current.kind;
    }
    setGenerating(true);
    const params: Record<string, unknown> = { occasion, weatherKind, count: 4 };
    if (temp != null) params.temp = temp;
    const r = await lensRun('fashion', 'ai-outfit-generate', params);
    setGenerating(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    setOutfits((r.data?.result?.outfits as GenOutfit[]) || []);
    setNote((r.data?.result?.note as string) || null);
    setSavedRanks(new Set());
  };

  const saveOutfit = async (o: GenOutfit) => {
    const name = `${occasion} look ${new Date().toISOString().slice(0, 10)} #${o.rank}`;
    const r = await lensRun('fashion', 'outfit-create', { name, occasion, itemIds: o.itemIds });
    if (r.data?.ok !== false) {
      setSavedRanks((s) => new Set(s).add(o.rank));
      onChange();
    }
  };

  return (
    <div className="space-y-3">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      {/* Weather */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
            <CloudSun className="w-4 h-4 text-fuchsia-400" /> Weather
          </h3>
          <button type="button" onClick={loadWeather} disabled={loadingWeather}
            className="flex items-center gap-1 text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg disabled:opacity-50">
            {loadingWeather ? <Loader2 className="w-3 h-3 animate-spin" /> : <MapPin className="w-3 h-3" />}
            Use my location
          </button>
        </div>
        {current && (
          <p className="text-[11px] text-zinc-400">
            Now: <span className="text-zinc-100 font-semibold">{current.temp != null ? `${Math.round(current.temp)}°C` : '—'}</span>
            {' · '}{WEATHER_ICON[current.kind] || current.kind}
          </p>
        )}
        {days.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {days.map((d) => (
              <button key={d.date} type="button" onClick={() => setSelectedDate(d.date)}
                className={cn('shrink-0 text-center px-2 py-1.5 rounded-lg border',
                  selectedDate === d.date ? 'border-fuchsia-600 bg-fuchsia-950/40' : 'border-zinc-700')}>
                <p className="text-[10px] text-zinc-400">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</p>
                <p className="text-[11px] font-bold text-zinc-100">
                  {d.tempMax != null ? `${Math.round(d.tempMax)}°` : '—'}
                </p>
                <p className="text-[9px] text-zinc-400">{WEATHER_ICON[d.kind] || d.kind}</p>
              </button>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <Thermometer className="w-3 h-3" /> Or set temp manually (°C):
          <input inputMode="decimal" value={manualTemp} onChange={(e) => setManualTemp(e.target.value)}
            placeholder="e.g. 18" className="w-20 bg-zinc-950 border border-zinc-700 rounded px-2 py-0.5 text-xs text-zinc-100" />
        </label>
      </div>

      {/* Generate controls */}
      <div className="flex items-center gap-2">
        <select value={occasion} onChange={(e) => setOccasion(e.target.value)}
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-100 capitalize">
          {OCCASIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        <button type="button" onClick={generate} disabled={generating}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-fuchsia-600 hover:bg-fuchsia-500 disabled:opacity-50 text-white rounded-lg">
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
          Generate outfits
        </button>
      </div>

      {note && <p className="text-[11px] text-amber-400 italic">{note}</p>}

      {outfits.length === 0 ? (
        <div className="text-center text-zinc-400 text-sm italic py-8 border border-zinc-800 rounded-xl">
          No outfits generated yet. Set the weather and occasion, then generate.
        </div>
      ) : (
        <ul className="space-y-2">
          {outfits.map((o) => (
            <li key={o.rank} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-fuchsia-300">Look #{o.rank}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-zinc-400">${o.totalCost}</span>
                  <button type="button" onClick={() => saveOutfit(o)} disabled={savedRanks.has(o.rank)}
                    className="flex items-center gap-1 text-[11px] px-2 py-0.5 bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-emerald-700 disabled:opacity-100 text-white rounded-lg">
                    <Save className="w-3 h-3" /> {savedRanks.has(o.rank) ? 'Saved' : 'Save outfit'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {o.items.map((it) => (
                  <span key={it.id} className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-200">
                    {it.name}<span className="text-zinc-400"> · {it.category}</span>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-zinc-400 mt-2 italic">{o.rationale}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
