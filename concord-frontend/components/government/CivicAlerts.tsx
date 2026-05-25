'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Bell, Loader2, MapPin } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface CivicAlert {
  id: string;
  category: 'weather' | 'amber' | 'fire' | 'public_health' | 'civil' | 'evacuation' | 'other';
  severity: 'extreme' | 'severe' | 'moderate' | 'minor';
  title: string;
  summary: string;
  area: string;
  issuedAt: string;
  expiresAt?: string;
  source: string;
  url?: string;
}

export function CivicAlerts() {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [alerts, setAlerts] = useState<CivicAlert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCoords({ lat: 37.7749, lng: -122.4194 }),
        { maximumAge: 5 * 60 * 1000, timeout: 5000 }
      );
    }
  }, []);

  useEffect(() => {
    if (!coords) return;
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({
          domain: 'government', action: 'alerts-current', input: { lat: coords.lat, lng: coords.lng },
        });
        setAlerts((res.data?.result?.alerts || []) as CivicAlert[]);
      } catch (e) { console.error('[Alerts] failed', e); }
      finally { setLoading(false); }
    })();
  }, [coords]);

  const sev: Record<CivicAlert['severity'], string> = {
    extreme: 'bg-red-500/20 text-red-300 border-red-500/40',
    severe: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
    moderate: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    minor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Bell className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Civic alerts</span>
        {coords && <span className="ml-auto text-[10px] text-gray-400 inline-flex items-center gap-1"><MapPin className="w-3 h-3" /> {coords.lat.toFixed(2)}, {coords.lng.toFixed(2)}</span>}
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading || !coords ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> {coords ? 'Loading alerts…' : 'Locating…'}</div>
        ) : alerts.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400">No active alerts for your area.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {alerts.map(a => (
              <li key={a.id} className={cn('px-3 py-2 border-l-2', sev[a.severity].split(' ')[2])}>
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className={cn('w-3.5 h-3.5', sev[a.severity].split(' ')[1])} />
                  <span className="text-sm font-bold text-white">{a.title}</span>
                  <span className={cn('ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border', sev[a.severity])}>{a.severity}</span>
                </div>
                <p className="text-xs text-gray-300 line-clamp-3">{a.summary}</p>
                <div className="text-[10px] text-gray-400 mt-1">
                  {a.area} · {a.source} · issued {new Date(a.issuedAt).toLocaleString()}
                  {a.expiresAt && <> · expires {new Date(a.expiresAt).toLocaleString()}</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CivicAlerts;
