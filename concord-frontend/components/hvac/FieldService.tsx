/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { ChartKit } from '@/components/viz';
import {
  CalendarDays,
  CalendarCheck,
  CreditCard,
  Boxes,
  FileSignature,
  Repeat,
  Smartphone,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  User,
  Camera,
} from 'lucide-react';

// ── shared types ──────────────────────────────────────────────────────
interface Technician {
  id: string;
  name: string;
  skills: string[];
  phone: string;
  color: string;
  active: boolean;
  assignedCount?: number;
}
interface Appointment {
  id: string;
  title: string;
  client: string;
  address: string;
  jobType: string;
  technicianId: string | null;
  date: string;
  slot: string;
  durationHrs: number;
  status: string;
  priority: string;
  notes: string;
}
interface DispatchLane {
  technician: { id: string; name: string; color: string };
  appointments: Appointment[];
}
interface DispatchBoard {
  date: string;
  lanes: DispatchLane[];
  unassigned: Appointment[];
  stats: {
    appointments: number;
    assigned: number;
    unassigned: number;
    technicians: number;
    scheduledHours: number;
  };
}
interface Booking {
  id: string;
  customer: string;
  phone: string;
  email: string;
  address: string;
  serviceType: string;
  preferredDate: string;
  preferredSlot: string;
  issue: string;
  status: string;
  confirmation: string;
  appointmentId: string | null;
}
interface AssetServiceEntry {
  id: string;
  date: string;
  serviceType: string;
  technician: string;
  summary: string;
  partsReplaced: string[];
  cost: number;
}
interface Asset {
  id: string;
  client: string;
  address: string;
  equipmentType: string;
  brand: string;
  model: string;
  serial: string;
  installYear: number | null;
  tonnage: number | null;
  seer: number | null;
  refrigerant: string;
  warrantyExpires: string;
  history: AssetServiceEntry[];
  serviceCount: number;
  ageYears: number | null;
  warrantyActive: boolean | null;
}
interface SignatureRequest {
  id: string;
  estimateId: string;
  client: string;
  amount: number;
  token: string;
  status: string;
  signedName: string | null;
  signedAt: string | null;
}
interface Payment {
  id: string;
  invoiceId: string;
  client: string;
  amount: number;
  method: string;
  processingFee: number;
  net: number;
  status: string;
  reference: string;
  paidAt: string;
}
interface PaymentSummary {
  count: number;
  collected: number;
  fees: number;
  net: number;
  pendingSignatures: number;
}
interface AgreementVisit {
  seq: number;
  dueDate: string;
  status: string;
  completedDate?: string;
}
interface Agreement {
  id: string;
  client: string;
  address: string;
  tier: string;
  visitsPerYear: number;
  annualPrice: number;
  perks: string[];
  startDate: string;
  renewalDate: string;
  autoRenew: boolean;
  status: string;
  visits: AgreementVisit[];
  visitsDue: number;
  nextVisit: AgreementVisit | null;
}
interface FieldChecklistItem {
  label: string;
  done: boolean;
}
interface FieldPart {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}
interface FieldPhoto {
  id: string;
  caption: string;
  dataUrl: string;
}
interface FieldVisit {
  id: string;
  appointmentId: string;
  client: string;
  address: string;
  technician: string;
  status: string;
  checklist: FieldChecklistItem[];
  partsUsed: FieldPart[];
  photos: FieldPhoto[];
  notes: string;
  checklistProgress: number;
  partsCount: number;
  photoCount: number;
  partsTotal?: number;
}

type FsTab = 'dispatch' | 'bookings' | 'assets' | 'estimates' | 'payments' | 'agreements' | 'field';

const FS_TABS: { id: FsTab; label: string; icon: typeof CalendarDays }[] = [
  { id: 'dispatch', label: 'Dispatch', icon: CalendarDays },
  { id: 'bookings', label: 'Bookings', icon: CalendarCheck },
  { id: 'assets', label: 'Equipment', icon: Boxes },
  { id: 'estimates', label: 'E-Sign', icon: FileSignature },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'agreements', label: 'Contracts', icon: Repeat },
  { id: 'field', label: 'Mobile', icon: Smartphone },
];

const SLOTS = ['morning', 'midday', 'afternoon', 'evening'];

async function run<T = any>(action: string, input: Record<string, unknown> = {}): Promise<T | null> {
  const r = await lensRun<T>('hvac', action, input);
  return r.data?.ok ? (r.data.result as T) : null;
}

// ══════════════════════════════════════════════════════════════════════
export function FieldService() {
  const [tab, setTab] = useState<FsTab>('dispatch');
  return (
    <div data-lens-theme="hvac" className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap border-b border-lattice-border pb-3">
        {FS_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors',
              tab === t.id
                ? 'bg-neon-blue/20 text-neon-blue'
                : 'text-gray-400 hover:text-white hover:bg-lattice-elevated',
            )}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'dispatch' && <DispatchPanel />}
      {tab === 'bookings' && <BookingsPanel />}
      {tab === 'assets' && <AssetsPanel />}
      {tab === 'estimates' && <EsignPanel />}
      {tab === 'payments' && <PaymentsPanel />}
      {tab === 'agreements' && <AgreementsPanel />}
      {tab === 'field' && <FieldPanel />}
    </div>
  );
}

