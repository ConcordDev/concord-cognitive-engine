'use client';

/**
 * Certificates: the certificate itself (anyone holding its link can check
 * it), and the desk where anyone, signed in or not, verifies a code.
 */
import { useEffect, useState } from 'react';
import { Copy, Printer, ShieldCheck } from 'lucide-react';
import { pub, type Certificate as Cert } from './rr';

const certLink = (code: string) => (typeof window !== 'undefined' ? `${window.location.origin}/lenses/education?verify=${encodeURIComponent(code)}` : `/lenses/education?verify=${code}`);

export function CertificateView({ code, onCourse, onToast }: { code: string; onCourse: (id: string) => void; onToast: (m: string) => void }) {
  const [cert, setCert] = useState<Cert | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setCert(null); void pub<{ certificate: Cert }>(`/certificates/${encodeURIComponent(code)}`).then((r) => { if (!r.ok) setError(r.error); else setCert(r.result!.certificate); }); }, [code]);
  if (error) return <div className="mx-auto max-w-2xl p-6"><div className="rr-page p-6"><p className="rr-error" role="alert">{error === 'no certificate has that code' ? `No certificate has the code ${code}.` : error}</p></div></div>;
  if (!cert) return <div className="mx-auto max-w-3xl p-6" aria-busy="true"><div className="rr-skeleton h-[420px]" /></div>;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" data-testid="rr-certificate">
      <div className="rr-cert px-6 py-10 text-center md:px-14">
        <p className="rr-type text-[12px] uppercase tracking-[0.3em] text-[var(--rr-ink-2)]">Concord · The Reading Room</p>
        <p className="rr-book mt-5 text-[15px] italic text-[var(--rr-ink-2)]">This certifies that</p>
        <p className="rr-book mt-2 text-[34px] font-bold leading-tight" data-testid="rr-cert-learner">{cert.learner}</p>
        <p className="rr-book mt-3 text-[15px] italic text-[var(--rr-ink-2)]">completed every lesson of</p>
        <p className="rr-book mt-2 text-[24px] leading-snug">{cert.course}</p>
        <p className="rr-book mt-3 text-[14px] text-[var(--rr-ink-2)]">a course by <strong>{cert.creator}</strong> · {cert.lessons} lessons{cert.averageScore != null ? ` · checks averaged ${cert.averageScore}%` : ''}</p>
        <div className="mt-8 flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="text-left"><p className="rr-type text-[11px] uppercase tracking-widest text-[var(--rr-ink-2)]">Issued</p><p className="rr-book text-[14px]">{new Date(cert.issuedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
          <div className="rr-seal flex items-center justify-center" aria-hidden><ShieldCheck className="h-9 w-9" /></div>
          <div className="text-right"><p className="rr-type text-[11px] uppercase tracking-widest text-[var(--rr-ink-2)]">Certificate code</p><p className="rr-type text-[14px]" data-testid="rr-cert-code">{cert.code}</p></div>
        </div>
        <p className="mt-6 text-[11.5px] text-[var(--rr-ink-2)]">Every lesson was completed on Concord: checks were graded on the server and can't be passed from the browser. Verify this certificate at the Reading Room with its code.</p>
      </div>
      <div className="rr-noprint mt-4 flex flex-wrap justify-center gap-2">
        <button type="button" className="rr-btn rr-btn-room" onClick={async () => { try { await navigator.clipboard.writeText(certLink(cert.code)); onToast('Verification link copied.'); } catch { onToast(certLink(cert.code)); } }} data-testid="rr-copy-cert"><Copy className="h-4 w-4" /> Copy verification link</button>
        <button type="button" className="rr-btn rr-btn-room" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
        <button type="button" className="rr-btn rr-btn-room" onClick={() => onCourse(cert.courseId)}>The course</button>
      </div>
    </div>
  );
}

export function VerifyDesk({ initial, onShow }: { initial?: string; onShow: (code: string) => void }) {
  const [code, setCode] = useState(initial || '');
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'error'; error?: string }>({ status: 'idle' });
  const norm = code.trim().toUpperCase();
  const shaped = /^RR-[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(norm);
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-10" data-testid="rr-verify">
      <form className="rr-page p-6" onSubmit={async (e) => {
        e.preventDefault(); if (!shaped) return;
        setState({ status: 'loading' });
        const r = await pub<{ certificate: Cert }>(`/certificates/${encodeURIComponent(norm)}`);
        if (!r.ok) { setState({ status: 'error', error: r.error === 'no certificate has that code' ? 'No certificate has that code. Check it letter by letter.' : r.error || 'Could not check.' }); return; }
        setState({ status: 'idle' }); onShow(norm);
      }}>
        <h2 className="rr-book text-[22px] font-bold">Verify a certificate</h2>
        <p className="mt-1 text-[14px] text-[var(--rr-ink-2)]">Enter the code printed on a Reading Room certificate. Anyone can check one; you don't need an account.</p>
        <input className="rr-input rr-type mt-4 text-[16px] uppercase tracking-wider" value={code} onChange={(e) => { setCode(e.target.value); setState({ status: 'idle' }); }} placeholder="RR-XXXX-XXXX-XXXX-XXXX" aria-label="Certificate code" maxLength={24} data-testid="rr-verify-input" />
        {state.status === 'error' && <p className="rr-error mt-2 text-[13.5px]" role="alert">{state.error}</p>}
        <button type="submit" className="rr-btn rr-btn-lamp mt-3" disabled={!shaped || state.status === 'loading'} data-testid="rr-verify-go">{state.status === 'loading' ? 'Checking…' : 'Verify'}</button>
      </form>
    </div>
  );
}
