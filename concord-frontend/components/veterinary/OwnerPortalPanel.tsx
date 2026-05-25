'use client';

import { useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { UserCircle, Search, Loader2, Heart, Calendar, Receipt, Pill } from 'lucide-react';
import {
  VetPatient,
  VetAppointment,
  VetInvoice,
  VetPrescription,
  SPECIES_EMOJI,
} from './vet-types';

interface OwnerPortalData {
  owner: string;
  pets: VetPatient[];
  appointments: VetAppointment[];
  invoices: VetInvoice[];
  prescriptions: VetPrescription[];
  petCount: number;
  balanceDue: number;
}

export function OwnerPortalPanel() {
  const [ownerName, setOwnerName] = useState('');
  const [data, setData] = useState<OwnerPortalData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    if (!ownerName.trim()) return;
    setLoading(true);
    setError(null);
    const r = await lensRun('veterinary', 'owner-portal', { owner: ownerName });
    if (r.data.ok && r.data.result) {
      setData(r.data.result as OwnerPortalData);
    } else {
      setData(null);
      setError(r.data.error || 'owner lookup failed');
    }
    setLoading(false);
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup();
        }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <input
            value={ownerName}
            onChange={(e) => setOwnerName(e.target.value)}
            placeholder="Owner name — view their pets, visits, bills & meds"
            className="w-full rounded border border-zinc-800 bg-zinc-900 py-2 pl-9 pr-3 text-sm text-white"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !ownerName.trim()}
          className="flex items-center gap-2 rounded bg-pink-600 px-3 py-2 text-sm font-medium text-white hover:bg-pink-500 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCircle className="h-4 w-4" />}
          Open portal
        </button>
      </form>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {data && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
            <div className="flex items-center gap-3">
              <UserCircle className="h-8 w-8 text-pink-400" />
              <div>
                <p className="text-sm font-semibold text-white">{data.owner}</p>
                <p className="text-xs text-zinc-400">{data.petCount} pet(s) on file</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wide text-zinc-400">Balance due</p>
              <p
                className={`font-mono text-lg ${data.balanceDue > 0 ? 'text-red-300' : 'text-green-300'}`}
              >
                ${data.balanceDue.toFixed(2)}
              </p>
            </div>
          </div>

          <Section icon={<Heart className="h-4 w-4 text-pink-400" />} title={`Pets (${data.pets.length})`}>
            {data.pets.length === 0 ? (
              <Empty>No pets found for this owner.</Empty>
            ) : (
              data.pets.map((p) => (
                <div key={p.id} className="rounded bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300">
                  <span className="mr-1">{SPECIES_EMOJI[p.species] || '🐾'}</span>
                  <span className="font-semibold text-white">{p.name}</span> · {p.breed} ·{' '}
                  {p.ageYears}yr · {p.weightLbs}lb · {p.visits.length} visit(s)
                </div>
              ))
            )}
          </Section>

          <Section
            icon={<Calendar className="h-4 w-4 text-blue-400" />}
            title={`Appointments (${data.appointments.length})`}
          >
            {data.appointments.length === 0 ? (
              <Empty>No appointments.</Empty>
            ) : (
              data.appointments.map((a) => (
                <div key={a.id} className="rounded bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300">
                  <span className="font-semibold text-white">{a.patientName}</span> · {a.type} ·{' '}
                  {a.date} {a.time} —{' '}
                  <span className="text-blue-400">{a.status}</span>
                </div>
              ))
            )}
          </Section>

          <Section
            icon={<Receipt className="h-4 w-4 text-emerald-400" />}
            title={`Invoices (${data.invoices.length})`}
          >
            {data.invoices.length === 0 ? (
              <Empty>No invoices.</Empty>
            ) : (
              data.invoices.map((iv) => (
                <div
                  key={iv.id}
                  className="flex justify-between rounded bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300"
                >
                  <span>
                    <span className="font-semibold text-white">{iv.patientName}</span> —{' '}
                    <span
                      className={
                        iv.status === 'paid'
                          ? 'text-green-400'
                          : iv.status === 'partial'
                            ? 'text-yellow-400'
                            : 'text-red-400'
                      }
                    >
                      {iv.status}
                    </span>
                  </span>
                  <span className="font-mono">
                    ${iv.balanceDue.toFixed(2)} / ${iv.total.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </Section>

          <Section
            icon={<Pill className="h-4 w-4 text-violet-400" />}
            title={`Prescriptions (${data.prescriptions.length})`}
          >
            {data.prescriptions.length === 0 ? (
              <Empty>No prescriptions.</Empty>
            ) : (
              data.prescriptions.map((rx) => (
                <div key={rx.id} className="rounded bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-300">
                  <span className="font-semibold text-white">{rx.drug}</span>
                  {rx.dosage && ` · ${rx.dosage}`} · refills {rx.refillsRemaining}/{rx.refillsTotal}{' '}
                  — <span className="text-violet-400">{rx.status}</span>
                </div>
              ))
            )}
          </Section>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
          <UserCircle className="mx-auto mb-2 h-8 w-8 opacity-30" />
          Search an owner to open their portal view.
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        {icon} {title}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-zinc-400">{children}</p>;
}