// ── Dispatch board ────────────────────────────────────────────────────
function DispatchPanel() {
  const [board, setBoard] = useState<DispatchBoard | null>(null);
  const [techs, setTechs] = useState<Technician[]>([]);
  const [date, setDate] = useState('');
  const [loading, setLoading] = useState(false);
  const [showTechForm, setShowTechForm] = useState(false);
  const [showApptForm, setShowApptForm] = useState(false);
  const [techName, setTechName] = useState('');
  const [techSkills, setTechSkills] = useState('');
  const [techPhone, setTechPhone] = useState('');
  const [apTitle, setApTitle] = useState('');
  const [apClient, setApClient] = useState('');
  const [apAddress, setApAddress] = useState('');
  const [apJobType, setApJobType] = useState('service');
  const [apDate, setApDate] = useState('');
  const [apSlot, setApSlot] = useState('morning');
  const [apDuration, setApDuration] = useState('2');
  const [apPriority, setApPriority] = useState('normal');
  const [dragId, setDragId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, t] = await Promise.all([
      run<DispatchBoard>('dispatch-board', date ? { date } : {}),
      run<{ technicians: Technician[] }>('tech-list'),
    ]);
    if (b) setBoard(b);
    if (t) setTechs(t.technicians || []);
    setLoading(false);
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const addTech = async () => {
    if (!techName.trim()) return;
    await run('tech-add', {
      name: techName,
      skills: techSkills.split(',').map((s) => s.trim()).filter(Boolean),
      phone: techPhone,
    });
    setTechName('');
    setTechSkills('');
    setTechPhone('');
    setShowTechForm(false);
    await load();
  };
  const addAppt = async () => {
    if (!apTitle.trim()) return;
    await run('appointment-create', {
      title: apTitle,
      client: apClient,
      address: apAddress,
      jobType: apJobType,
      date: apDate,
      slot: apSlot,
      durationHrs: parseFloat(apDuration) || 2,
      priority: apPriority,
    });
    setApTitle('');
    setApClient('');
    setApAddress('');
    setApDate('');
    setShowApptForm(false);
    await load();
  };
  const assign = async (apptId: string, technicianId: string | null) => {
    await run('appointment-assign', { id: apptId, technicianId });
    await load();
  };
  const setStatus = async (apptId: string, status: string) => {
    await run('appointment-status', { id: apptId, status });
    await load();
  };
  const delAppt = async (apptId: string) => {
    await run('appointment-delete', { id: apptId });
    await load();
  };
  const delTech = async (id: string) => {
    await run('tech-delete', { id });
    await load();
  };

  const onDrop = async (technicianId: string | null) => {
    if (dragId) await assign(dragId, technicianId);
    setDragId(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          className={cn(ds.input, 'w-auto')}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button onClick={() => void load()} className={ds.btnSecondary}>
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
        <button onClick={() => setShowTechForm((v) => !v)} className={ds.btnSecondary}>
          <User className="w-4 h-4" /> Technician
        </button>
        <button onClick={() => setShowApptForm((v) => !v)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Appointment
        </button>
      </div>

      {board && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label="Appointments" value={board.stats.appointments} />
          <Stat label="Assigned" value={board.stats.assigned} />
          <Stat label="Unassigned" value={board.stats.unassigned} />
          <Stat label="Technicians" value={board.stats.technicians} />
          <Stat label="Sched. Hrs" value={board.stats.scheduledHours} />
        </div>
      )}

      {showTechForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <input className={ds.input} placeholder="Technician name" value={techName} onChange={(e) => setTechName(e.target.value)} />
          <input className={ds.input} placeholder="Skills (comma separated)" value={techSkills} onChange={(e) => setTechSkills(e.target.value)} />
          <input className={ds.input} placeholder="Phone" value={techPhone} onChange={(e) => setTechPhone(e.target.value)} />
          <button onClick={addTech} className={ds.btnPrimary} disabled={!techName.trim()}>Add technician</button>
        </div>
      )}
      {showApptForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <input className={ds.input} placeholder="Appointment title" value={apTitle} onChange={(e) => setApTitle(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={ds.input} placeholder="Client" value={apClient} onChange={(e) => setApClient(e.target.value)} />
            <input className={ds.input} placeholder="Address" value={apAddress} onChange={(e) => setApAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <input className={ds.input} placeholder="Job type" value={apJobType} onChange={(e) => setApJobType(e.target.value)} />
            <input type="date" className={ds.input} value={apDate} onChange={(e) => setApDate(e.target.value)} />
            <select className={ds.select} value={apSlot} onChange={(e) => setApSlot(e.target.value)}>
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="number" className={ds.input} placeholder="Hrs" value={apDuration} onChange={(e) => setApDuration(e.target.value)} />
            <select className={ds.select} value={apPriority} onChange={(e) => setApPriority(e.target.value)}>
              {['low', 'normal', 'high', 'emergency'].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <button onClick={addAppt} className={ds.btnPrimary} disabled={!apTitle.trim()}>Create appointment</button>
        </div>
      )}

      {loading && !board ? (
        <Spinner />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {/* unassigned lane */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDrop(null)}
            className={cn(ds.panel, 'min-h-[120px]')}
          >
            <p className="text-sm font-semibold text-amber-300 mb-2">Unassigned</p>
            {board?.unassigned.length ? (
              board.unassigned.map((a) => (
                <ApptCard
                  key={a.id}
                  appt={a}
                  techs={techs}
                  onDragStart={() => setDragId(a.id)}
                  onAssign={assign}
                  onStatus={setStatus}
                  onDelete={delAppt}
                />
              ))
            ) : (
              <p className={ds.textMuted}>No unassigned work</p>
            )}
          </div>
          {/* technician lanes */}
          {board?.lanes.map((lane) => {
            const tech = techs.find((t) => t.id === lane.technician.id);
            return (
              <div
                key={lane.technician.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(lane.technician.id)}
                className={cn(ds.panel, 'min-h-[120px]')}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: lane.technician.color }} />
                    {lane.technician.name}
                  </span>
                  <button onClick={() => delTech(lane.technician.id)} className={ds.btnGhost} aria-label="Remove technician">
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
                {tech?.skills.length ? (
                  <p className="text-xs text-gray-400 mb-2">{tech.skills.join(' · ')}</p>
                ) : null}
                {lane.appointments.length ? (
                  lane.appointments.map((a) => (
                    <ApptCard
                      key={a.id}
                      appt={a}
                      techs={techs}
                      onDragStart={() => setDragId(a.id)}
                      onAssign={assign}
                      onStatus={setStatus}
                      onDelete={delAppt}
                    />
                  ))
                ) : (
                  <p className={ds.textMuted}>Drag work here</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const PRIORITY_COLOR: Record<string, string> = {
  low: 'text-gray-400',
  normal: 'text-sky-400',
  high: 'text-amber-400',
  emergency: 'text-red-400',
};
const STATUS_COLOR: Record<string, string> = {
  scheduled: 'bg-blue-400/20 text-blue-300',
  dispatched: 'bg-cyan-400/20 text-cyan-300',
  in_progress: 'bg-purple-400/20 text-purple-300',
  completed: 'bg-emerald-400/20 text-emerald-300',
  cancelled: 'bg-red-400/20 text-red-300',
};

function ApptCard({
  appt,
  techs,
  onDragStart,
  onAssign,
  onStatus,
  onDelete,
}: {
  appt: Appointment;
  techs: Technician[];
  onDragStart: () => void;
  onAssign: (id: string, techId: string | null) => void;
  onStatus: (id: string, status: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      className="mb-2 rounded-lg border border-lattice-border bg-lattice-elevated p-2 cursor-move"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-white font-medium truncate">{appt.title}</p>
        <span className={cn('text-[10px] uppercase font-semibold', PRIORITY_COLOR[appt.priority])}>
          {appt.priority}
        </span>
      </div>
      <p className="text-xs text-gray-400 truncate">
        {appt.client}{appt.address ? ` · ${appt.address}` : ''}
      </p>
      <p className="text-xs text-gray-400">
        {appt.date || 'no date'} · {appt.slot} · {appt.durationHrs}h
      </p>
      <div className="flex items-center gap-1 mt-1.5 flex-wrap">
        <select
          className="text-xs bg-lattice-base border border-lattice-border rounded px-1 py-0.5 text-gray-300"
          value={appt.technicianId || ''}
          onChange={(e) => onAssign(appt.id, e.target.value || null)}
        >
          <option value="">Unassigned</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select
          className={cn('text-xs rounded px-1 py-0.5', STATUS_COLOR[appt.status] || 'bg-lattice-base text-gray-300')}
          value={appt.status}
          onChange={(e) => onStatus(appt.id, e.target.value)}
        >
          {['scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button onClick={() => onDelete(appt.id)} className={ds.btnGhost} aria-label="Delete appointment">
          <Trash2 className="w-3.5 h-3.5 text-red-400" />
        </button>
      </div>
    </div>
  );
}

// ── Bookings ──────────────────────────────────────────────────────────
function BookingsPanel() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [serviceType, setServiceType] = useState('diagnostic');
  const [preferredDate, setPreferredDate] = useState('');
  const [preferredSlot, setPreferredSlot] = useState('morning');
  const [issue, setIssue] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ bookings: Booking[]; pending: number }>('booking-list');
    if (r) {
      setBookings(r.bookings || []);
      setPending(r.pending || 0);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (!customer.trim() || (!phone.trim() && !email.trim())) return;
    await run('booking-request', {
      customer, phone, email, address, serviceType, preferredDate, preferredSlot, issue,
    });
    setCustomer('');
    setPhone('');
    setEmail('');
    setAddress('');
    setIssue('');
    setPreferredDate('');
    setShowForm(false);
    await load();
  };
  const confirm = async (id: string) => {
    await run('booking-confirm', { id });
    await load();
  };
  const decline = async (id: string) => {
    await run('booking-confirm', { id, decline: true });
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-400">
          {bookings.length} requests · {pending} pending
        </p>
        <div className="flex-1" />
        <button onClick={() => setShowForm((v) => !v)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> New booking
        </button>
      </div>
      {showForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <p className="text-xs text-gray-400">Customer-facing self-service booking request form.</p>
          <div className="grid grid-cols-2 gap-2">
            <input className={ds.input} placeholder="Customer name" value={customer} onChange={(e) => setCustomer(e.target.value)} />
            <input className={ds.input} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <input className={ds.input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={ds.input} placeholder="Service address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <input className={ds.input} placeholder="Service type" value={serviceType} onChange={(e) => setServiceType(e.target.value)} />
            <input type="date" className={ds.input} value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} />
            <select className={ds.select} value={preferredSlot} onChange={(e) => setPreferredSlot(e.target.value)}>
              {SLOTS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <textarea className={ds.textarea} rows={2} placeholder="Describe the issue" value={issue} onChange={(e) => setIssue(e.target.value)} />
          <button onClick={submit} className={ds.btnPrimary} disabled={!customer.trim() || (!phone.trim() && !email.trim())}>
            Submit request
          </button>
        </div>
      )}
      {loading && !bookings.length ? (
        <Spinner />
      ) : bookings.length === 0 ? (
        <Empty label="No booking requests yet" />
      ) : (
        bookings.map((b) => (
          <div key={b.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium">{b.customer}</p>
                <p className="text-xs text-gray-400">
                  {b.serviceType} · {b.preferredDate || 'flexible'} ({b.preferredSlot})
                </p>
                <p className="text-xs text-gray-400">{b.phone || b.email}{b.address ? ` · ${b.address}` : ''}</p>
              </div>
              <span className="text-[10px] uppercase font-semibold text-amber-300">{b.confirmation}</span>
            </div>
            {b.issue && <p className="text-xs text-gray-400 mt-1">{b.issue}</p>}
            <div className="flex items-center gap-2 mt-2">
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  b.status === 'confirmed' ? 'bg-emerald-400/20 text-emerald-300'
                    : b.status === 'declined' ? 'bg-red-400/20 text-red-300'
                      : 'bg-yellow-400/20 text-yellow-300',
                )}
              >
                {b.status}
              </span>
              {b.status === 'requested' && (
                <>
                  <button onClick={() => confirm(b.id)} className={ds.btnPrimary}>
                    <CheckCircle2 className="w-4 h-4" /> Confirm
                  </button>
                  <button onClick={() => decline(b.id)} className={ds.btnSecondary}>
                    <XCircle className="w-4 h-4" /> Decline
                  </button>
                </>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Assets / equipment ────────────────────────────────────────────────
function AssetsPanel() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [equipmentType, setEquipmentType] = useState('central-ac');
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [installYear, setInstallYear] = useState('');
  const [tonnage, setTonnage] = useState('');
  const [seer, setSeer] = useState('');
  const [refrigerant, setRefrigerant] = useState('R-410A');
  const [warrantyExpires, setWarrantyExpires] = useState('');
  const [logFor, setLogFor] = useState<string | null>(null);
  const [svcType, setSvcType] = useState('maintenance');
  const [svcTech, setSvcTech] = useState('');
  const [svcSummary, setSvcSummary] = useState('');
  const [svcParts, setSvcParts] = useState('');
  const [svcCost, setSvcCost] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ assets: Asset[] }>('asset-list', filter ? { address: filter } : {});
    if (r) setAssets(r.assets || []);
    setLoading(false);
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);

  const addAsset = async () => {
    if (!address.trim()) return;
    await run('asset-add', {
      client, address, equipmentType, brand, model, serial,
      installYear: installYear ? parseInt(installYear, 10) : undefined,
      tonnage: tonnage ? parseFloat(tonnage) : undefined,
      seer: seer ? parseFloat(seer) : undefined,
      refrigerant, warrantyExpires,
    });
    setClient('');
    setAddress('');
    setBrand('');
    setModel('');
    setSerial('');
    setInstallYear('');
    setTonnage('');
    setSeer('');
    setWarrantyExpires('');
    setShowForm(false);
    await load();
  };
  const logService = async () => {
    if (!logFor) return;
    await run('asset-log-service', {
      assetId: logFor,
      serviceType: svcType,
      technician: svcTech,
      summary: svcSummary,
      partsReplaced: svcParts.split(',').map((p) => p.trim()).filter(Boolean),
      cost: svcCost ? parseFloat(svcCost) : 0,
    });
    setLogFor(null);
    setSvcSummary('');
    setSvcParts('');
    setSvcCost('');
    setSvcTech('');
    await load();
  };
  const delAsset = async (id: string) => {
    await run('asset-delete', { id });
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className={cn(ds.input, 'flex-1 min-w-[160px]')}
          placeholder="Filter by address"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={() => setShowForm((v) => !v)} className={ds.btnPrimary}>
          <Plus className="w-4 h-4" /> Equipment record
        </button>
      </div>
      {showForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <input className={ds.input} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input className={ds.input} placeholder="Service address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <input className={ds.input} placeholder="Equipment type" value={equipmentType} onChange={(e) => setEquipmentType(e.target.value)} />
            <input className={ds.input} placeholder="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
            <input className={ds.input} placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} />
            <input className={ds.input} placeholder="Serial #" value={serial} onChange={(e) => setSerial(e.target.value)} />
            <input type="number" className={ds.input} placeholder="Install year" value={installYear} onChange={(e) => setInstallYear(e.target.value)} />
            <input type="number" className={ds.input} placeholder="Tonnage" value={tonnage} onChange={(e) => setTonnage(e.target.value)} />
            <input type="number" className={ds.input} placeholder="SEER" value={seer} onChange={(e) => setSeer(e.target.value)} />
            <input className={ds.input} placeholder="Refrigerant" value={refrigerant} onChange={(e) => setRefrigerant(e.target.value)} />
            <input type="date" className={ds.input} value={warrantyExpires} onChange={(e) => setWarrantyExpires(e.target.value)} />
          </div>
          <button onClick={addAsset} className={ds.btnPrimary} disabled={!address.trim()}>Add equipment</button>
        </div>
      )}
      {loading && !assets.length ? (
        <Spinner />
      ) : assets.length === 0 ? (
        <Empty label="No equipment records" />
      ) : (
        assets.map((a) => (
          <div key={a.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium">
                  {a.brand} {a.model || a.equipmentType}
                </p>
                <p className="text-xs text-gray-400">{a.client} · {a.address}</p>
                <p className="text-xs text-gray-400">
                  {a.serial ? `S/N ${a.serial} · ` : ''}
                  {a.ageYears != null ? `${a.ageYears}yr old · ` : ''}
                  {a.tonnage ? `${a.tonnage}t · ` : ''}
                  {a.seer ? `SEER ${a.seer} · ` : ''}
                  {a.serviceCount} services
                </p>
              </div>
              <div className="flex items-center gap-1">
                {a.warrantyActive != null && (
                  <span
                    className={cn(
                      'text-[10px] px-2 py-0.5 rounded-full',
                      a.warrantyActive ? 'bg-emerald-400/20 text-emerald-300' : 'bg-gray-500/20 text-gray-400',
                    )}
                  >
                    {a.warrantyActive ? 'In warranty' : 'Out of warranty'}
                  </span>
                )}
                <button onClick={() => delAsset(a.id)} className={ds.btnGhost} aria-label="Delete equipment">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>
            {a.history.length > 0 && (
              <div className="mt-2 border-t border-lattice-border pt-2 space-y-1">
                {a.history.slice(0, 4).map((h) => (
                  <div key={h.id} className="text-xs text-gray-400 flex items-center justify-between">
                    <span>{h.date} · {h.serviceType}{h.technician ? ` (${h.technician})` : ''}</span>
                    {h.cost > 0 && <span className="text-green-400">${h.cost}</span>}
                  </div>
                ))}
              </div>
            )}
            {logFor === a.id ? (
              <div className="mt-2 space-y-2 border-t border-lattice-border pt-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className={ds.input} placeholder="Service type" value={svcType} onChange={(e) => setSvcType(e.target.value)} />
                  <input className={ds.input} placeholder="Technician" value={svcTech} onChange={(e) => setSvcTech(e.target.value)} />
                  <input className={ds.input} placeholder="Parts (comma separated)" value={svcParts} onChange={(e) => setSvcParts(e.target.value)} />
                  <input type="number" className={ds.input} placeholder="Cost" value={svcCost} onChange={(e) => setSvcCost(e.target.value)} />
                </div>
                <textarea className={ds.textarea} rows={2} placeholder="Service summary" value={svcSummary} onChange={(e) => setSvcSummary(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={logService} className={ds.btnPrimary}>Save service</button>
                  <button onClick={() => setLogFor(null)} className={ds.btnSecondary}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setLogFor(a.id)} className={cn(ds.btnSecondary, 'mt-2')}>
                <Plus className="w-4 h-4" /> Log service
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── E-sign / estimate approval ────────────────────────────────────────
function EsignPanel() {
  const [signatures, setSignatures] = useState<SignatureRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [estimateId, setEstimateId] = useState('');
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [signFor, setSignFor] = useState<string | null>(null);
  const [signedName, setSignedName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ signatures: SignatureRequest[] }>('payment-list');
    if (r) setSignatures(r.signatures || []);
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    if (!estimateId.trim() || !(parseFloat(amount) > 0)) return;
    await run('estimate-request-signature', { estimateId, client, amount: parseFloat(amount) });
    setEstimateId('');
    setClient('');
    setAmount('');
    setShowForm(false);
    await load();
  };
  const sign = async (id: string) => {
    if (!signedName.trim()) return;
    await run('estimate-sign', { id, signedName });
    setSignFor(null);
    setSignedName('');
    await load();
  };
  const declineSign = async (id: string) => {
    if (!signedName.trim()) return;
    await run('estimate-sign', { id, signedName, declined: true });
    setSignFor(null);
    setSignedName('');
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-sm text-gray-400">
          {signatures.filter((s) => s.status === 'sent').length} awaiting signature
        </p>
        <div className="flex-1" />
        <button onClick={() => setShowForm((v) => !v)} className={ds.btnPrimary}>
          <FileSignature className="w-4 h-4" /> Request approval
        </button>
      </div>
      {showForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <div className="grid grid-cols-3 gap-2">
            <input className={ds.input} placeholder="Estimate ID" value={estimateId} onChange={(e) => setEstimateId(e.target.value)} />
            <input className={ds.input} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input type="number" className={ds.input} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <button onClick={request} className={ds.btnPrimary} disabled={!estimateId.trim() || !(parseFloat(amount) > 0)}>
            Send approval request
          </button>
        </div>
      )}
      {loading && !signatures.length ? (
        <Spinner />
      ) : signatures.length === 0 ? (
        <Empty label="No estimate approval requests" />
      ) : (
        signatures.map((s) => (
          <div key={s.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium">Estimate {s.estimateId}</p>
                <p className="text-xs text-gray-400">{s.client} · ${s.amount.toLocaleString()}</p>
                <p className="text-xs text-gray-400">Token {s.token}</p>
              </div>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  s.status === 'signed' ? 'bg-emerald-400/20 text-emerald-300'
                    : s.status === 'declined' ? 'bg-red-400/20 text-red-300'
                      : 'bg-yellow-400/20 text-yellow-300',
                )}
              >
                {s.status}
              </span>
            </div>
            {s.status === 'signed' && (
              <p className="text-xs text-emerald-300 mt-1">
                Signed by {s.signedName} on {s.signedAt?.slice(0, 10)}
              </p>
            )}
            {s.status === 'sent' && (
              signFor === s.id ? (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <input
                    className={cn(ds.input, 'flex-1 min-w-[160px]')}
                    placeholder="Type signer full name"
                    value={signedName}
                    onChange={(e) => setSignedName(e.target.value)}
                  />
                  <button onClick={() => sign(s.id)} className={ds.btnPrimary} disabled={!signedName.trim()}>
                    Approve &amp; sign
                  </button>
                  <button onClick={() => declineSign(s.id)} className={ds.btnSecondary} disabled={!signedName.trim()}>
                    Decline
                  </button>
                  <button onClick={() => setSignFor(null)} className={ds.btnGhost}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setSignFor(s.id)} className={cn(ds.btnSecondary, 'mt-2')}>
                  <FileSignature className="w-4 h-4" /> Capture signature
                </button>
              )
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────
function PaymentsPanel() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [summary, setSummary] = useState<PaymentSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [client, setClient] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('card');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{ payments: Payment[]; summary: PaymentSummary }>('payment-list');
    if (r) {
      setPayments(r.payments || []);
      setSummary(r.summary || null);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const charge = async () => {
    if (!invoiceId.trim() || !(parseFloat(amount) > 0)) return;
    await run('payment-charge', { invoiceId, client, amount: parseFloat(amount), method });
    setInvoiceId('');
    setClient('');
    setAmount('');
    setShowForm(false);
    await load();
  };
  const refund = async (id: string) => {
    await run('payment-refund', { id });
    await load();
  };

  const chartData = useMemo(() => {
    const byMethod: Record<string, number> = {};
    for (const p of payments) {
      if (p.status !== 'paid') continue;
      byMethod[p.method] = (byMethod[p.method] || 0) + p.amount;
    }
    return Object.entries(byMethod).map(([method, collected]) => ({ method, collected }));
  }, [payments]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button onClick={() => setShowForm((v) => !v)} className={ds.btnPrimary}>
          <CreditCard className="w-4 h-4" /> Charge invoice
        </button>
      </div>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Payments" value={summary.count} />
          <Stat label="Collected" value={`$${summary.collected.toLocaleString()}`} />
          <Stat label="Fees" value={`$${summary.fees.toLocaleString()}`} />
          <Stat label="Net" value={`$${summary.net.toLocaleString()}`} />
        </div>
      )}
      {chartData.length > 0 && (
        <div className={ds.panel}>
          <p className="text-sm text-gray-400 mb-2">Collected by payment method</p>
          <ChartKit
            kind="bar"
            data={chartData}
            xKey="method"
            series={[{ key: 'collected', label: 'Collected', color: '#34d399' }]}
            height={160}
          />
        </div>
      )}
      {showForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className={ds.input} placeholder="Invoice ID" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} />
            <input className={ds.input} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input type="number" className={ds.input} placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <select className={ds.select} value={method} onChange={(e) => setMethod(e.target.value)}>
              {['card', 'ach', 'cash', 'check'].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <button onClick={charge} className={ds.btnPrimary} disabled={!invoiceId.trim() || !(parseFloat(amount) > 0)}>
            Process payment
          </button>
        </div>
      )}
      {loading && !payments.length ? (
        <Spinner />
      ) : payments.length === 0 ? (
        <Empty label="No payments processed" />
      ) : (
        payments.map((p) => (
          <div key={p.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium">
                  Invoice {p.invoiceId} · ${p.amount.toLocaleString()}
                </p>
                <p className="text-xs text-gray-400">
                  {p.client} · {p.method} · fee ${p.processingFee} · net ${p.net}
                </p>
                <p className="text-xs text-gray-400">{p.reference} · {p.paidAt.slice(0, 10)}</p>
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    p.status === 'refunded' ? 'bg-red-400/20 text-red-300' : 'bg-emerald-400/20 text-emerald-300',
                  )}
                >
                  {p.status}
                </span>
                {p.status === 'paid' && (
                  <button onClick={() => refund(p.id)} className={ds.btnSecondary}>Refund</button>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Maintenance agreements ────────────────────────────────────────────
function AgreementsPanel() {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [mrr, setMrr] = useState(0);
  const [arr, setArr] = useState(0);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [client, setClient] = useState('');
  const [address, setAddress] = useState('');
  const [tier, setTier] = useState('standard');
  const [startDate, setStartDate] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const r = await run<{
      agreements: Agreement[];
      monthlyRecurringRevenue: number;
      annualRecurringRevenue: number;
    }>('agreement-list');
    if (r) {
      setAgreements(r.agreements || []);
      setMrr(r.monthlyRecurringRevenue || 0);
      setArr(r.annualRecurringRevenue || 0);
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!client.trim()) return;
    await run('agreement-create', { client, address, tier, startDate });
    setClient('');
    setAddress('');
    setStartDate('');
    setShowForm(false);
    await load();
  };
  const completeVisit = async (id: string, seq: number) => {
    await run('agreement-complete-visit', { id, seq });
    await load();
  };
  const cancel = async (id: string) => {
    await run('agreement-cancel', { id });
    await load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex-1" />
        <button onClick={() => setShowForm((v) => !v)} className={ds.btnPrimary}>
          <Repeat className="w-4 h-4" /> New contract
        </button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Active contracts" value={agreements.filter((a) => a.status === 'active').length} />
        <Stat label="MRR" value={`$${mrr.toLocaleString()}`} />
        <Stat label="ARR" value={`$${arr.toLocaleString()}`} />
      </div>
      {showForm && (
        <div className={cn(ds.panel, 'space-y-2')}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input className={ds.input} placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input className={ds.input} placeholder="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
            <select className={ds.select} value={tier} onChange={(e) => setTier(e.target.value)}>
              {['basic', 'standard', 'premium'].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="date" className={ds.input} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <button onClick={create} className={ds.btnPrimary} disabled={!client.trim()}>Create agreement</button>
        </div>
      )}
      {loading && !agreements.length ? (
        <Spinner />
      ) : agreements.length === 0 ? (
        <Empty label="No maintenance agreements" />
      ) : (
        agreements.map((a) => (
          <div key={a.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium capitalize">{a.tier} · {a.client}</p>
                <p className="text-xs text-gray-400">
                  ${a.annualPrice}/yr · {a.visitsPerYear} visits · renews {a.renewalDate}
                </p>
                {a.address && <p className="text-xs text-gray-400">{a.address}</p>}
              </div>
              <div className="flex items-center gap-1">
                <span
                  className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    a.status === 'active' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-red-400/20 text-red-300',
                  )}
                >
                  {a.status}
                </span>
                {a.status === 'active' && (
                  <button onClick={() => cancel(a.id)} className={ds.btnSecondary}>Cancel</button>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{a.perks.join(' · ')}</p>
            <div className="mt-2 border-t border-lattice-border pt-2 grid gap-1">
              {a.visits.map((v) => (
                <div key={v.seq} className="text-xs flex items-center justify-between">
                  <span className={cn(v.status === 'completed' ? 'text-emerald-300' : 'text-gray-400')}>
                    Visit {v.seq} · due {v.dueDate}
                    {v.completedDate ? ` · done ${v.completedDate}` : ''}
                  </span>
                  {v.status === 'scheduled' && a.status === 'active' && (
                    <button aria-label="Confirm" onClick={() => completeVisit(a.id, v.seq)} className={ds.btnGhost}>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Technician mobile field workflow ──────────────────────────────────
function FieldPanel() {
  const [visits, setVisits] = useState<FieldVisit[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [startApptId, setStartApptId] = useState('');
  const [startTech, setStartTech] = useState('');
  const [partName, setPartName] = useState<Record<string, string>>({});
  const [partQty, setPartQty] = useState<Record<string, string>>({});
  const [partPrice, setPartPrice] = useState<Record<string, string>>({});
  const [photoCaption, setPhotoCaption] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const [v, b] = await Promise.all([
      run<{ visits: FieldVisit[] }>('field-visit-list'),
      run<DispatchBoard>('dispatch-board'),
    ]);
    if (v) setVisits(v.visits || []);
    if (b) {
      const all = [...b.unassigned, ...b.lanes.flatMap((l) => l.appointments)];
      setAppts(all.filter((a) => a.status !== 'completed' && a.status !== 'cancelled'));
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const startVisit = async () => {
    if (!startApptId) return;
    await run('field-visit-start', { appointmentId: startApptId, technician: startTech });
    setStartApptId('');
    setStartTech('');
    await load();
  };
  const toggleCheck = async (id: string, idx: number, done: boolean) => {
    await run('field-visit-update', { id, checkIndex: idx, done });
    await load();
  };
  const addPart = async (id: string) => {
    const name = (partName[id] || '').trim();
    if (!name) return;
    await run('field-visit-update', {
      id,
      part: {
        name,
        quantity: parseFloat(partQty[id] || '1') || 1,
        unitPrice: parseFloat(partPrice[id] || '0') || 0,
      },
    });
    setPartName((p) => ({ ...p, [id]: '' }));
    setPartQty((p) => ({ ...p, [id]: '' }));
    setPartPrice((p) => ({ ...p, [id]: '' }));
    await load();
  };
  const removePart = async (id: string, partId: string) => {
    await run('field-visit-update', { id, removePartId: partId });
    await load();
  };
  const addPhoto = async (id: string, file: File) => {
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    await run('field-visit-update', {
      id,
      photo: { caption: photoCaption[id] || file.name, dataUrl },
    });
    setPhotoCaption((p) => ({ ...p, [id]: '' }));
    await load();
  };
  const removePhoto = async (id: string, photoId: string) => {
    await run('field-visit-update', { id, removePhotoId: photoId });
    await load();
  };
  const updateNotes = async (id: string, notes: string) => {
    await run('field-visit-update', { id, notes });
    await load();
  };
  const complete = async (id: string) => {
    await run('field-visit-complete', { id });
    await load();
  };

  return (
    <div className="space-y-3">
      <div className={cn(ds.panel, 'space-y-2')}>
        <p className="text-sm font-semibold text-white">Start on-site visit</p>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            className={cn(ds.select, 'flex-1 min-w-[180px]')}
            value={startApptId}
            onChange={(e) => setStartApptId(e.target.value)}
          >
            <option value="">Select appointment…</option>
            {appts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} — {a.client || 'no client'}
              </option>
            ))}
          </select>
          <input
            className={cn(ds.input, 'w-44')}
            placeholder="Technician name"
            value={startTech}
            onChange={(e) => setStartTech(e.target.value)}
          />
          <button onClick={startVisit} className={ds.btnPrimary} disabled={!startApptId}>
            <Smartphone className="w-4 h-4" /> Start
          </button>
        </div>
      </div>
      {loading && !visits.length ? (
        <Spinner />
      ) : visits.length === 0 ? (
        <Empty label="No field visits yet" />
      ) : (
        visits.map((v) => (
          <div key={v.id} className={ds.panel}>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-white font-medium">{v.client || 'Visit'}</p>
                <p className="text-xs text-gray-400">{v.address}{v.technician ? ` · ${v.technician}` : ''}</p>
              </div>
              <span
                className={cn(
                  'text-xs px-2 py-0.5 rounded-full',
                  v.status === 'completed' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-purple-400/20 text-purple-300',
                )}
              >
                {v.status} · {v.checklistProgress}%
              </span>
            </div>
            {/* checklist */}
            <div className="mt-2 grid gap-1">
              {v.checklist.map((c, idx) => (
                <label key={idx} className="flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    checked={c.done}
                    disabled={v.status === 'completed'}
                    onChange={(e) => toggleCheck(v.id, idx, e.target.checked)}
                  />
                  <span className={cn(c.done && 'line-through text-gray-400')}>{c.label}</span>
                </label>
              ))}
            </div>
            {/* parts */}
            <div className="mt-2 border-t border-lattice-border pt-2">
              <p className="text-xs text-gray-400 mb-1">Parts used</p>
              {v.partsUsed.map((p) => (
                <div key={p.id} className="text-xs flex items-center justify-between text-gray-300">
                  <span>{p.name} ×{p.quantity} @ ${p.unitPrice}</span>
                  {v.status !== 'completed' && (
                    <button onClick={() => removePart(v.id, p.id)} className={ds.btnGhost} aria-label="Remove part">
                      <Trash2 className="w-3 h-3 text-red-400" />
                    </button>
                  )}
                </div>
              ))}
              {v.status !== 'completed' && (
                <div className="flex items-center gap-1 mt-1">
                  <input
                    className={cn(ds.input, 'flex-1')}
                    placeholder="Part name"
                    value={partName[v.id] || ''}
                    onChange={(e) => setPartName((p) => ({ ...p, [v.id]: e.target.value }))}
                  />
                  <input
                    type="number"
                    className={cn(ds.input, 'w-16')}
                    placeholder="Qty"
                    value={partQty[v.id] || ''}
                    onChange={(e) => setPartQty((p) => ({ ...p, [v.id]: e.target.value }))}
                  />
                  <input
                    type="number"
                    className={cn(ds.input, 'w-20')}
                    placeholder="$ ea"
                    value={partPrice[v.id] || ''}
                    onChange={(e) => setPartPrice((p) => ({ ...p, [v.id]: e.target.value }))}
                  />
                  <button onClick={() => addPart(v.id)} className={ds.btnSecondary} aria-label="Add part">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
            {/* photos */}
            <div className="mt-2 border-t border-lattice-border pt-2">
              <p className="text-xs text-gray-400 mb-1">Photos ({v.photoCount})</p>
              {v.photos.length > 0 && (
                <div className="flex gap-2 flex-wrap mb-1">
                  {v.photos.map((ph) => (
                    <div key={ph.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ph.dataUrl} alt={ph.caption} className="w-16 h-16 object-cover rounded border border-lattice-border" />
                      {v.status !== 'completed' && (
                        <button
                          onClick={() => removePhoto(v.id, ph.id)}
                          className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5"
                          aria-label="Remove photo"
                        >
                          <Trash2 className="w-2.5 h-2.5 text-white" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {v.status !== 'completed' && (
                <div className="flex items-center gap-1">
                  <input
                    className={cn(ds.input, 'flex-1')}
                    placeholder="Photo caption"
                    value={photoCaption[v.id] || ''}
                    onChange={(e) => setPhotoCaption((p) => ({ ...p, [v.id]: e.target.value }))}
                  />
                  <label className={cn(ds.btnSecondary, 'cursor-pointer')}>
                    <Camera className="w-4 h-4" /> Add
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void addPhoto(v.id, f);
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
            {/* notes */}
            <textarea
              className={cn(ds.textarea, 'mt-2')}
              rows={2}
              placeholder="On-site notes"
              defaultValue={v.notes}
              disabled={v.status === 'completed'}
              onBlur={(e) => {
                if (e.target.value !== v.notes) void updateNotes(v.id, e.target.value);
              }}
            />
            {v.status === 'completed' ? (
              <p className="text-xs text-emerald-300 mt-2">
                Completed · parts total ${(v.partsTotal || 0).toLocaleString()}
              </p>
            ) : (
              <button onClick={() => complete(v.id)} className={cn(ds.btnPrimary, 'mt-2')}>
                <CheckCircle2 className="w-4 h-4" /> Complete visit
              </button>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ── shared bits ───────────────────────────────────────────────────────
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-3 bg-lattice-elevated rounded-lg border border-lattice-border">
      <p className="text-lg font-bold text-white">{value}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  );
}
function Spinner() {
  return (
    <div className="flex items-center justify-center py-10">
      <div className="w-6 h-6 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
function Empty({ label }: { label: string }) {
  return (
    <div className={cn(ds.panel, 'text-center py-10')}>
      <p className={ds.textMuted}>{label}</p>
    </div>
  );
}
