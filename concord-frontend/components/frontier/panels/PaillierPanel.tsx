'use client';

/**
 * PaillierPanel — Wave W3-B, `crypto.paillierKeygen` + `paillierContribute`
 * + `paillierAggregate` + `paillierSessionStatus` + `paillierMultiplyCiphertexts`.
 * Source: server/lib/crypto/paillier.js, server/lib/crypto/encrypted-aggregate.js,
 * server/domains/crypto.js.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): HELIOS VOTING's ballot box. Helios is the
 * real, published open-audit e-voting system built on exactly this
 * primitive — homomorphic tallying of encrypted ballots, where the tally
 * is the ONLY thing ever decrypted. This panel borrows Helios's
 * interaction shape directly: a session is a "ballot box" opened by one
 * key holder; each contribution is "cast" into it as a sealed, opaque
 * entry (its ciphertext shown only as a truncated, monospace blob — never
 * a value); nothing is legible until the box owner explicitly "opens" the
 * box, which reveals only the combined total, never an individual ballot.
 *
 * Two honesty points enforced throughout (see server/lib/crypto/paillier.js
 * header):
 *   (a) Paillier here is ADDITIVELY homomorphic ONLY. There is no ciphertext
 *       x ciphertext multiplication — that requires Fully Homomorphic
 *       Encryption, which this module does not implement. The panel proves
 *       this by actually calling paillierMultiplyCiphertexts and rendering
 *       its real, structured refusal — never implying arbitrary-depth FHE.
 *   (b) A contributed plaintext value is NEVER redisplayed once cast. Only
 *       the returned ciphertext (opaque, truncated) and a running
 *       contributor count are kept in state — the same discipline the real
 *       backend session applies (it stores ciphertexts only, never plaintexts).
 *
 * Uses `runFrontierMacro` (FrontierEngineShell.tsx), not the generic
 * `lensRun`, for the same reason as its sibling panels: every
 * `crypto.paillier*` refusal (`session_not_found`, `forbidden`,
 * `sensitivity_required`, `too_many_sessions`, and the always-on
 * `paillierMultiplyCiphertexts` refusal itself) is a `{ok:false, error,
 * reason?}` object whose `reason`/`message` prose `lensRun`'s generic
 * unwrap drops on the floor, keeping only the short `error` code.
 * `runFrontierMacro` preserves the full refusal object so `refusalText`
 * below can render the real human-readable explanation.
 */

import { useState } from 'react';
import { Lock, Unlock, AlertCircle, ShieldOff } from 'lucide-react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, runFrontierMacro, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

/** Combines a refusal's short `error` code with its `reason`/`message` prose (when present). */
function refusalText(error: string | null, refusal: Record<string, unknown> | null): string | null {
  if (!error) return null;
  if (!refusal) return error;
  const extra = typeof refusal.reason === 'string' ? refusal.reason
    : typeof refusal.message === 'string' ? refusal.message
    : null;
  if (extra && extra !== error) return `${error} — ${extra}`;
  if (typeof refusal.limit === 'number') return `${error} (limit ${refusal.limit})`;
  return error;
}

type Bits = 512 | 1024 | 2048;
type Mode = 'sum' | 'mean';

interface KeygenResult {
  sessionId: string;
  publicKey: { n: string; g: string; bits: number | null };
  bits: number;
  ownerId: string;
  note: string;
}

interface ContributeResult {
  sessionId: string;
  contributionId: string;
  contributorCount: number;
  ciphertext: string;
}

interface DifferentialPrivacyResult {
  applied: boolean;
  reason?: string;
  mechanism?: string;
  epsilon?: number;
  sensitivity?: number;
  noisyValue?: number | null;
  noise?: number | null;
  confidenceInterval95?: [number, number] | null;
}

interface AggregateResult {
  sessionId: string;
  mode: Mode;
  contributorCount: number;
  rawValue: number;
  differentialPrivacy: DifferentialPrivacyResult | null;
  note: string;
}

interface SealedContribution {
  contributionId: string;
  ciphertextPreview: string;
  castAt: number;
}

function truncateCiphertext(c: string): string {
  if (c.length <= 40) return c;
  return `${c.slice(0, 24)}…${c.slice(-8)}`;
}

