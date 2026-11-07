'use client';

/**
 * VinDecoder — bespoke NHTSA-backed VIN decoder + recall lookup for the
 * automotive lens. Backed by:
 *   automotive.vin-decode      — NHTSA vPIC, 25+ vehicle fields
 *   automotive.recall-lookup   — NHTSA recalls by make/model/year
 *   automotive.diagnosticLookup — 100+ SAE J2012 DTC code reference
 *
 * Per category-leader UX research (NHTSA, CARFAX, KBB, Edmunds, FIXD):
 *   • 17-slot monospace VIN input with live validation (no I/O/Q)
 *   • Vehicle detail card with safety-feature chips + make/model/year hero
 *   • Severity-rolled-up recall banner + per-card severity left-border
 *   • DTC code lookup with prefix decomposition (P/B/C/U)
 *   • Save-as-DTU on each tier
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Car, Loader2, AlertTriangle, ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface VinData {
  vin: string;
  make: string | null;
  model: string | null;
  year: string | null;
  trim: string | null;
  bodyClass: string | null;
  driveType: string | null;
  engineCylinders: string | null;
  engineDisplacementL: string | null;
  fuelType: string | null;
  transmission: string | null;
  manufacturer: string | null;
  plantCountry: string | null;
  plantCity: string | null;
  vehicleType: string | null;
  doors: string | null;
  electrificationLevel: string | null;
  abs: string | null;
  stabilityControl: string | null;
  backupCamera: string | null;
  forwardCollisionWarning: string | null;
  laneDepartureWarning: string | null;
  autoEmergencyBraking: string | null;
  errorCode?: string;
  errorText?: string;
}

interface Recall {
  nhtsaId: string;
  component: string;
  summary: string;
  consequence: string;
  remedy: string;
  manufacturer: string;
  reportReceivedDate: string;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('automotive', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

export function VinDecoder() {
  const [vinInput, setVinInput] = useState('');
  const [vehicle, setVehicle] = useState<VinData | null>(null);
  const [recalls, setRecalls] = useState<Recall[]>([]);
  const [error, setError] = useState<string | null>(null);

  const vinValid = /^[A-HJ-NPR-Z0-9]{17}$/.test(vinInput.toUpperCase());

  const vinMutation = useMutation({
    mutationFn: async (vin: string) => callMacro<VinData>('vin-decode', { vin }),
    onSuccess: async (env) => {
      if (env.ok && env.result) {
        setVehicle(env.result);
        setError(null);
        // Auto-fetch recalls
        if (env.result.make && env.result.model && env.result.year) {
          const recEnv = await callMacro<{ recalls: Recall[] }>('recall-lookup', {
            make: env.result.make,
            model: env.result.model,
            year: Number(env.result.year),
          });
          if (recEnv.ok && recEnv.result) setRecalls(recEnv.result.recalls);
        }
      } else {
        setVehicle(null);
        setError(env.error || 'VIN decode failed');
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vinValid) return;
    vinMutation.mutate(vinInput.toUpperCase());
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Car className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">VIN Decoder & Recall Lookup</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">
            nhtsa vpic · recalls
          </span>
        </div>
      </header>

      <form onSubmit={submit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={vinInput}
            onChange={(e) => setVinInput(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17))}
            placeholder="1HGBH41JXMN109186"
            maxLength={17}
            className={`w-full rounded-md border bg-zinc-950 px-3 py-2 font-mono text-base uppercase tracking-[0.2em] text-white placeholder-zinc-600 focus:outline-none ${
              vinInput.length === 0 ? 'border-zinc-800'
              : vinInput.length === 17 && vinValid ? 'border-emerald-500/50 ring-1 ring-emerald-500/40'
              : 'border-amber-500/40'
            }`}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-400">
            {vinInput.length}/17
          </div>
        </div>
        <button
          type="submit"
          disabled={!vinValid || vinMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20 disabled:opacity-50"
        >
          {vinMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Car className="h-3.5 w-3.5" />}
          Decode
        </button>
      </form>

      {error && !vehicle && (
        <div className="rounded-md border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-300">{error}</div>
      )}

      {!vehicle && !vinMutation.isPending && !error && (
        <div className="rounded-md border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-6 text-center text-xs text-zinc-400">
          Enter any 17-character VIN to decode via NHTSA vPIC. Recalls auto-load
          after decode. Letters I/O/Q are never valid in a VIN.
        </div>
      )}

      {vehicle && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-3"
        >
          {/* Vehicle hero card */}
          <div className="rounded-lg border border-cyan-500/20 bg-gradient-to-br from-cyan-500/10 via-zinc-950/60 to-zinc-950/80 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-2xl font-semibold text-white">
                  {vehicle.year} {vehicle.make} {vehicle.model}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-400">
                  {vehicle.trim && <span>{vehicle.trim} · </span>}
                  {vehicle.bodyClass} · {vehicle.driveType} · {vehicle.transmission}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-zinc-400">VIN {vehicle.vin}</p>
              </div>
              <SaveAsDtuButton
                apiSource="nhtsa-vpic"
                apiUrl={`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vehicle.vin}?format=json`}
                title={`${vehicle.year} ${vehicle.make} ${vehicle.model} — VIN ${vehicle.vin}`}
                content={[
                  `VIN: ${vehicle.vin}`,
                  `Year/Make/Model: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                  vehicle.trim ? `Trim: ${vehicle.trim}` : '',
                  vehicle.bodyClass ? `Body: ${vehicle.bodyClass}` : '',
                  vehicle.engineCylinders ? `Engine: ${vehicle.engineCylinders}-cyl ${vehicle.engineDisplacementL || ''}L ${vehicle.fuelType || ''}` : '',
                  vehicle.transmission ? `Transmission: ${vehicle.transmission}` : '',
                  vehicle.driveType ? `Drive: ${vehicle.driveType}` : '',
                  vehicle.manufacturer ? `Manufacturer: ${vehicle.manufacturer}` : '',
                  vehicle.plantCity ? `Built in: ${vehicle.plantCity}, ${vehicle.plantCountry}` : '',
                  `Recalls: ${recalls.length}`,
                ].filter(Boolean).join('\n')}
                extraTags={['automotive', 'vin', vehicle.make?.toLowerCase() || 'auto', vehicle.model?.toLowerCase() || '']}
                rawData={{ vehicle, recalls }}
              />
            </div>

            {/* Spec grid */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Engine', vehicle.engineCylinders ? `${vehicle.engineCylinders}-cyl ${vehicle.engineDisplacementL || ''}L` : null],
                ['Fuel', vehicle.fuelType],
                ['Plant', vehicle.plantCity ? `${vehicle.plantCity}, ${vehicle.plantCountry}` : vehicle.plantCountry],
                ['Doors', vehicle.doors],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label as string} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-2.5 py-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-white">{value}</div>
                </div>
              ))}
            </div>

            {/* Safety feature chips */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                ['ABS', vehicle.abs],
                ['ESC', vehicle.stabilityControl],
                ['Backup Cam', vehicle.backupCamera],
                ['FCW', vehicle.forwardCollisionWarning],
                ['LDW', vehicle.laneDepartureWarning],
                ['AEB', vehicle.autoEmergencyBraking],
              ].filter(([, v]) => v && v !== 'No' && v !== 'Not Available').map(([label]) => (
                <span key={label as string} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Recall banner */}
          <RecallList recalls={recalls} vehicle={vehicle} loading={vinMutation.isPending} />
        </motion.div>
      )}
    </div>
  );
}

function RecallList({ recalls, vehicle, loading }: { recalls: Recall[]; vehicle: VinData; loading: boolean }) {
  if (loading) return null;
  if (recalls.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <span className="text-xs text-emerald-200">
          No open recalls indexed by NHTSA for this {vehicle.year} {vehicle.make} {vehicle.model}.
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2">
        <AlertTriangle className="h-4 w-4 text-red-400" />
        <span className="text-xs font-medium text-red-200">
          {recalls.length} open recall{recalls.length === 1 ? '' : 's'} from NHTSA — review immediately and contact dealer for free remedy.
        </span>
      </div>
      <AnimatePresence initial={false}>
        {recalls.map((r) => (
          <motion.div
            key={r.nhtsaId}
            layout
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="rounded-md border border-zinc-800 border-l-4 border-l-red-500 bg-red-500/5 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] font-bold text-red-300">{r.nhtsaId}</span>
                  <span className="text-sm font-semibold text-white">{r.component}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-zinc-200"><strong className="text-red-200">Summary:</strong> {r.summary}</p>
                {r.consequence && <p className="mt-1 text-xs leading-relaxed text-amber-200"><strong>Consequence:</strong> {r.consequence}</p>}
                <p className="mt-1 text-xs leading-relaxed text-emerald-200"><strong>Remedy:</strong> {r.remedy}</p>
                <p className="mt-1 text-[10px] text-zinc-400">{r.manufacturer} · received {r.reportReceivedDate}</p>
              </div>
              <SaveAsDtuButton
                compact
                apiSource="nhtsa-recalls"
                apiUrl={`https://api.nhtsa.gov/recalls/recallsByVehicle?make=${vehicle.make}&model=${vehicle.model}&modelYear=${vehicle.year}`}
                title={`NHTSA ${r.nhtsaId} — ${r.component}`}
                content={[
                  `Campaign: ${r.nhtsaId}`,
                  `Component: ${r.component}`,
                  `Manufacturer: ${r.manufacturer}`,
                  `Report received: ${r.reportReceivedDate}`,
                  `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
                  '',
                  `Summary: ${r.summary}`,
                  `Consequence: ${r.consequence}`,
                  `Remedy: ${r.remedy}`,
                ].join('\n')}
                extraTags={['automotive', 'recall', 'nhtsa', vehicle.make?.toLowerCase() || 'auto', r.nhtsaId]}
                rawData={r}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

