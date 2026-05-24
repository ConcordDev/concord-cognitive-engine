'use client';

// Equipment data sync — ISOBUS / CAN telemetry import. Accepts a pasted
// telemetry batch (the JSON or CSV shape an ISOBUS task controller / CAN
// logger exports), applies it to a fleet machine, and shows an auditable
// sync history.

import { useCallback, useEffect, useState } from 'react';
import { Cpu, Loader2, Upload, Clock } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Equipment {
  id: string;
  name: string;
  kind: string;
  hoursEngine: number;
  fuelLevelPct: number;
  defLevelPct: number;
  speedMph: number;
  status: string;
}
interface SyncRecord {
  id: string;
  equipmentId: string;
  protocol: string;
  rowsReceived: number;
  rowsApplied: number;
  areaWorkedAcres: number;
  importedAt: string;
}

const PROTOCOLS = ['isobus', 'can', 'iso11783', 'csv'];

// Parse either JSON array, or CSV with a header row, into telemetry rows.
function parseTelemetry(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  // CSV path
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, unknown> = {};
    header.forEach((h, i) => {
      const v = (cells[i] ?? '').trim();
      row[h] = v === '' ? null : Number.isNaN(Number(v)) ? v : Number(v);
    });
    return row;
  });
}

export function TelemetryImportPanel() {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [equipmentId, setEquipmentId] = useState('');
  const [protocol, setProtocol] = useState('isobus');
  const [raw, setRaw] = useState('');
  const [syncs, setSyncs] = useState<SyncRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const refreshEquipment = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun('agriculture', 'equipment-list', {});
      if (r.data?.ok) {
        const eq = ((r.data.result as { equipment?: Equipment[] } | null)?.equipment ||
          []) as Equipment[];
        setEquipment(eq);
        setEquipmentId((cur) => cur || eq[0]?.id || '');
      }
    } catch (e) {
      console.error('[Telemetry] equipment-list failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSyncs = useCallback(async () => {
    if (!equipmentId) {
      setSyncs([]);
      return;
    }
    try {
      const r = await lensRun('agriculture', 'telemetry-syncs-list', { equipmentId });
      if (r.data?.ok) {
        setSyncs(((r.data.result as { syncs?: SyncRecord[] } | null)?.syncs || []) as SyncRecord[]);
      }
    } catch (e) {
      console.error('[Telemetry] syncs-list failed', e);
    }
  }, [equipmentId]);

  useEffect(() => {
    refreshEquipment();
  }, [refreshEquipment]);
  useEffect(() => {
    refreshSyncs();
  }, [refreshSyncs]);

  async function doImport() {
    setError(null);
    setLastResult(null);
    if (!equipmentId) {
      setError('Select a machine to sync into.');
      return;
    }
    let rows: Record<string, unknown>[];
    try {
      rows = parseTelemetry(raw);
    } catch (e) {
      setError(`Could not parse telemetry: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (rows.length === 0) {
      setError('No telemetry rows found. Paste a JSON array or CSV with a header row.');
      return;
    }
    setImporting(true);
    try {
      const r = await lensRun('agriculture', 'telemetry-import', {
        equipmentId,
        protocol,
        rows,
      });
      if (r.data?.ok) {
        const res = r.data.result as { sync?: SyncRecord } | null;
        setLastResult(
          `Synced ${res?.sync?.rowsApplied ?? 0}/${res?.sync?.rowsReceived ?? 0} rows · ${
            res?.sync?.areaWorkedAcres ?? 0
          } ac worked`,
        );
        setRaw('');
        await Promise.all([refreshEquipment(), refreshSyncs()]);
      } else {
        setError(r.data?.error || 'Telemetry import failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const machine = equipment.find((e) => e.id === equipmentId) || null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading fleet…
      </div>
    );
  }
  if (equipment.length === 0) {
    return (
      <div className="py-10 text-center text-xs text-gray-400">
        <Cpu className="w-6 h-6 mx-auto mb-2 opacity-30" />
        No equipment yet. Add a machine in the Equipment tab to import telemetry.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {equipment.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.kind})
            </option>
          ))}
        </select>
        <select
          value={protocol}
          onChange={(e) => setProtocol(e.target.value)}
          className="px-2 py-1.5 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
        >
          {PROTOCOLS.map((p) => (
            <option key={p} value={p}>
              {p.toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {machine && (
        <div className="grid grid-cols-4 gap-2 text-center">
          {[
            { k: 'Engine h', v: `${machine.hoursEngine}` },
            { k: 'Fuel', v: `${machine.fuelLevelPct}%` },
            { k: 'DEF', v: `${machine.defLevelPct}%` },
            { k: 'Speed', v: `${machine.speedMph} mph` },
          ].map((m) => (
            <div key={m.k} className="rounded bg-lattice-deep px-2 py-1.5">
              <div className="text-sm font-bold text-cyan-300">{m.v}</div>
              <div className="text-[10px] text-gray-400">{m.k}</div>
            </div>
          ))}
        </div>
      )}

      <div>
        <label className="text-[11px] text-gray-400 block mb-1">
          ISOBUS / CAN telemetry batch (JSON array or CSV with header)
        </label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={
            'ts,latitude,longitude,groundSpeed,engineHours,fuelLevel,rpm,areaWorked\n' +
            '2026-05-21T14:00:00Z,41.5,-93.5,4.8,1240.5,72,2100,3.2'
          }
          className="w-full px-2 py-2 text-[11px] font-mono bg-lattice-deep border border-lattice-border rounded text-white"
        />
      </div>

      <button
        onClick={doImport}
        disabled={importing}
        className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-40 inline-flex items-center gap-1"
      >
        {importing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
        Import telemetry
      </button>

      {error && (
        <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2">
          {error}
        </div>
      )}
      {lastResult && (
        <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded px-3 py-2">
          {lastResult}
        </div>
      )}

      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-400 mb-2 flex items-center gap-1">
          <Clock className="w-3 h-3" /> Sync history
        </div>
        {syncs.length === 0 ? (
          <div className="text-xs text-gray-400 py-3">No imports for this machine yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {syncs.map((s) => (
              <li key={s.id} className="py-2 flex items-center gap-3 text-xs">
                <span className="font-mono uppercase text-cyan-300">{s.protocol}</span>
                <span className="text-gray-300">
                  {s.rowsApplied}/{s.rowsReceived} rows
                </span>
                <span className="text-gray-400">{s.areaWorkedAcres} ac</span>
                <span className="ml-auto text-gray-600">
                  {new Date(s.importedAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default TelemetryImportPanel;
