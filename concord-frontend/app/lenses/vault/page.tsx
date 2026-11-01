'use client';

/**
 * TheVault — a curated hall of fame. Open submission, closed admission.
 *
 * Spec: docs/THEVAULT_SPEC.md (locked). No likes, feeds, trending or metrics; a decline is private to
 * the submitter; the vault opens empty. This page lays out, on one paper wall:
 *   · the admitted records (vault.browse), the only public read, as a cabinet of drawers (VaultCabinet), the
 *     honest empty state when there are none, and the public curator roster (vault.curators). No counts,
 *     likes, ranking or feeds: the order is the order the vault returns;
 *   · the signed-in person's own submissions (vault.my_submissions) with withdraw, and the submit form;
 *   · for an active curator only, the review room (components/vault/curator): queue, evidence, statement,
 *     admit, decline. The room is shown when vault.curators lists the signed-in id as active, but that is
 *     cosmetic: every vault.* curator action is refused by the server for anyone else (not_a_curator).
 * After a submit the page reads my_submissions back and only trusts what the vault returns.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { SubmitWorkPanel } from '@/components/vault/SubmitWorkPanel';
import { MySubmissions, type MySubmission } from '@/components/vault/MySubmissions';
import { CuratorQueue } from '@/components/vault/curator';
import { VaultCabinet } from '@/components/vault/VaultCabinet';
import { VaultEmptyState } from '@/components/vault/VaultEmptyState';
import { CuratorRoster } from '@/components/vault/CuratorRoster';
import type { VaultCabinetEntry, VaultCuratorShape, VaultRecordShape } from '@/components/vault/types';


type Phase = 'loading' | 'ready' | 'error';

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function submissionsFrom(rows: unknown): MySubmission[] {
  if (!Array.isArray(rows)) return [];
  const out: MySubmission[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title)?.trim();
    const status = str(r.status);
    if (!id || !title || !status) continue;
    out.push({
      id, title, status,
      workKind: str(r.workKind),
      description: str(r.description),
      body: str(r.body),
      submittedAt: typeof r.submittedAt === 'number' ? r.submittedAt : undefined,
      curatorStatement: str(r.curatorStatement) || undefined,
      declineReason: str(r.declineReason) || undefined,
    });
  }
  return out;
}

/** True when the public curator roster lists `userId` as an active curator. */
function isActiveCurator(rows: VaultCuratorShape[], userId: string | undefined): boolean {
  if (!userId) return false;
  return rows.some((c) => c.curator_id === userId && Number(c.active) === 1);
}

/** Admitted records exactly as `vault.browse` returns them; a field the vault did not send stays absent/empty. */
function recordsFrom(rows: unknown): VaultRecordShape[] {
  if (!Array.isArray(rows)) return [];
  const out: VaultRecordShape[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title)?.trim();
    if (!id || !title) continue;
    out.push({
      id,
      title,
      workKind: str(r.workKind) || '',
      description: str(r.description) || '',
      submitterId: str(r.submitterId) || '',
      admittedAt: typeof r.admittedAt === 'number' ? r.admittedAt : null,
      curatorId: str(r.curatorId) || null,
      curatorRole: str(r.curatorRole) || null,
      curatorStatement: str(r.curatorStatement) || null,
      recordDtuId: str(r.recordDtuId) || null,
      lineage: Array.isArray(r.lineage) ? r.lineage.filter((x): x is string => typeof x === 'string') : [],
      status: 'admitted',
    });
  }
  return out;
}

function rosterFrom(rows: unknown): VaultCuratorShape[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is VaultCuratorShape => !!r && typeof r === 'object' && typeof (r as VaultCuratorShape).curator_id === 'string');
}

