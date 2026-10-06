'use client';

/**
 * Public signing page — /sign/[token]
 *
 * A recipient opens the link a sender emailed or shared, reads the document
 * and signs as themselves. Uses the public `/api/esign/:token` routes with a
 * plain fetch: no account, no cookie. The token is the only access control
 * and resolves server-side to this one signer slot, so this page can't see
 * or sign anything else. Identity evidence (typed name, explicit consent,
 * IP and browser) is recorded by the server at the moment of signing.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, FileSignature, Loader2, ShieldCheck } from 'lucide-react';

interface SignView {
  document: { title: string; text?: string; hash?: string | null };
  signer: { name: string; email?: string; role?: string; status: string; signedAt?: string | null };
  envelopeStatus: string;
  parties: Array<{ name: string; role: string; status: string }>;
  disclosure?: string;
}

export default function SignPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token as string) || '';
  const [view, setView] = useState<SignView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/esign/${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) { setError('This signing link is invalid, was replaced by a newer one, or the document was withdrawn.'); setView(null); return; }
      setError(null);
      setView(data.result as SignView);
      if (!typedName && data.result?.signer?.name) setTypedName(data.result.signer.name);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- prefill the name once per token
  }, [token]);

  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  const sign = async () => {
    setSigning(true); setSignError(null);
    try {
      const res = await fetch(`/api/esign/${encodeURIComponent(token)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ typedName: typedName.trim(), consent }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const code = data?.error || '';
        setSignError(code === 'consent_required' ? 'Please confirm you agree to sign electronically.'
          : code === 'typed_name_required' ? 'Type your full name to sign.'
          : code.includes('already') ? 'This has already been signed.'
          : 'Signing failed. Please try again.');
        return;
      }
      await load();
    } catch {
      setSignError('Network error. Please try again.');
    } finally {
      setSigning(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#0a0a0b] px-4 py-10 text-zinc-100">
      <div className="mx-auto max-w-2xl">
        <p className="flex items-center gap-2 text-sm text-zinc-500"><FileSignature className="h-4 w-4" /> Signature request</p>
        {loading ? (
          <div role="status" className="mt-10 flex items-center gap-2 text-zinc-400"><Loader2 className="h-4 w-4 animate-spin" /> Opening document…</div>
        ) : error ? (
          <div role="alert" className="mt-8 flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-5 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        ) : view && (
          <>
            <h1 className="mt-1 font-vault text-4xl leading-tight">{view.document.title}</h1>
            <p className="mt-2 text-sm text-zinc-400">For {view.signer.name}{view.signer.role ? ` · ${view.signer.role}` : ''}</p>

            <section className="mt-6 max-h-[50vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#111] p-5">
              {view.document.text
                ? <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-zinc-200">{view.document.text}</pre>
                : <p className="text-sm text-zinc-500">The sender didn&apos;t include the document text in this request. Ask them for a copy before signing.</p>}
            </section>
            {view.document.hash && (
              <p className="mt-2 break-all font-mono text-[10px] text-zinc-600">Document fingerprint (SHA-256): {view.document.hash}</p>
            )}

            {view.parties.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-2 text-[12px]">
                {view.parties.map((p, i) => (
                  <li key={`${p.name}-${i}`} className={`rounded-full px-3 py-1 ${p.status === 'signed' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-zinc-400'}`}>
                    {p.name} · {p.status}
                  </li>
                ))}
              </ul>
            )}

            {view.signer.status === 'signed' ? (
              <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm text-emerald-200">
                <CheckCircle2 className="h-5 w-5" />
                Signed{view.signer.signedAt ? ` on ${new Date(view.signer.signedAt).toLocaleString()}` : ''}. You can close this page.
              </div>
            ) : view.envelopeStatus === 'voided' ? (
              <p role="alert" className="mt-6 text-sm text-rose-300">The sender withdrew this request.</p>
            ) : (
              <section className="mt-6 space-y-4 rounded-2xl border border-white/10 bg-[#111] p-5">
                <label className="block text-sm text-zinc-300">
                  Type your full name to sign
                  <input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="name"
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 font-vault text-xl text-zinc-50 focus:border-teal-400/50 focus:outline-none" />
                </label>
                <label className="flex items-start gap-3 text-sm text-zinc-300">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 accent-teal-400" />
                  <span>I agree to sign this document electronically and that my typed name is my signature.{view.disclosure ? ` ${view.disclosure}` : ''}</span>
                </label>
                {signError && <p role="alert" className="text-sm text-rose-300">{signError}</p>}
                <button type="button" onClick={() => void sign()} disabled={signing || !typedName.trim() || !consent}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-2.5 text-sm font-medium text-black transition-colors hover:bg-teal-300 disabled:opacity-40">
                  {signing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Sign
                </button>
                <p className="text-[11px] text-zinc-500">Your IP address and browser are recorded with your signature.</p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
