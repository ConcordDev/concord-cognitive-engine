'use client';

/**
 * ContractEsign — cryptographic e-signature with a SHA-256 audit
 * certificate, plus a verification pass that recomputes hashes to
 * detect tampering. Backlog item 5. Wires law.contract-esign +
 * law.contract-verify.
 */

import { useCallback, useEffect, useState } from 'react';
import { PenTool, ShieldCheck, ShieldAlert, Loader2, FileCheck } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface VerifyCheck {
  party: string; certificateId: string; signedAt: string;
  documentUnchangedSinceSigning: boolean; signatureValid: boolean; valid: boolean;
}
interface VerifyResult {
  currentDocumentHash: string; certifiedSignatures: number;
  allValid: boolean; tampered: boolean; checks: VerifyCheck[];
}

export function ContractEsign({ contractId, onSigned }: { contractId: string; onSigned?: () => void }) {
  const [party, setParty] = useState('');
  const [intent, setIntent] = useState('I agree to be bound by this contract.');
  const [busy, setBusy] = useState(false);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cpName, setCpName] = useState('');
  const [cpEmail, setCpEmail] = useState('');
  const [request, setRequest] = useState<{ url: string; delivered: string; reason: string | null } | null>(null);

  const runVerify = useCallback(async () => {
    const r = await lensRun('law', 'contract-verify', { id: contractId });
    if (r.data?.ok) setVerify(r.data.result as VerifyResult);
  }, [contractId]);

  useEffect(() => { void Promise.resolve().then(runVerify); }, [runVerify]);

  async function requestCounterparty() {
    setBusy(true); setErr(null);
    const r = await lensRun<{ url: string; delivered: string; reason: string | null }>('law', 'contract-request-signature', {
      id: contractId, name: cpName.trim() || undefined, email: cpEmail.trim() || undefined,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) setRequest(r.data.result);
    else setErr(r.data?.error || 'Could not create the signature request.');
  }

  async function esign() {
    if (!party.trim()) { setErr('Enter the signing party name.'); return; }
    setBusy(true); setErr(null);
    const r = await lensRun('law', 'contract-esign', { id: contractId, party: party.trim(), intent: intent.trim() });
    setBusy(false);
    if (r.data?.ok) { setParty(''); await runVerify(); onSigned?.(); }
    else { setErr(r.data?.error || 'E-signature failed.'); }
  }

  return (
    <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2">
        <PenTool className="w-4 h-4 text-neon-green" />
        <h3 className="text-sm font-semibold text-white">Cryptographic E-Signature</h3>
        <span className="text-[10px] text-gray-400">SHA-256 audit certificate</span>
      </div>
      <div className="space-y-1.5">
        <input value={party} onChange={(e) => setParty(e.target.value)} placeholder="Your name (you sign your side once)"
          className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
        <input value={intent} onChange={(e) => setIntent(e.target.value)} placeholder="Signing intent"
          className="w-full bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
        <div className="flex gap-2">
          <button onClick={esign} disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-neon-green/20 text-neon-green hover:bg-neon-green/30 disabled:opacity-50 inline-flex items-center gap-1">
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <PenTool className="w-3 h-3" />}
            Sign your side
          </button>
          <button onClick={runVerify}
            className="px-3 py-1.5 text-xs rounded bg-white/10 text-gray-300 hover:bg-white/20 inline-flex items-center gap-1">
            <FileCheck className="w-3 h-3" />Verify
          </button>
        </div>
      </div>
      <div className="space-y-1.5 border-t border-white/10 pt-2">
        <p className="text-[11px] text-gray-400">The counterparty signs from their own link — you can&apos;t sign for them.</p>
        <div className="flex flex-wrap gap-1.5">
          <input value={cpName} onChange={(e) => setCpName(e.target.value)} placeholder="Counterparty signer" aria-label="Counterparty signer name"
            className="flex-1 min-w-[8rem] bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
          <input value={cpEmail} onChange={(e) => setCpEmail(e.target.value)} placeholder="Their email" aria-label="Counterparty email"
            className="flex-1 min-w-[8rem] bg-black/50 border border-white/15 rounded px-2 py-1.5 text-xs text-white" />
          <button onClick={() => void requestCounterparty()} disabled={busy}
            className="px-3 py-1.5 text-xs rounded bg-white/10 text-gray-200 hover:bg-white/20 disabled:opacity-50">Request signature</button>
        </div>
        {request && (
          <p className="text-[11px] text-gray-300">
            {request.delivered === 'email' ? 'Signing link emailed.' : `Not emailed (${(request.reason || '').replace(/_/g, ' ')}). Share this link:`}{' '}
            {request.delivered !== 'email' && (
              <button type="button" onClick={() => void navigator.clipboard?.writeText(request.url)} className="font-mono text-cyan-300 hover:underline break-all" title="Copy signing link">{request.url}</button>
            )}
          </p>
        )}
      </div>
      {err && <p role="alert" className="text-xs text-rose-400">{err}</p>}

      {verify && verify.certifiedSignatures > 0 && (
        <div className={cn('rounded-lg p-2 border',
          verify.tampered ? 'border-rose-500/40 bg-rose-500/5' : 'border-neon-green/40 bg-neon-green/5')}>
          <p className="text-xs font-semibold text-white inline-flex items-center gap-1 mb-1">
            {verify.tampered
              ? <><ShieldAlert className="w-3.5 h-3.5 text-rose-400" />Tampering detected</>
              : <><ShieldCheck className="w-3.5 h-3.5 text-neon-green" />All {verify.certifiedSignatures} certificate{verify.certifiedSignatures !== 1 ? 's' : ''} valid</>}
          </p>
          <p className="text-[9px] text-gray-400 font-mono break-all mb-1">doc hash: {verify.currentDocumentHash}</p>
          {verify.checks.map((c) => (
            <div key={c.certificateId} className="text-[10px] text-gray-400 flex items-center gap-1.5 py-0.5">
              <span className={cn('w-1.5 h-1.5 rounded-full', c.valid ? 'bg-neon-green' : 'bg-rose-400')} />
              <span className="text-white">{c.party}</span>
              <span className="text-gray-600">{new Date(c.signedAt).toLocaleString()}</span>
              {!c.documentUnchangedSinceSigning && <span className="text-rose-400">document changed</span>}
              {!c.signatureValid && <span className="text-rose-400">signature invalid</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