export default function VaultPage() {
  useLensNav('vault');
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const signedIn = Boolean(user);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [admitted, setAdmitted] = useState<VaultRecordShape[]>([]);
  const [roster, setRoster] = useState<VaultCuratorShape[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const [curatorFilter, setCuratorFilter] = useState<string | null>(null);
  const [mine, setMine] = useState<MySubmission[]>([]);
  const [curator, setCurator] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const read = useCallback(async () => {
    const browse = await lensRun<{ records?: unknown }>('vault', 'browse', {});
    if (!browse.data?.ok) throw new Error(browse.data?.error || 'Could not read the vault.');
    let own: MySubmission[] = [];
    if (signedIn) {
      const m = await lensRun<{ submissions?: unknown }>('vault', 'my_submissions', {});
      if (!m.data?.ok) throw new Error(m.data?.error || 'Could not read your submissions.');
      own = submissionsFrom(m.data.result?.submissions);
    }
    // The roster is a public read: it names who curates, and decides whether to SHOW the review room (cosmetic;
    // the server refuses every curator action for anyone else). A failed roster read shows nothing and never
    // blocks the page.
    let curators: VaultCuratorShape[] = [];
    try {
      const rosterRes = await lensRun<{ curators?: unknown }>('vault', 'curators', {});
      if (rosterRes.data?.ok) curators = rosterFrom(rosterRes.data.result?.curators);
    } catch { curators = []; }
    const curator = signedIn && isActiveCurator(curators, userId);
    return { admitted: recordsFrom(browse.data.result?.records), own, curator, curators };
  }, [signedIn, userId]);

  const apply = useCallback((r: Awaited<ReturnType<typeof read>>) => {
    setAdmitted(r.admitted);
    setMine(r.own);
    setRoster(r.curators);
    setCurator(r.curator);
  }, []);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    read().then((r) => {
      apply(r);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
  }, [read, apply]);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    read().then((r) => {
      if (cancelled) return;
      apply(r);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
    return () => { cancelled = true; };
  }, [authLoading, read, apply]);

  const onSubmitted = useCallback(async (id: string) => {
    setNotice('');
    try {
      const r = await read();
      apply(r);
      if (!r.own.some((s) => s.id === id)) setNotice('Submitted, but the vault did not read it back. Reload to check.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Submitted, but the vault could not be read.');
    }
  }, [read, apply]);

  /** Re-read the page after a curator acts (an admission changes the public list). */
  const refresh = useCallback(() => {
    read().then(apply).catch(() => { /* the room keeps its own state; the next load reconciles */ });
  }, [read, apply]);

  const onWithdraw = useCallback(async (id: string, reason: string): Promise<string | null> => {
    const res = await lensRun<{ ok?: boolean }>('vault', 'withdraw', { submissionId: id, ...(reason ? { reason } : {}) });
    if (!res.data?.ok) return res.data?.error || 'withdraw_failed';
    try {
      apply(await read());
    } catch { /* the withdrawal itself was confirmed; the list refreshes on the next load */ }
    return null;
  }, [read, apply]);

  const shown = useMemo(
    () => (curatorFilter ? admitted.filter((r) => r.curatorId === curatorFilter) : admitted),
    [admitted, curatorFilter],
  );
  const entries: VaultCabinetEntry[] = useMemo(
    () => shown.map((record) => ({ id: record.id, record, state: 'ready' as const, error: null })),
    [shown],
  );
  const filterLabel = useMemo(() => {
    if (!curatorFilter) return null;
    return roster.find((c) => c.curator_id === curatorFilter)?.display_name || 'this curator';
  }, [curatorFilter, roster]);

  // Cabinet keyboard: up/down move between drawers, Enter opens or closes one, Escape closes. Ignored while a
  // form field has focus, so it never competes with the submit form or the review room.
  useEffect(() => {
    if (phase !== 'ready' || entries.length === 0) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(entries.length - 1, c + 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === 'Enter' && cursor >= 0 && cursor < entries.length) {
        const id = entries[cursor].id;
        setOpenId((o) => (o === id ? null : id));
      } else if (e.key === 'Escape') setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, entries, cursor]);

  useLensCommand(
    [{ id: 'vault-submit', keys: 'o', description: 'Submit a work', category: 'actions', action: () => { if (signedIn) setFormOpen(true); } }],
    { lensId: 'vault' },
  );

  return (
    <LensShell lensId="vault" asMain={false}>
      <div data-lens-theme="vault" className={cn(vault.wall, 'min-h-full px-6 pb-24 pt-8 sm:px-10')}>
        <h1 className={vault.title}>TheVault</h1>

        {phase === 'loading' && (
          <p data-testid="vault-loading" role="status" aria-busy="true" className={cn(vault.caption, 'mt-6')}>Opening the vault.</p>
        )}
        {phase === 'error' && (
          <div data-testid="vault-error" role="alert" className="mt-6">
            <p className={vault.body}>{loadError || 'Could not load the vault.'}</p>
            <button type="button" onClick={load} className={cn(vault.button, 'mt-3')}>Retry</button>
          </div>
        )}

        {phase === 'ready' && (
          <>
            <section aria-label="The hall" className="mt-8" data-testid="vault-hall">
              <CuratorRoster curators={roster} />
              <div className="mt-8">
                {admitted.length === 0 ? (
                  <VaultEmptyState />
                ) : entries.length === 0 ? (
                  <VaultEmptyState kind="filtered" filterLabel={filterLabel} onClearFilter={() => setCuratorFilter(null)} />
                ) : (
                  <VaultCabinet
                    entries={entries}
                    openId={openId}
                    selectedIndex={cursor}
                    onToggle={(id) => {
                      setOpenId((o) => (o === id ? null : id));
                      setCursor(entries.findIndex((e) => e.id === id));
                    }}
                    onSelectCurator={(id) => { setCuratorFilter((f) => (f === id ? null : id)); setCursor(-1); setOpenId(null); }}
                    curatorFilter={curatorFilter}
                    shortcuts={[
                      { keys: '↑ ↓', label: 'Move between drawers' },
                      { keys: 'Enter', label: 'Open or close a drawer' },
                      { keys: 'Esc', label: 'Close' },
                    ]}
                  />
                )}
              </div>
            </section>

            {signedIn ? (
              <>
                <SubmitWorkPanel open={formOpen} onOpenChange={setFormOpen} onSubmitted={onSubmitted} />
                {notice ? <p role="alert" className="mt-3 text-sm text-red-700">{notice}</p> : null}
                <MySubmissions submissions={mine} onWithdraw={onWithdraw} />
              </>
            ) : (
              <p data-testid="vault-signin" className={cn(vault.caption, 'mt-8')}>Sign in to submit a work.</p>
            )}

            {signedIn && curator ? (
              <section aria-label="Curator review room" data-testid="vault-curator-room" className="mt-12">
                <CuratorQueue onChange={refresh} />
              </section>
            ) : null}
          </>
        )}
      </div>
    </LensShell>
  );
}