export function PaillierPanel({ engine }: { engine: FrontierEngineDef }) {
  // Session (ballot box) state.
  const [bits, setBits] = useState<Bits>(512);
  const [label, setLabel] = useState('');
  const [session, setSession] = useState<KeygenResult | null>(null);
  const [keygenLoading, setKeygenLoading] = useState(false);
  const [keygenError, setKeygenError] = useState<string | null>(null);

  // Casting (contribute) state — the raw value is local-only and is
  // cleared immediately after a successful cast; it is never re-derived
  // from, or displayed alongside, the sealed entries list below.
  const [castValue, setCastValue] = useState('');
  const [castLoading, setCastLoading] = useState(false);
  const [castError, setCastError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<SealedContribution[]>([]);

  // Aggregate (open the box) config + result — this is the shell's
  // primary Compute/Verify pair.
  const [mode, setMode] = useState<Mode>('sum');
  const [dpEnabled, setDpEnabled] = useState(false);
  const [epsilon, setEpsilon] = useState('1');
  const [sensitivity, setSensitivity] = useState('1');
  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<AggregateResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  // The explicit "why can't I multiply two ballots" refusal demo.
  const [multiplyStatus, setMultiplyStatus] = useState<'idle' | 'loading' | 'refused' | 'error'>('idle');
  const [multiplyReason, setMultiplyReason] = useState<string | null>(null);

  async function openBallotBox() {
    setKeygenLoading(true);
    setKeygenError(null);
    try {
      const input: Record<string, unknown> = { bits };
      if (label.trim()) input.label = label.trim();
      const res = await runFrontierMacro<KeygenResult>('crypto', 'paillierKeygen', input);
      if (res.ok && res.result) {
        setSession(res.result);
        setSealed([]);
        setAggregate(null);
        setStatus('idle');
        setRunCount(0);
      } else {
        setKeygenError(refusalText(res.error, res.refusal) || 'Could not open a ballot box.');
      }
    } catch (e) {
      setKeygenError(e instanceof Error ? e.message : String(e));
    } finally {
      setKeygenLoading(false);
    }
  }

  async function castBallot() {
    if (!session) return;
    const trimmed = castValue.trim();
    if (trimmed === '' || !Number.isInteger(Number(trimmed))) {
      setCastError('Enter a whole number — Paillier\'s plaintext space is integers only.');
      return;
    }
    setCastLoading(true);
    setCastError(null);
    try {
      const res = await runFrontierMacro<ContributeResult>('crypto', 'paillierContribute', {
        sessionId: session.sessionId,
        value: Number(trimmed),
      });
      if (res.ok && res.result) {
        setSealed((prev) => [
          ...prev,
          {
            contributionId: res.result!.contributionId,
            ciphertextPreview: truncateCiphertext(res.result!.ciphertext),
            castAt: Date.now(),
          },
        ]);
        // The plaintext is deliberately discarded here — never stored.
        setCastValue('');
      } else {
        setCastError(refusalText(res.error, res.refusal) || 'Cast failed.');
      }
    } catch (e) {
      setCastError(e instanceof Error ? e.message : String(e));
    } finally {
      setCastLoading(false);
    }
  }

  async function openTheBox() {
    if (!session) return;
    setStatus('loading');
    setReason(null);
    setAggregate(null);
    try {
      const input: Record<string, unknown> = { sessionId: session.sessionId, mode };
      if (dpEnabled) {
        input.epsilon = Number(epsilon);
        input.sensitivity = Number(sensitivity);
      }
      const res = await runFrontierMacro<AggregateResult>('crypto', 'paillierAggregate', input);
      setRunCount((n) => n + 1);
      if (res.ok && res.result) {
        setAggregate(res.result);
        setStatus('ok');
      } else {
        setReason(refusalText(res.error, res.refusal) || 'Unknown refusal.');
        setStatus('refused');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  async function tryMultiplyBallots() {
    setMultiplyStatus('loading');
    setMultiplyReason(null);
    try {
      const res = await runFrontierMacro<unknown>('crypto', 'paillierMultiplyCiphertexts', {});
      // This macro always refuses by construction — treat anything other
      // than a real, named refusal as unexpected.
      if (!res.ok) {
        setMultiplyReason(refusalText(res.error, res.refusal) || 'fhe_required');
        setMultiplyStatus('refused');
      } else {
        setMultiplyReason('Unexpected: the backend returned ok:true for a ciphertext x ciphertext request.');
        setMultiplyStatus('error');
      }
    } catch (e) {
      setMultiplyReason(e instanceof Error ? e.message : String(e));
      setMultiplyStatus('error');
    }
  }

  useLensCommand(
    [{
      id: 'paillier-open-box',
      keys: 'mod+enter',
      description: 'Reveal the Paillier aggregate',
      category: 'actions',
      action: openTheBox,
      enabled: !!session && sealed.length > 0,
    }],
    { lensId: 'frontier' },
  );

  const canOpen = !!session && sealed.length > 0;

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel="crypto.paillierKeygen · paillierContribute · paillierAggregate"
        running={status === 'loading'}
        onRun={openTheBox}
        runLabel="Reveal aggregate (open the box)"
        runDisabled={!canOpen}
        hotkey="⌘+Enter"
      >
        {/* Step 1 — open a ballot box (keygen + session). */}
        <div>
          <p className={cn(ds.label, 'mb-2')}>1. Open a ballot box (generates a real Paillier keypair)</p>
          {!session ? (
            <div className={ds.grid3}>
              <div>
                <label className={ds.label} htmlFor="phe-bits">Key size (bits)</label>
                <select
                  id="phe-bits"
                  className={ds.select}
                  value={bits}
                  onChange={(e) => setBits(Number(e.target.value) as Bits)}
                  disabled={keygenLoading}
                >
                  <option value={512}>512 (fast demo)</option>
                  <option value={1024}>1024 (macro default)</option>
                  <option value={2048}>2048 (production-grade, slow)</option>
                </select>
              </div>
              <div>
                <label className={ds.label} htmlFor="phe-label">Label (optional)</label>
                <input
                  id="phe-label"
                  type="text"
                  className={ds.input}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. team survey"
                  maxLength={120}
                />
              </div>
              <div className="flex items-end">
                <button
                  type="button"
                  onClick={openBallotBox}
                  disabled={keygenLoading}
                  className={cn(ds.btnSecondary, 'gap-2 w-full justify-center')}
                >
                  <Lock className="w-4 h-4" aria-hidden="true" />
                  {keygenLoading ? 'Generating key…' : 'Open ballot box'}
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-lattice-border bg-lattice-surface p-3 space-y-1">
              <p className={cn(ds.textBody, 'text-sm')}>
                Session <span className={ds.monoXs}>{session.sessionId}</span> — {session.bits}-bit key
              </p>
              <p className={cn(ds.monoXs, 'text-gray-500 break-all')}>n = {truncateCiphertext(session.publicKey.n)}</p>
              <p className={cn(ds.textMuted, 'text-xs')}>{session.note}</p>
            </div>
          )}
          {keygenError && <p className="text-sm text-red-400 mt-2">{keygenError}</p>}
        </div>

        {/* Step 2 — cast sealed contributions. */}
        {session && (
          <div>
            <p className={cn(ds.label, 'mb-2')}>
              2. Cast a value — sealed on encryption, never shown again
            </p>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className={ds.label} htmlFor="phe-cast-value">Integer value</label>
                <input
                  id="phe-cast-value"
                  type="number"
                  step={1}
                  className={ds.input}
                  value={castValue}
                  onChange={(e) => setCastValue(e.target.value)}
                  placeholder="e.g. 42"
                />
              </div>
              <button
                type="button"
                onClick={castBallot}
                disabled={castLoading || castValue.trim() === ''}
                className={cn(ds.btnSecondary, 'gap-2')}
              >
                <Lock className="w-4 h-4" aria-hidden="true" />
                {castLoading ? 'Sealing…' : 'Cast'}
              </button>
            </div>
            {castError && <p className="text-sm text-red-400 mt-2">{castError}</p>}

            {sealed.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <p className={cn(ds.textMuted, 'mb-1')}>{sealed.length} sealed entr{sealed.length === 1 ? 'y' : 'ies'} in the box (ciphertext only — no plaintext is ever stored client-side):</p>
                <table className={cn(ds.monoXs, 'w-full border-collapse')}>
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-lattice-border">
                      <th className="py-1 pr-4">#</th>
                      <th className="py-1 pr-4">Contribution id</th>
                      <th className="py-1 pr-4">Ciphertext (opaque)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sealed.map((s, i) => (
                      <tr key={s.contributionId} className="border-b border-lattice-border/40">
                        <td className="py-1 pr-4">{i + 1}</td>
                        <td className="py-1 pr-4">{s.contributionId}</td>
                        <td className="py-1 pr-4 text-gray-400 break-all">{s.ciphertextPreview}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Step 3 — aggregate config. */}
        {session && (
          <div>
            <p className={cn(ds.label, 'mb-2')}>3. Configure the reveal</p>
            <div className={ds.grid3}>
              <div>
                <label className={ds.label} htmlFor="phe-mode">Aggregate</label>
                <select id="phe-mode" className={ds.select} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="sum">Sum</option>
                  <option value="mean">Mean</option>
                </select>
              </div>
              <label className="flex items-center gap-2 mt-6 text-sm text-gray-300">
                <input type="checkbox" checked={dpEnabled} onChange={(e) => setDpEnabled(e.target.checked)} />
                Release with differential privacy (Laplace noise)
              </label>
              {dpEnabled && (
                <>
                  <div>
                    <label className={ds.label} htmlFor="phe-epsilon">Epsilon (ε)</label>
                    <input id="phe-epsilon" type="number" step={0.1} min={0.01} className={ds.input} value={epsilon} onChange={(e) => setEpsilon(e.target.value)} />
                  </div>
                  <div>
                    <label className={ds.label} htmlFor="phe-sensitivity">Sensitivity (max change one caster could make)</label>
                    <input id="phe-sensitivity" type="number" step={0.1} min={0.01} className={ds.input} value={sensitivity} onChange={(e) => setSensitivity(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Explicit honest-refusal demo — ciphertext x ciphertext. */}
        <div className="pt-2 border-t border-lattice-border/60">
          <p className={cn(ds.label, 'mb-2')}>Explore: what happens if I try to multiply two sealed ballots?</p>
          <button
            type="button"
            onClick={tryMultiplyBallots}
            disabled={multiplyStatus === 'loading'}
            className={cn(ds.btnGhost, 'gap-2')}
          >
            <ShieldOff className="w-4 h-4" aria-hidden="true" />
            {multiplyStatus === 'loading' ? 'Asking the engine…' : 'Try ciphertext × ciphertext'}
          </button>
          {multiplyStatus === 'refused' && (
            <div className="flex items-start gap-2 text-amber-400 mt-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-medium text-sm">Honest refusal — not a fabricated pass.</p>
                <p className={cn(ds.monoXs, 'text-amber-300/80 mt-1')}>{multiplyReason}</p>
              </div>
            </div>
          )}
          {multiplyStatus === 'error' && (
            <p className="text-sm text-red-400 mt-2">{multiplyReason}</p>
          )}
        </div>
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {aggregate && (
          <div className="space-y-4">
            <p className={cn(ds.textBody)}>
              Every sealed entry above was combined by multiplying ciphertexts under the
              public key (<span className={ds.monoXs}>addEncrypted</span>) — nothing was
              decrypted along the way. This is the ONE decrypt call in the whole flow,
              on the combined total only.
            </p>
            <div className="flex items-center gap-2 text-emerald-400">
              <Unlock className="w-4 h-4" aria-hidden="true" />
              <span className={cn(ds.monoBase)}>
                {aggregate.mode === 'sum' ? 'Sum' : 'Mean'} of {aggregate.contributorCount} sealed entr{aggregate.contributorCount === 1 ? 'y' : 'ies'} = {aggregate.rawValue}
              </span>
            </div>
            {aggregate.differentialPrivacy && (
              <div className="rounded-lg border border-lattice-border bg-lattice-surface p-3 text-sm space-y-1">
                {aggregate.differentialPrivacy.applied ? (
                  <>
                    <p className={ds.textBody}>Released through {aggregate.differentialPrivacy.mechanism}, ε = {aggregate.differentialPrivacy.epsilon}, sensitivity = {aggregate.differentialPrivacy.sensitivity}:</p>
                    <p className={cn(ds.monoBase, 'text-emerald-400')}>noisy value = {aggregate.differentialPrivacy.noisyValue}</p>
                    {aggregate.differentialPrivacy.confidenceInterval95 && (
                      <p className={ds.textMuted}>95% CI: [{aggregate.differentialPrivacy.confidenceInterval95[0]}, {aggregate.differentialPrivacy.confidenceInterval95[1]}]</p>
                    )}
                  </>
                ) : (
                  <p className="text-amber-400 text-sm">DP release not applied: {aggregate.differentialPrivacy.reason}</p>
                )}
              </div>
            )}
            <p className={cn(ds.textMuted, 'text-xs italic')}>{aggregate.note}</p>
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

export default PaillierPanel;
