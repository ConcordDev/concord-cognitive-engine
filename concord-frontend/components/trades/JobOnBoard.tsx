'use client';

/**
 * Trades north star — one job from today's dispatch board.
 * Estimate hours render only when the job stored them.
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

type Job = {
  id: string;
  description?: string;
  customerName?: string;
  customerId?: string;
  status?: string;
  estimatedHours?: number;
  priority?: string;
};
type Customer = { id: string; name?: string; address?: string };
type Board = { unassigned?: Job[]; rows?: { jobs?: Job[] }[] };

const PILL = [
  { id: 'trades', label: 'Trades', href: '/lenses/trades' },
  { id: 'carpentry', label: 'Carpentry', href: '/lenses/carpentry' },
];

function firstJob(board: Board | null): Job | null {
  if (!board) return null;
  if (board.unassigned && board.unassigned.length > 0) return board.unassigned[0];
  for (const row of board.rows || []) {
    if (row.jobs && row.jobs.length > 0) return row.jobs[0];
  }
  return null;
}

export function JobOnBoard({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('trades');
  const { user } = useAuth();
  const who = titleCaseDisplayName(user?.username);
  const client = useQueryClient();
  const boardQ = useMacro<Board>(
    ['trades-northstar', 'board'],
    'trades',
    'dispatch-board',
    {},
    (result) => result,
  );
  const customersQ = useMacro<{ customers?: Customer[] }>(
    ['trades-northstar', 'customers'],
    'trades',
    'customer-list',
    {},
    (result) => result,
  );
  const job = firstJob(boardQ.data ?? null);
  const customers = Array.isArray(customersQ.data?.customers) ? customersQ.data.customers : [];
  const match = job ? customers.find((c) => c.id === job.customerId) : null;
  const place = match?.address || job?.customerName || '';
  const [composing, setComposing] = useState(false);
  const [customer, setCustomer] = useState('');
  const [address, setAddress] = useState('');
  const [description, setDescription] = useState('');
  const [hours, setHours] = useState('');
  const [error, setError] = useState('');

  const create = async () => {
    if (!customer.trim() || !description.trim()) {
      setError('A job needs a customer and a description.');
      return;
    }
    setError('');
    const cust = await lensRun<{ customer?: Customer }>('trades', 'customer-upsert', {
      name: customer.trim(),
      address: address.trim(),
    });
    const customerId = cust.data.result?.customer?.id;
    if (!cust.data.ok || !customerId) {
      setError(cust.data.error || 'The customer was not saved.');
      return;
    }
    const estimatedHours = Number(hours);
    const jobRes = await lensRun('trades', 'job-create', {
      customerId,
      description: description.trim(),
      scheduledFor: new Date().toISOString().slice(0, 10),
      ...(Number.isFinite(estimatedHours) && estimatedHours > 0 ? { estimatedHours } : {}),
    });
    if (!jobRes.data.ok) {
      setError(jobRes.data.error || 'The job was not added to the board.');
      return;
    }
    setCustomer('');
    setAddress('');
    setDescription('');
    setHours('');
    setComposing(false);
    await client.invalidateQueries({ queryKey: ['trades-northstar'] });
  };

  const hoursLabel = job && Number(job.estimatedHours) > 0 ? `${job.estimatedHours} h` : '';

  return (
    <LensShell lensId="trades" asMain={false} disableAgentFab>
      <div data-lens-theme="trades" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <NorthGreeting kicker="Trades" title={who ? `The job on the board, ${who}` : 'The job on the board'} />
            <FamilyPill label="Trades" active="trades" items={PILL} />
          </div>
          <QuietMore items={[{ id: 'desk', label: 'Dispatch desk' }]} onPick={onOpenDesk} />
        </div>

        {boardQ.isSuccess && !job && <NorthNote>Nothing on today's board.</NorthNote>}
        {(error || boardQ.error) && (
          <NorthError message={error || (boardQ.error instanceof Error ? boardQ.error.message : 'Dispatch did not answer.')} />
        )}

        {job && (
          <article className="mt-8 max-w-xl rounded-xl border border-white/10 px-4 py-4">
            <p className="text-[12px] uppercase tracking-wide text-zinc-500">{job.priority || job.status || 'Job'}</p>
            <h2 className="mt-1 text-[18px] text-zinc-100">{job.description}</h2>
            {place && <p className="mt-2 text-[14px] text-zinc-400">{place}</p>}
            {hoursLabel && <p className="mt-2 text-[14px] tabular-nums text-zinc-300">{hoursLabel}</p>}
          </article>
        )}

        {composing && (
          <form className="mt-6 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <input aria-label="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Customer" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Place" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Place" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What needs doing" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <input aria-label="Estimate hours" value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" placeholder="Estimate hours" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" className="rounded-full bg-white/10 px-4 py-2 text-[14px]">Add to the board</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>+ New job</button>
      </div>
    </LensShell>
  );
}
