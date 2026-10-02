'use client';

/** Daily north star — today's page. The count is this week's entries. */

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LensShell } from '@/components/lens/LensShell';
import { NorthGreeting, QuietMore, northCtaClass } from '@/components/code/CodeFamilyChrome';
import { NorthError, northPage, useMacro } from '@/components/lens/NorthStarChrome';
import { ChatFamilyPill } from '@/components/chat/ChatFamilyPill';
import { lensRun } from '@/lib/api/client';
import { useLensNav } from '@/hooks/useLensNav';

type Entry = { id: string; journalId?: string; title?: string; body?: string; date: string; createdAt?: string };
type Journal = { id: string; name?: string };

function localDate(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday–Sunday of the local week, as YYYY-MM-DD. */
export function localWeekBounds(now = new Date()): { start: string; end: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const mondayOffset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - mondayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: localDate(start), end: localDate(end) };
}

function digestHeader(markdown: string): string {
  const line = markdown.split('\n').find((row) => row.startsWith('Exported '));
  return line || '';
}

export function TodayPage({ onOpenDesk }: { onOpenDesk: () => void }) {
  useLensNav('daily');
  const client = useQueryClient();
  const today = localDate();
  const heading = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const week = localWeekBounds();

  const journalsQ = useMacro<{ journals?: Journal[] }>(
    ['daily-northstar', 'journals'],
    'daily',
    'journal-list',
    {},
    (result) => {
      if (!Array.isArray(result.journals)) throw new Error('The journal did not answer.');
      return result;
    },
  );
  const entriesQ = useMacro<{ entries?: Entry[] }>(
    ['daily-northstar', 'entries'],
    'daily',
    'entry-list',
    {},
    (result) => {
      if (!Array.isArray(result.entries)) throw new Error('The entries did not answer.');
      return result;
    },
  );

  const journal = journalsQ.data?.journals?.[0] ?? null;
  const weekEntries = useMemo(() => {
    const entries = entriesQ.data?.entries ?? [];
    return entries.filter((e) => e.date >= week.start && e.date <= week.end);
  }, [entriesQ.data, week.start, week.end]);
  const pageEntry = useMemo(() => {
    const todays = weekEntries.filter((e) => e.date === today);
    const pool = todays.length > 0 ? todays : weekEntries;
    return pool.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0] ?? null;
  }, [weekEntries, today]);
  const hasText = Boolean(pageEntry?.body?.trim());

  const archiveQ = useMacro<{ markdown?: string }>(
    ['daily-northstar', 'archive', journal?.id || ''],
    'daily',
    'export-archive',
    journal?.id ? { journalId: journal.id } : {},
    (result) => result,
    hasText && Boolean(journal?.id),
  );
  const digest = hasText && archiveQ.data?.markdown ? digestHeader(archiveQ.data.markdown) : '';

  const [composing, setComposing] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const write = async () => {
    const text = body.trim();
    if (!text) {
      setError('The day needs words.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await lensRun('daily', 'entry-create', {
        body: text,
        date: today,
        ...(journal?.id ? { journalId: journal.id } : {}),
      });
      if (!res.data.ok) {
        setError(res.data.error || 'The entry was not saved.');
        return;
      }
      setBody('');
      setComposing(false);
      await client.invalidateQueries({ queryKey: ['daily-northstar'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The entry was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const loadError = [journalsQ.error, entriesQ.error].find((e) => e instanceof Error) as Error | undefined;
  const ready = Boolean(journalsQ.data && entriesQ.data);
  const countLine = ready
    ? `${journal?.name ? `${journal.name} · ` : ''}${weekEntries.length} ${weekEntries.length === 1 ? 'entry' : 'entries'} this week`
    : '';

  return (
    <LensShell lensId="daily" asMain={false} disableAgentFab>
      <div data-lens-theme="daily" className={northPage}>
        <div className="flex items-start justify-between gap-4">
          <NorthGreeting kicker="Daily" title={heading} />
          <QuietMore
            items={[
              { id: 'studio', label: 'Studio' },
              { id: 'inspiration', label: 'Inspiration' },
            ]}
            onPick={onOpenDesk}
          />
        </div>
        <ChatFamilyPill active="daily" />

        {(loadError || error) && <NorthError message={error || loadError?.message || ''} />}

        {ready && (
          <div className="mt-6 max-w-xl rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4" data-testid="daily-page">
            <p className="text-[14px] text-zinc-300">{countLine}</p>
            {hasText ? (
              <p className="mt-3 whitespace-pre-wrap text-[15px] text-zinc-100">{pageEntry?.body}</p>
            ) : (
              <p className="mt-3 text-[14px] text-zinc-500">Write the day. A digest appears when there is something to summarize.</p>
            )}
            {digest && <p className="mt-3 text-[13px] text-zinc-500" data-testid="daily-digest">{digest}</p>}
          </div>
        )}

        {composing && (
          <form className="mt-4 max-w-xl space-y-2" onSubmit={(e) => { e.preventDefault(); void write(); }}>
            <textarea aria-label="Entry" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the day" className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-[14px]" />
            <button type="submit" disabled={busy} className="rounded-full bg-white/10 px-4 py-2 text-[14px] disabled:opacity-50">Save</button>
          </form>
        )}

        <button type="button" className={northCtaClass} onClick={() => setComposing(true)}>Write</button>
      </div>
    </LensShell>
  );
}
