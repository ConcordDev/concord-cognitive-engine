'use client';

/**
 * TheVault — a curated hall of fame. Open submission, closed admission.
 *
 * Spec: docs/THEVAULT_SPEC.md (locked). No likes, feeds, trending or metrics; a decline is private to
 * the submitter; the vault opens empty. This page lays out, on one paper wall:
 *   · the admitted records (vault.browse), the only public read;
 *   · the signed-in person's own submissions (vault.my_submissions) with withdraw, and the submit form.
 * Admission is a curator's act and is not on this surface (see components/vault/curator).
 * After a submit the page reads my_submissions back and only trusts what the vault returns.
 */

import { useCallback, useEffect, useState } from 'react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensCommand } from '@/hooks/useLensCommand';
import { useLensNav } from '@/hooks/useLensNav';
import { useAuth } from '@/hooks/useAuth';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { vault } from '@/lib/vault/tokens';
import { SubmitWorkPanel } from '@/components/vault/SubmitWorkPanel';
import { MySubmissions, type MySubmission } from '@/components/vault/MySubmissions';

interface AdmittedRow { id: string; title: string; workKind?: string }

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

function admittedFrom(rows: unknown): AdmittedRow[] {
  if (!Array.isArray(rows)) return [];
  const out: AdmittedRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title)?.trim();
    if (id && title) out.push({ id, title, workKind: str(r.workKind) });
  }
  return out;
}

export default function VaultPage() {
  useLensNav('vault');
  const { user, isLoading: authLoading } = useAuth();
  const signedIn = Boolean(user);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [admitted, setAdmitted] = useState<AdmittedRow[]>([]);
  const [mine, setMine] = useState<MySubmission[]>([]);
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
    return { admitted: admittedFrom(browse.data.result?.records), own };
  }, [signedIn]);

  const load = useCallback(() => {
    setPhase('loading');
    setLoadError('');
    read().then((r) => {
      setAdmitted(r.admitted);
      setMine(r.own);
      setPhase('ready');
    }).catch((err) => {
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
  }, [read]);

  useEffect(() => {
    if (authLoading) return undefined;
    let cancelled = false;
    read().then((r) => {
      if (cancelled) return;
      setAdmitted(r.admitted);
      setMine(r.own);
      setPhase('ready');
    }).catch((err) => {
      if (cancelled) return;
      setPhase('error');
      setLoadError(err instanceof Error ? err.message : 'Could not load the vault.');
    });
    return () => { cancelled = true; };
  }, [authLoading, read]);

  const onSubmitted = useCallback(async (id: string) => {
    setNotice('');
    try {
      const r = await read();
      setAdmitted(r.admitted);
      setMine(r.own);
      if (!r.own.some((s) => s.id === id)) setNotice('Submitted, but the vault did not read it back. Reload to check.');
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Submitted, but the vault could not be read.');
    }
  }, [read]);

  const onWithdraw = useCallback(async (id: string, reason: string): Promise<string | null> => {
    const res = await lensRun<{ ok?: boolean }>('vault', 'withdraw', { submissionId: id, ...(reason ? { reason } : {}) });
    if (!res.data?.ok) return res.data?.error || 'withdraw_failed';
    try {
      const r = await read();
      setAdmitted(r.admitted);
      setMine(r.own);
    } catch { /* the withdrawal itself was confirmed; the list refreshes on the next load */ }
    return null;
  }, [read]);

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
            <section aria-label="Admitted records" className="mt-8">
              {admitted.length === 0 ? (
                <p data-testid="vault-empty" className={vault.bodySm}>Nothing has been admitted yet.</p>
              ) : (
                <ul data-testid="vault-admitted" className="m-0 list-none space-y-2 p-0">
                  {admitted.map((r) => (
                    <li key={r.id} className="font-vault text-[1.1rem] text-vault-ink">{r.title}</li>
                  ))}
                </ul>
              )}
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
          </>
        )}
      </div>
    </LensShell>
  );
}

