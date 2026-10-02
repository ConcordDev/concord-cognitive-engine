'use client';

/**
 * Healthcare north star — the open record, or an honest empty.
 * No invented patient. Pharmacy is the only sibling on the pill.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { FamilyPill, NorthError, NorthNote, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { lensRun } from '@/lib/api/client';
import { useAuth } from '@/hooks/useAuth';
import { useLensNav } from '@/hooks/useLensNav';
import { titleCaseDisplayName } from '@/components/chat/claudeCleanGreeting';

type Patient = {
  id: string;
  mrn?: string;
  firstName?: string;
  lastName?: string;
  dob?: string;
};

const PILL = [
  { id: 'healthcare', label: 'Healthcare', href: '/lenses/healthcare' },
  { id: 'pharmacy', label: 'Pharmacy', href: '/lenses/pharmacy' },
];

function labelOf(p: Patient): string {
  return [p.firstName, p.lastName].filter(Boolean).join(' ') || p.mrn || 'Unnamed record';
}

export function OpenChart({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('healthcare');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const patientsQ = useMacro<{ patients?: Patient[] }>(
    ['healthcare-northstar', 'patients'],
    'healthcare',
    'patients-list',
    {},
    (result) => {
      if (!Array.isArray(result.patients)) throw new Error('The chart list did not answer.');
      return result;
    },
  );
  const patients = patientsQ.data?.patients ?? null;
  const [open, setOpen] = useState<Patient | null>(null);
  const [composing, setComposing] = useState(false);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [error, setError] = useState('');

  const choose = async (id: string) => {
    setError('');
    const res = await lensRun<{ patient?: Patient }>('healthcare', 'patients-detail', { id });
    const patient = res.data.result?.patient;
    if (!res.data.ok || !patient) {
      setError(res.data.error || 'That chart did not open.');
      return;
    }
    setOpen(patient);
    setComposing(false);
  };

  const create = async () => {
    if (!first.trim() || !last.trim()) {
      setError('A chart needs a first and last name.');
      return;
    }
    setError('');
    const res = await lensRun<{ patient?: Patient }>('healthcare', 'patients-create', { firstName: first.trim(), lastName: last.trim() });
    const patient = res.data.result?.patient;
    if (!res.data.ok || !patient) {
      setError(res.data.error || 'The chart was not opened.');
      return;
    }
    setOpen(patient);
    setComposing(false);
    setFirst('');
    setLast('');
    await client.invalidateQueries({ queryKey: ['healthcare-northstar', 'patients'] });
  };

  return (
    <LensShell lensId="healthcare" asMain={false} disableAgentFab>
      <div data-lens-theme="healthcare" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Healthcare" title={who ? `Who is in front of you, ${who}` : 'Who is in front of you'} />
            <FamilyPill label="Healthcare" active="healthcare" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Clinical desk' }]} onPick={onOpenDesk} />
        </div>

        {!open && <NorthNote>No chart open</NorthNote>}
        {(error || patientsQ.error) && (
          <NorthError message={error || (patientsQ.error instanceof Error ? patientsQ.error.message : 'The chart list did not answer.')} />
        )}

        {open && (
          <article className="mt-8 max-w-xl rounded-xl border border-white/10 px-4 py-4">
            <h2 className="font-vault text-[1.75rem] text-zinc-100">{labelOf(open)}</h2>
            {open.mrn && <p className="mt-1 text-[13px] text-zinc-500">{open.mrn}</p>}
            {open.dob && <p className="mt-1 text-[13px] text-zinc-500">{open.dob}</p>}
          </article>
        )}

        {composing && (
          <div className="mt-6 max-w-xl space-y-3">
            {patients && patients.length > 0 && (
              <ul className="space-y-1">
                {patients.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => void choose(p.id)} className="text-[14px] text-zinc-300 hover:text-zinc-50">
                      {labelOf(p)}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
              <input aria-label="First name" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
              <input aria-label="Last name" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
              <button type="submit" className="rounded-full bg-white/10 px-4 py-2 text-[14px]">Create chart</button>
            </form>
          </div>
        )}

        <p className="mt-10 max-w-md text-[12px] text-zinc-500">
          This tool is for organizational purposes only. Not a substitute for professional medical advice, diagnosis, or treatment.
        </p>

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>Open a chart</button>
      </div>
    </LensShell>
  );
}
