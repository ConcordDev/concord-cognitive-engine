'use client';

import { useState } from 'react';
import {
  ShieldCheck,
  Wrench,
  BarChart3,
  Timer,
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Compliance & Reports — real macro-backed analysis tools.
//
// logistics.fleetReport / logistics.maintenanceAlert / logistics.complianceAudit
// / logistics.hosCheck are compute-on-supplied-data macros (they analyse a
// batch of records, they don't own their own persisted entity table). This
// panel is the honest wiring: it pulls the REAL current fleet + shipment
// state from fleet-vehicles-list / shipments-list and feeds it straight into
// the macros via lensRun (no persisted "artifact" required — POST
// /api/lens/run builds the virtual artifact from the input body directly).
// The one field logistics genuinely does not persist yet is per-driver HOS
// logs (there's no driver roster table in this domain) — that tool takes a
// small ad-hoc entry form instead of pretending to read a roster that
// doesn't exist.
// ---------------------------------------------------------------------------

interface Vehicle {
  id: string;
  number: string;
  status: string;
  mileage: number;
  lastMaintenanceMileage: number;
}

interface Shipment {
  id: string;
  weightLbs: number;
}

interface FleetReportResult {
  totalVehicles: number;
  activeCount: number;
  idleCount: number;
  totalMileage: number;
  averageMileage: number;
  maintenanceDueCount: number;
}

interface MaintenanceAlertEntry {
  vehicleId: string;
  name: string;
  currentMileage: number;
  severity: 'critical' | 'warning';
  reasons: { type: string; message: string }[];
}

interface MaintenanceAlertResult {
  totalVehicles: number;
  alertCount: number;
  criticalCount: number;
  alerts: MaintenanceAlertEntry[];
}

interface ComplianceAuditResult {
  shipmentsAudited: number;
  compliant: number;
  nonCompliant: number;
  complianceRate: number;
  shipments: { shipmentId: string; status: string; checks: { check: string; passed: boolean; details: string }[] }[];
}

interface HosResult {
  driversChecked: number;
  violationCount: number;
  warningCount: number;
  drivers: {
    driverId: string;
    name: string;
    today: { drivingHours: number; drivingRemaining: number; windowRemaining: number };
    violations: string[];
    status: 'compliant' | 'warning' | 'violation';
  }[];
}

interface DriverRow {
  name: string;
  drivingHours: string;
  onDutyHours: string;
}

function ToolCard({
  icon: Icon,
  title,
  description,
  busy,
  onRun,
  runLabel,
  children,
}: {
  icon: typeof ShieldCheck;
  title: string;
  description: string;
  busy: boolean;
  onRun: () => void;
  runLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Icon className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">{title}</span>
      </header>
      <div className="p-3 space-y-3">
        <p className="text-xs text-gray-400">{description}</p>
        {children}
        <button
          onClick={onRun}
          disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
          {runLabel}
        </button>
      </div>
    </div>
  );
}

export function ComplianceReportsPanel() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fleetReport, setFleetReport] = useState<FleetReportResult | null>(null);
  const [maintAlerts, setMaintAlerts] = useState<MaintenanceAlertResult | null>(null);
  const [complianceResult, setComplianceResult] = useState<ComplianceAuditResult | null>(null);
  const [hosResult, setHosResult] = useState<HosResult | null>(null);
  const [drivers, setDrivers] = useState<DriverRow[]>([{ name: '', drivingHours: '', onDutyHours: '' }]);

  async function loadVehicles(): Promise<Vehicle[]> {
    const res = await lensRun({ domain: 'logistics', action: 'fleet-vehicles-list', input: {} });
    if (res.data?.ok === false) throw new Error(res.data?.error || 'Could not load fleet vehicles.');
    return (res.data?.result?.vehicles || []) as Vehicle[];
  }
  async function loadShipments(): Promise<Shipment[]> {
    const res = await lensRun({ domain: 'logistics', action: 'shipments-list', input: {} });
    if (res.data?.ok === false) throw new Error(res.data?.error || 'Could not load shipments.');
    return (res.data?.result?.shipments || []) as Shipment[];
  }

  async function runFleetReport() {
    setBusy('fleet');
    setError(null);
    try {
      const vehicles = await loadVehicles();
      if (vehicles.length === 0) {
        setError('No fleet vehicles yet — add vehicles in the Fleet tab first.');
        setFleetReport(null);
        return;
      }
      const mapped = vehicles.map((v) => ({
        vehicleId: v.id,
        name: v.number,
        status: v.status,
        currentMileage: v.mileage,
        // fuelConsumed is not tracked on a vehicle record yet — honestly 0,
        // not a fabricated estimate.
        fuelConsumed: 0,
      }));
      const res = await lensRun({ domain: 'logistics', action: 'fleetReport', input: { vehicles: mapped } });
      if (res.data?.ok) setFleetReport(res.data.result as FleetReportResult);
      else setError(res.data?.error || 'fleetReport failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runMaintenanceAlert() {
    setBusy('maintenance');
    setError(null);
    try {
      const vehicles = await loadVehicles();
      if (vehicles.length === 0) {
        setError('No fleet vehicles yet — add vehicles in the Fleet tab first.');
        setMaintAlerts(null);
        return;
      }
      const mapped = vehicles.map((v) => ({
        vehicleId: v.id,
        name: v.number,
        currentMileage: v.mileage,
        lastServiceMileage: v.lastMaintenanceMileage || 0,
      }));
      const res = await lensRun({ domain: 'logistics', action: 'maintenanceAlert', input: { vehicles: mapped } });
      if (res.data?.ok) setMaintAlerts(res.data.result as MaintenanceAlertResult);
      else setError(res.data?.error || 'maintenanceAlert failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runComplianceAudit() {
    setBusy('compliance');
    setError(null);
    try {
      const shipments = await loadShipments();
      if (shipments.length === 0) {
        setError('No shipments yet — create shipments in the Shipments tab first.');
        setComplianceResult(null);
        return;
      }
      const mapped = shipments.map((s) => ({
        shipmentId: s.id,
        weight: s.weightLbs,
        // Shipment documents aren't tracked yet, so the documentation check
        // will honestly report them missing rather than assuming compliance.
        documents: [],
      }));
      const res = await lensRun({ domain: 'logistics', action: 'complianceAudit', input: { shipments: mapped } });
      if (res.data?.ok) setComplianceResult(res.data.result as ComplianceAuditResult);
      else setError(res.data?.error || 'complianceAudit failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function runHosCheck() {
    setBusy('hos');
    setError(null);
    try {
      const valid = drivers.filter((d) => d.name.trim());
      if (valid.length === 0) {
        setError('Add at least one driver with today’s hours.');
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const payload = valid.map((d, i) => ({
        driverId: `adhoc_${i}`,
        name: d.name.trim(),
        logs: [
          {
            date: today,
            drivingHours: Number(d.drivingHours) || 0,
            onDutyHours: Number(d.onDutyHours) || 0,
          },
        ],
      }));
      const res = await lensRun({ domain: 'logistics', action: 'hosCheck', input: { drivers: payload } });
      if (res.data?.ok) setHosResult(res.data.result as HosResult);
      else setError(res.data?.error || 'hosCheck failed');
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setBusy(null);
    }
  }

  function updateDriver(i: number, field: keyof DriverRow, value: string) {
    setDrivers((prev) => prev.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }
  function addDriverRow() {
    setDrivers((prev) => [...prev, { name: '', drivingHours: '', onDutyHours: '' }]);
  }
  function removeDriverRow(i: number) {
    setDrivers((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Fleet Report */}
        <ToolCard
          icon={BarChart3}
          title="Fleet report"
          description="Summarizes live fleet mileage, fuel, and active/idle split from Fleet tab data."
          busy={busy === 'fleet'}
          onRun={runFleetReport}
          runLabel="Run fleet report"
        >
          {fleetReport && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Active" value={fleetReport.activeCount} color="text-green-400" />
              <Stat label="Idle" value={fleetReport.idleCount} color="text-gray-300" />
              <Stat label="Maint. due" value={fleetReport.maintenanceDueCount} color="text-amber-400" />
              <Stat label="Total mi" value={fleetReport.totalMileage.toLocaleString()} />
              <Stat label="Avg mi" value={fleetReport.averageMileage.toLocaleString()} />
              <Stat label="Vehicles" value={fleetReport.totalVehicles} />
            </div>
          )}
        </ToolCard>

        {/* Maintenance Alerts */}
        <ToolCard
          icon={Wrench}
          title="Maintenance alerts"
          description="Flags fleet vehicles past their mileage service interval (5,000 mi default)."
          busy={busy === 'maintenance'}
          onRun={runMaintenanceAlert}
          runLabel="Check maintenance"
        >
          {maintAlerts && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{maintAlerts.totalVehicles} checked</span>
                <span className={cn(maintAlerts.criticalCount > 0 ? 'text-red-400' : 'text-green-400')}>
                  {maintAlerts.alertCount} alert(s)
                </span>
              </div>
              {maintAlerts.alerts.slice(0, 6).map((a) => (
                <div key={a.vehicleId} className="flex items-center gap-2 text-xs px-2 py-1 bg-white/[0.03] rounded">
                  <AlertTriangle className={cn('w-3 h-3 shrink-0', a.severity === 'critical' ? 'text-red-400' : 'text-amber-400')} />
                  <span className="font-mono text-cyan-300">{a.name}</span>
                  <span className="text-gray-400 truncate">{a.reasons[0]?.message}</span>
                </div>
              ))}
              {maintAlerts.alertCount === 0 && (
                <p className="text-xs text-green-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> All vehicles within service interval.</p>
              )}
            </div>
          )}
        </ToolCard>

        {/* Compliance Audit */}
        <ToolCard
          icon={ShieldCheck}
          title="Shipment compliance audit"
          description="Checks live shipments for documentation, weight, hazmat, and customs compliance."
          busy={busy === 'compliance'}
          onRun={runComplianceAudit}
          runLabel="Run compliance audit"
        >
          {complianceResult && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-gray-400">{complianceResult.shipmentsAudited} audited</span>
                <span className="text-green-400">{complianceResult.compliant} compliant</span>
                <span className={cn(complianceResult.nonCompliant > 0 ? 'text-red-400' : 'text-gray-400')}>
                  {complianceResult.nonCompliant} non-compliant
                </span>
                <span className="ml-auto font-mono text-cyan-300">{complianceResult.complianceRate}%</span>
              </div>
              {complianceResult.shipments.slice(0, 6).map((s) => (
                <div key={s.shipmentId} className="flex items-center gap-2 text-xs px-2 py-1 bg-white/[0.03] rounded">
                  {s.status === 'compliant' ? (
                    <CheckCircle className="w-3 h-3 text-green-400 shrink-0" />
                  ) : (
                    <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                  )}
                  <span className="font-mono text-gray-300">{s.shipmentId}</span>
                  <span className="text-gray-500 truncate">
                    {s.checks.filter((c) => !c.passed).map((c) => c.check).join(', ') || 'all checks passed'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ToolCard>

        {/* HOS Check */}
        <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
          <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
            <Timer className="w-4 h-4 text-cyan-400" />
            <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Driver HOS check</span>
          </header>
          <div className="p-3 space-y-2">
            <p className="text-xs text-gray-400">
              Ad-hoc FMCSA hours-of-service check against today&rsquo;s logs (Concord doesn&rsquo;t
              persist a driver roster yet — enter today&rsquo;s hours from your ELD).
            </p>
            {drivers.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_5rem_auto] gap-1.5 items-center">
                <input
                  value={d.name}
                  onChange={(e) => updateDriver(i, 'name', e.target.value)}
                  placeholder="Driver name"
                  className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <input
                  type="number"
                  value={d.drivingHours}
                  onChange={(e) => updateDriver(i, 'drivingHours', e.target.value)}
                  placeholder="Drive h"
                  className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <input
                  type="number"
                  value={d.onDutyHours}
                  onChange={(e) => updateDriver(i, 'onDutyHours', e.target.value)}
                  placeholder="On-duty h"
                  className="px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
                />
                <button
                  aria-label="Remove driver row"
                  onClick={() => removeDriverRow(i)}
                  className="p-1 text-rose-400 disabled:opacity-30"
                  disabled={drivers.length <= 1}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            <button
              onClick={addDriverRow}
              className="text-xs text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Add driver
            </button>
            <div>
              <button
                onClick={runHosCheck}
                disabled={busy === 'hos'}
                className="px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {busy === 'hos' ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Run HOS check
              </button>
            </div>
            {hosResult && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-gray-400">{hosResult.driversChecked} checked</span>
                  <span className={cn(hosResult.violationCount > 0 ? 'text-red-400' : 'text-green-400')}>
                    {hosResult.violationCount} violation(s)
                  </span>
                  <span className={cn(hosResult.warningCount > 0 ? 'text-amber-400' : 'text-gray-400')}>
                    {hosResult.warningCount} warning(s)
                  </span>
                </div>
                {hosResult.drivers.map((d) => (
                  <div key={d.driverId} className="flex items-center gap-2 text-xs px-2 py-1 bg-white/[0.03] rounded">
                    <span
                      className={cn(
                        'w-1.5 h-1.5 rounded-full shrink-0',
                        d.status === 'violation' ? 'bg-red-400' : d.status === 'warning' ? 'bg-amber-400' : 'bg-green-400'
                      )}
                    />
                    <span className="font-mono text-cyan-300">{d.name}</span>
                    <span className="text-gray-400">{d.today.drivingHours}h driving</span>
                    <span className="text-gray-500 truncate">{d.violations[0] || 'compliant'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="p-2 bg-white/[0.03] rounded text-center">
      <p className={cn('text-sm font-bold', color || 'text-cyan-300')}>{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

export default ComplianceReportsPanel;
