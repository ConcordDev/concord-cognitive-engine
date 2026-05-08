'use client';

/**
 * EHRShell — Epic / Cerner-shape patient chart silhouette.
 *
 * Patient header banner up top with demographics + alerts, then a
 * horizontal vitals strip (BP / HR / Temp / SpO2 / Resp), with a
 * left rail listing recent encounters and a main content slot for
 * notes / medications / labs / orders. Every clinical surface
 * shares this anatomy; the lens reads as an EHR within 200ms.
 */

import React from 'react';
import {
  AlertTriangle, Heart, Activity, Thermometer, Wind, Droplet,
  Pill, Beaker, ClipboardList, FileText, Calendar,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EHRPatient {
  id: string;
  name: string;
  age?: number;
  sex?: 'F' | 'M' | 'X';
  mrn: string;
  allergies?: string[];
  alerts?: string[];
  pcp?: string;
  insurance?: string;
}

export interface VitalSet {
  bp?: string;          // "120/80"
  hr?: number;          // beats / min
  tempF?: number;       // Fahrenheit
  spo2?: number;        // percent
  resp?: number;        // breaths / min
  takenAt?: string;
}

export interface EHREncounter {
  id: string;
  date: string;
  reason: string;
  provider?: string;
}

export interface EHRShellProps {
  patient: EHRPatient;
  vitals?: VitalSet;
  encounters: EHREncounter[];
  activeEncounterId?: string;
  onSelectEncounter?: (e: EHREncounter) => void;
  /** Main content for the active encounter — notes / orders / labs. */
  children: React.ReactNode;
  className?: string;
}

export function EHRShell({
  patient,
  vitals,
  encounters,
  activeEncounterId,
  onSelectEncounter,
  children,
  className,
}: EHRShellProps) {
  return (
    <div className={cn('flex flex-col h-full bg-white text-gray-900 dark:bg-[#1a1d23] dark:text-gray-100', className)}>
      {/* Patient header banner — Epic-shape */}
      <header className="bg-gradient-to-r from-blue-900 to-blue-800 text-white px-6 py-3 flex flex-wrap items-center gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">{patient.name}</h1>
          <span className="text-sm text-blue-200">
            {patient.age != null ? `${patient.age} y` : '—'} · {patient.sex ?? '—'} · MRN {patient.mrn}
          </span>
        </div>
        {patient.alerts && patient.alerts.length > 0 && (
          <div className="flex items-center gap-1.5 bg-amber-500/20 border border-amber-300/40 text-amber-100 px-2 py-1 rounded text-xs">
            <AlertTriangle className="w-3 h-3" />
            {patient.alerts.join(' · ')}
          </div>
        )}
        {patient.allergies && patient.allergies.length > 0 && (
          <div className="flex items-center gap-1.5 bg-rose-500/20 border border-rose-300/40 text-rose-100 px-2 py-1 rounded text-xs">
            Allergies: {patient.allergies.join(', ')}
          </div>
        )}
        <div className="ml-auto text-xs text-blue-200">
          {patient.pcp && <>PCP {patient.pcp} · </>}
          {patient.insurance}
        </div>
      </header>

      {/* Vitals strip */}
      {vitals && (
        <div className="bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900/40 px-6 py-2 flex items-center gap-6 text-sm">
          <VitalChip icon={Heart}       label="BP"   value={vitals.bp ?? '—'} unit="mmHg" />
          <VitalChip icon={Activity}    label="HR"   value={vitals.hr != null ? String(vitals.hr) : '—'} unit="bpm" />
          <VitalChip icon={Thermometer} label="Temp" value={vitals.tempF != null ? vitals.tempF.toFixed(1) : '—'} unit="°F" />
          <VitalChip icon={Wind}        label="Resp" value={vitals.resp != null ? String(vitals.resp) : '—'} unit="rpm" />
          <VitalChip icon={Droplet}     label="SpO2" value={vitals.spo2 != null ? String(vitals.spo2) : '—'} unit="%" />
          {vitals.takenAt && (
            <span className="ml-auto text-[10px] text-gray-500 font-mono">
              taken {new Date(vitals.takenAt).toLocaleString()}
            </span>
          )}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left rail — encounter timeline */}
        <aside className="w-56 shrink-0 border-r border-black/10 dark:border-white/10 overflow-y-auto bg-gray-50 dark:bg-[#202327]">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-500 border-b border-black/5 dark:border-white/5">
            Recent encounters
          </div>
          <ul>
            {encounters.map((e) => {
              const active = e.id === activeEncounterId;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => onSelectEncounter?.(e)}
                    className={cn(
                      'w-full text-left px-3 py-2 border-b border-black/5 dark:border-white/5 text-xs',
                      active ? 'bg-blue-100 dark:bg-blue-900/40' : 'hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <div className="font-medium text-gray-900 dark:text-white">{e.reason}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5 inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(e.date).toLocaleDateString()}
                      {e.provider && <> · {e.provider}</>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Main pane */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>

        {/* Right tab rail — quick links to common sub-views (Epic shape) */}
        <aside className="w-12 shrink-0 border-l border-black/10 dark:border-white/10 bg-gray-50 dark:bg-[#202327] flex flex-col items-center py-3 gap-1">
          {[
            { icon: ClipboardList, label: 'Notes' },
            { icon: Pill,          label: 'Meds' },
            { icon: Beaker,        label: 'Labs' },
            { icon: FileText,      label: 'Orders' },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              title={label}
              className="w-9 h-9 inline-flex items-center justify-center rounded text-gray-500 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white"
            >
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </aside>
      </div>
    </div>
  );
}

interface VitalChipProps {
  icon: typeof Heart;
  label: string;
  value: string;
  unit: string;
}

function VitalChip({ icon: Icon, label, value, unit }: VitalChipProps) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 text-blue-500" aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-wider text-gray-500">{label}</span>
      <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white tabular-nums">
        {value}
      </span>
      <span className="text-[10px] text-gray-500">{unit}</span>
    </div>
  );
}

export default EHRShell;
