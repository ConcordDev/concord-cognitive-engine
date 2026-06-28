'use client';

import { useEffect, useState } from 'react';
import { Wind, AlertCircle, Loader2, MapPin } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AQIData {
  aqi: number;
  pm25: number;
  pm10: number;
  o3: number;
  no2: number;
  co: number;
  so2: number;
  category: 'good' | 'moderate' | 'sensitive' | 'unhealthy' | 'very-unhealthy' | 'hazardous';
  recommendation: string;
  source: string;
  lat: number;
  lng: number;
}

const CATEGORY_COLORS: Record<AQIData['category'], { bg: string; text: string; label: string }> = {
  good: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Good (0-50)' },
  moderate: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', label: 'Moderate (51-100)' },
  sensitive: { bg: 'bg-orange-500/20', text: 'text-orange-300', label: 'Unhealthy for Sensitive (101-150)' },
  unhealthy: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Unhealthy (151-200)' },
  'very-unhealthy': { bg: 'bg-purple-500/20', text: 'text-purple-300', label: 'Very Unhealthy (201-300)' },
  hazardous: { bg: 'bg-rose-500/30', text: 'text-rose-200', label: 'Hazardous (301+)' },
};

interface AQIPanelProps {
  lat?: number;
  lng?: number;
}

export function AQIPanel({ lat, lng }: AQIPanelProps) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    lat != null && lng != null ? { lat, lng } : null
  );
  const [data, setData] = useState<AQIData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!coords && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCoords({ lat: 37.7749, lng: -122.4194 }),
        { maximumAge: 5 * 60 * 1000, timeout: 5000 }
      );
    }
  }, [coords]);

  useEffect(() => {
    if (!coords) return;
    setLoading(true); setError(null);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', {
          domain: 'eco', action: 'aqi-current',
          input: { lat: coords.lat, lng: coords.lng },
        });
        // /api/lens/run single-unwraps: a handler rejection arrives as
        // res.data.result = { ok:false, error }. Surface it (the panel renders
        // the error branch) instead of crashing on data.lat.toFixed().
        const node = res.data?.result as (AQIData & { ok?: boolean; error?: string }) | null;
        if (node && node.ok === false) {
          setError(node.error || 'Air-quality source unavailable.');
          setData(null);
        } else {
          setData((node as AQIData) || null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'fetch failed');
      } finally { setLoading(false); }
    })();
  }, [coords]);

  if (loading || !coords) {
    return (
      <div className="bg-[#0d1117] border border-lattice-border rounded-lg p-6 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {coords ? 'Loading air quality…' : 'Locating…'}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0d1117] border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
        AQI failed: {error || 'no data'}
      </div>
    );
  }

  const cat = CATEGORY_COLORS[data.category];

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Wind className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Air quality</span>
        <span className="ml-auto text-[10px] text-gray-400 inline-flex items-center gap-1">
          <MapPin className="w-3 h-3" /> {data.lat.toFixed(2)}, {data.lng.toFixed(2)}
        </span>
      </header>
      <div className={cn('px-4 py-4 flex items-center gap-4', cat.bg)}>
        <div>
          <div className="text-5xl font-bold tabular-nums text-white">{Math.round(data.aqi)}</div>
          <div className={cn('text-xs font-bold', cat.text)}>{cat.label}</div>
        </div>
        <p className="text-xs text-gray-300 flex-1">{data.recommendation}</p>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 py-3 border-t border-white/5 text-xs">
        <PolPill label="PM2.5" value={data.pm25} unit="µg/m³" />
        <PolPill label="PM10" value={data.pm10} unit="µg/m³" />
        <PolPill label="O₃" value={data.o3} unit="µg/m³" />
        <PolPill label="NO₂" value={data.no2} unit="µg/m³" />
        <PolPill label="SO₂" value={data.so2} unit="µg/m³" />
        <PolPill label="CO" value={data.co} unit="mg/m³" />
      </div>
      <footer className="px-4 py-1.5 border-t border-white/10 text-[10px] text-gray-400 flex items-center gap-2">
        <AlertCircle className="w-3 h-3" />
        Source: {data.source} · refresh every 5 min
      </footer>
    </div>
  );
}

function PolPill({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="bg-white/[0.03] rounded px-2 py-1.5">
      <div className="text-[10px] text-gray-400">{label}</div>
      <div className="text-sm text-white font-mono tabular-nums">{value?.toFixed(1) ?? '—'} <span className="text-[9px] text-gray-400">{unit}</span></div>
    </div>
  );
}

export default AQIPanel;
