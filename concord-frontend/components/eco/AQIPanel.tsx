'use client';

import { Wind, AlertCircle, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAqiData, type AqiData } from '@/hooks/useAqiData';

export const CATEGORY_COLORS: Record<AqiData['category'], { bg: string; text: string; label: string; ring: string }> = {
  good: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Good (0-50)', ring: '#4ade80' },
  moderate: { bg: 'bg-yellow-500/20', text: 'text-yellow-300', label: 'Moderate (51-100)', ring: '#facc15' },
  sensitive: { bg: 'bg-orange-500/20', text: 'text-orange-300', label: 'Unhealthy for Sensitive (101-150)', ring: '#fb923c' },
  unhealthy: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Unhealthy (151-200)', ring: '#f87171' },
  'very-unhealthy': { bg: 'bg-purple-500/20', text: 'text-purple-300', label: 'Very Unhealthy (201-300)', ring: '#c084fc' },
  hazardous: { bg: 'bg-rose-500/30', text: 'text-rose-200', label: 'Hazardous (301+)', ring: '#fda4af' },
};

interface AQIPanelProps {
  lat?: number;
  lng?: number;
}

export function AQIPanel({ lat, lng }: AQIPanelProps) {
  const { data, loading, error, refresh } = useAqiData({ lat, lng });

  if (loading && !data) {
    return (
      <div className="bg-[#0d1117] border border-lattice-border rounded-lg p-6 flex items-center justify-center text-gray-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> {data ? 'Refreshing…' : 'Locating…'}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-[#0d1117] border border-red-500/30 rounded-lg p-4 text-red-400 text-sm" role="alert">
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
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh air quality reading"
          title="Refresh"
          className="text-gray-400 hover:text-cyan-300 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
        </button>
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
