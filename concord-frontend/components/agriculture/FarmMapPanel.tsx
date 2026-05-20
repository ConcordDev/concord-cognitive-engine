'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Map as MapIcon, Loader2 } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

const FieldsMap = dynamic(() => import('./FieldsMap').then(m => m.FieldsMap), { ssr: false });

interface Field { id: string; name: string; acreage: number; lat?: number; lng?: number; currentCrop?: string; soilType?: string }
interface Equipment { id: string; name: string; kind: string; status: string; lat: number | null; lng: number | null }

export function FarmMapPanel() {
  const [fields, setFields] = useState<Field[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const [f, e] = await Promise.all([
        lensRun({ domain: 'agriculture', action: 'field-list', input: {} }),
        lensRun({ domain: 'agriculture', action: 'equipment-list', input: {} }),
      ]);
      setFields((f.data?.result?.fields || []) as Field[]);
      setEquipment((e.data?.result?.equipment || []) as Equipment[]);
    } catch (err) { console.error('[FarmMap] failed', err); }
    finally { setLoading(false); }
  }

  const fieldsWithCoords = fields.filter(f => Number.isFinite(f.lat) && Number.isFinite(f.lng));
  const equipWithCoords = equipment.filter(e => e.lat != null && e.lng != null);

  return (
    <div className="bg-[#0d1117] border border-emerald-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <MapIcon className="w-4 h-4 text-emerald-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Farm map</span>
        <span className="ml-auto text-[10px] text-gray-500">{fieldsWithCoords.length} fields · {equipWithCoords.length} machines with live GPS</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-10 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <FieldsMap fields={fields} equipment={equipment} className="h-96 w-full" />
      )}
    </div>
  );
}

export default FarmMapPanel;
