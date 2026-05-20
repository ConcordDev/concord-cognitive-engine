'use client';

import { useEffect, useState } from 'react';
import { HeartPulse, Activity, Droplet, Thermometer, Wind, Loader2, ShieldAlert } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface VitalReading {
  channel: 'heart_rate' | 'bp_systolic' | 'bp_diastolic' | 'glucose' | 'spo2' | 'temperature' | 'weight' | 'respiratory_rate';
  value: number;
  unit: string;
  recordedAt: string;
}

export interface Allergy {
  substance: string;
  reaction: string;
  severity: 'mild' | 'moderate' | 'severe' | 'life_threatening';
}

export interface Immunization {
  vaccine: string;
  administeredAt: string;
  doseNumber?: number;
  totalDoses?: number;
}

export interface PatientRecord {
  vitals: VitalReading[];
  allergies: Allergy[];
  immunizations: Immunization[];
  conditions: Array<{ name: string; diagnosedAt: string; status: 'active' | 'resolved' | 'remission' }>;
}

const CHANNEL_META: Record<VitalReading['channel'], { label: string; icon: typeof HeartPulse; color: string; normalRange?: [number, number] }> = {
  heart_rate: { label: 'Heart rate', icon: HeartPulse, color: 'text-red-400', normalRange: [60, 100] },
  bp_systolic: { label: 'BP systolic', icon: Activity, color: 'text-cyan-400', normalRange: [90, 120] },
  bp_diastolic: { label: 'BP diastolic', icon: Activity, color: 'text-cyan-400', normalRange: [60, 80] },
  glucose: { label: 'Glucose', icon: Droplet, color: 'text-yellow-400', normalRange: [70, 140] },
  spo2: { label: 'SpO₂', icon: Wind, color: 'text-blue-400', normalRange: [95, 100] },
  temperature: { label: 'Temperature', icon: Thermometer, color: 'text-orange-400', normalRange: [97, 99.5] },
  weight: { label: 'Weight', icon: Activity, color: 'text-gray-400' },
  respiratory_rate: { label: 'Resp rate', icon: Wind, color: 'text-blue-400', normalRange: [12, 20] },
};

export function PatientChart() {
  const [record, setRecord] = useState<PatientRecord | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await lensRun({ domain: 'healthcare', action: 'record-get', input: {} });
        setRecord(res.data?.result as PatientRecord || null);
      } catch (e) { console.error('[Chart] failed', e); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="p-6 flex items-center gap-2 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading chart…</div>;
  if (!record) return <div className="p-6 text-xs text-gray-500">No patient record found.</div>;

  // Group vitals by channel, take latest
  const latestByChannel = new Map<string, VitalReading>();
  for (const v of record.vitals) {
    const existing = latestByChannel.get(v.channel);
    if (!existing || new Date(v.recordedAt) > new Date(existing.recordedAt)) {
      latestByChannel.set(v.channel, v);
    }
  }
  const dangerousAllergies = record.allergies.filter(a => a.severity === 'severe' || a.severity === 'life_threatening');

  return (
    <div className="space-y-3">
      {dangerousAllergies.length > 0 && (
        <div className="bg-red-500/10 border-2 border-red-500/40 rounded p-3 flex items-start gap-2">
          <ShieldAlert className="w-5 h-5 text-red-300 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-red-300 mb-1">SEVERE ALLERGY ALERT</h3>
            <ul className="text-xs space-y-0.5">
              {dangerousAllergies.map((a, i) => (
                <li key={i} className="text-red-200">
                  <span className="font-bold">{a.substance}</span> → {a.reaction} <span className="text-[10px] uppercase">({a.severity.replace(/_/g, ' ')})</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <HeartPulse className="w-4 h-4 text-red-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Vitals</span>
          <span className="ml-auto text-[10px] text-gray-500">{latestByChannel.size} channels</span>
        </header>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...latestByChannel.entries()].map(([ch, v]) => {
            const meta = CHANNEL_META[ch as VitalReading['channel']];
            const Icon = meta.icon;
            const inRange = meta.normalRange ? (v.value >= meta.normalRange[0] && v.value <= meta.normalRange[1]) : true;
            return (
              <div key={ch} className="bg-white/[0.02] rounded p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={cn('w-3.5 h-3.5', meta.color)} />
                  <span className="text-[10px] uppercase tracking-wider text-gray-500">{meta.label}</span>
                </div>
                <div className={cn('text-2xl font-bold tabular-nums', inRange ? 'text-white' : 'text-yellow-300')}>{v.value}<span className="text-[10px] text-gray-500 ml-1">{v.unit}</span></div>
                <div className="text-[9px] text-gray-500 mt-0.5">{new Date(v.recordedAt).toLocaleDateString()}</div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-yellow-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Allergies</span>
          <span className="ml-auto text-[10px] text-gray-500">{record.allergies.length}</span>
        </header>
        {record.allergies.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-500">No known drug allergies (NKDA)</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {record.allergies.map((a, i) => (
              <li key={i} className="px-4 py-2 flex items-center gap-2 text-xs">
                <span className="text-sm text-white">{a.substance}</span>
                <span className="text-gray-400">→ {a.reaction}</span>
                <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                  a.severity === 'life_threatening' ? 'bg-red-500/30 text-red-200' :
                  a.severity === 'severe' ? 'bg-red-500/20 text-red-300' :
                  a.severity === 'moderate' ? 'bg-yellow-500/20 text-yellow-300' :
                  'bg-blue-500/20 text-blue-300'
                )}>{a.severity.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
        <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Immunizations</span>
          <span className="ml-auto text-[10px] text-gray-500">{record.immunizations.length}</span>
        </header>
        {record.immunizations.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-gray-500">No immunizations on record</div>
        ) : (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
            {record.immunizations.map((imm, i) => (
              <div key={i} className="bg-white/[0.02] rounded p-2 text-xs">
                <div className="text-white font-medium">{imm.vaccine}</div>
                <div className="text-[10px] text-gray-500">{new Date(imm.administeredAt).toLocaleDateString()}{imm.doseNumber && imm.totalDoses && ` · ${imm.doseNumber}/${imm.totalDoses}`}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {record.conditions.length > 0 && (
        <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
          <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-purple-400" />
            <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Conditions</span>
            <span className="ml-auto text-[10px] text-gray-500">{record.conditions.length}</span>
          </header>
          <ul className="divide-y divide-white/5">
            {record.conditions.map((c, i) => (
              <li key={i} className="px-4 py-2 flex items-center gap-2 text-xs">
                <span className="text-sm text-white">{c.name}</span>
                <span className="text-[10px] text-gray-500">since {new Date(c.diagnosedAt).toLocaleDateString()}</span>
                <span className={cn('ml-auto text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-bold',
                  c.status === 'active' ? 'bg-orange-500/20 text-orange-300' :
                  c.status === 'remission' ? 'bg-green-500/20 text-green-300' :
                  'bg-gray-500/20 text-gray-300'
                )}>{c.status}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default PatientChart;
