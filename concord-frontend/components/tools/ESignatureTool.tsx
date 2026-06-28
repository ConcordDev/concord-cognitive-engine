'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ESignatureTool — full multi-party e-signature workflow over the
 * tools.esign-* macros: create an envelope with N parties, route it for
 * signature, each party applies a tamper-evident HMAC signature, verify
 * the whole envelope (detects post-signing document tampering), verify a
 * standalone token, list and void envelopes, and inspect the audit trail.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import {
  FileSignature, Loader2, Plus, Trash2, Lock, ShieldCheck, ShieldAlert,
  X, FileText, Users, ClipboardList, Eye,
} from 'lucide-react';

interface Party {
  id: string; order: number; name: string; email: string; role: string;
  status: 'pending' | 'signed';
  signature: { alg: string; token: string; payload: Record<string, any> } | null;
  signedAt: string | null;
}
interface AuditEntry { event: string; actor: string; at: string; detail: string }
interface Envelope {
  id: string; number: string; title: string; document: string; documentHash: string;
  status: 'out_for_signature' | 'completed' | 'voided';
  parties: Party[]; audit: AuditEntry[]; createdAt: string; completedAt: string | null;
  esignDisclosure: string;
}
interface EnvelopeSummary {
  id: string; number: string; title: string; status: string; documentHash: string;
  parties: { id: string; name: string; role: string; status: string; signedAt: string | null }[];
  signedCount: number; partyCount: number; createdAt: string; completedAt: string | null;
}
interface VerifyCheck {
  partyId: string; partyName: string; status: string; verified: boolean;
  tokenValid?: boolean; hashMatches?: boolean; reason?: string; signedAt?: string | null;
}
interface VerifyResult {
  envelopeId: string; envelopeNumber: string; documentIntact: boolean;
  currentHash: string; expectedHash: string; checks: VerifyCheck[];
  allValid: boolean; verifiedAt: string;
}

interface PartyDraft { name: string; email: string; role: string }

export function ESignatureTool() {
  const [view, setView] = useState<'create' | 'list'>('list');
  const [list, setList] = useState<EnvelopeSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'out_for_signature' | 'completed' | 'voided'>('all');
  const [selected, setSelected] = useState<Envelope | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-envelope form state.
  const [title, setTitle] = useState('');
  const [document, setDocument] = useState('');
  const [parties, setParties] = useState<PartyDraft[]>([{ name: '', email: '', role: 'signer' }]);

  const loadList = useCallback(async () => {
    const r = await lensRun<{ envelopes: EnvelopeSummary[]; total: number }>('tools', 'esign-list', { status: statusFilter });
    if (r.data?.ok && r.data.result) setList(r.data.result.envelopes);
  }, [statusFilter]);

  useEffect(() => { loadList(); }, [loadList]);

  const openDetail = useCallback(async (id: string) => {
    setVerify(null);
    const r = await lensRun<{ envelope: Envelope }>('tools', 'esign-detail', { envelopeId: id });
    if (r.data?.ok && r.data.result) setSelected(r.data.result.envelope);
  }, []);

  const createEnvelope = useCallback(async () => {
    const cleanParties = parties
      .map((p) => ({ name: p.name.trim(), email: p.email.trim(), role: p.role.trim() || 'signer' }))
      .filter((p) => p.name);
    if (!title.trim() || !document.trim() || cleanParties.length === 0) {
      setError('title, document text, and at least one named party are required');
      return;
    }
    setBusy(true);
    setError(null);
    const r = await lensRun<{ envelope: Envelope }>('tools', 'esign-create', {
      title: title.trim(), document, parties: cleanParties,
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setTitle('');
      setDocument('');
      setParties([{ name: '', email: '', role: 'signer' }]);
      setView('list');
      await loadList();
      setSelected(r.data.result.envelope);
    } else {
      setError(r.data?.error || 'create failed');
    }
  }, [title, document, parties, loadList]);

  const signParty = useCallback(async (envelopeId: string, partyId: string) => {
    setBusy(true);
    setError(null);
    const r = await lensRun<{ envelope: Envelope; completed: boolean }>('tools', 'esign-sign', { envelopeId, partyId });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setSelected(r.data.result.envelope);
      loadList();
    } else {
      setError(r.data?.error || 'sign failed');
    }
  }, [loadList]);

  const verifyEnvelope = useCallback(async (envelopeId: string) => {
    setBusy(true);
    setError(null);
    const r = await lensRun<VerifyResult>('tools', 'esign-verify', { envelopeId });
    setBusy(false);
    if (r.data?.ok && r.data.result) setVerify(r.data.result);
    else setError(r.data?.error || 'verify failed');
  }, []);

  const voidEnvelope = useCallback(async (envelopeId: string) => {
    setBusy(true);
    setError(null);
    const r = await lensRun<{ envelope: Envelope }>('tools', 'esign-void', {
      envelopeId, reason: 'Voided from Tools lens',
    });
    setBusy(false);
    if (r.data?.ok && r.data.result) {
      setSelected(r.data.result.envelope);
      loadList();
    } else {
      setError(r.data?.error || 'void failed');
    }
  }, [loadList]);

  const updateParty = (i: number, patch: Partial<PartyDraft>) => {
    setParties((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  };

  const statusBadge = (status: string) => {
    const cls = status === 'completed'
      ? 'bg-emerald-900/40 text-emerald-300'
      : status === 'voided'
        ? 'bg-zinc-800 text-zinc-400'
        : 'bg-amber-900/40 text-amber-300';
    return <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{status.replace(/_/g, ' ')}</span>;
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* Left column: list / create form */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${view === 'list' ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Envelopes
          </button>
          <button
            onClick={() => { setView('create'); setSelected(null); setVerify(null); }}
            aria-pressed={view === 'create'}
            className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${view === 'create' ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> New envelope
          </button>
        </div>

        {busy && (
          <div role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-yellow-900/40 bg-yellow-950/10 px-3 py-2 text-xs text-yellow-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Working…
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            <span>{error}</span>
            <button
              onClick={() => { setError(null); loadList(); }}
              className="shrink-0 rounded border border-red-800/60 px-2 py-0.5 text-[11px] text-red-200 hover:bg-red-900/40 focus:outline-none focus:ring-2 focus:ring-red-400"
            >
              Retry
            </button>
          </div>
        )}

        {view === 'create' && (
          <div className="space-y-3 rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-yellow-300">
              <FileSignature className="h-4 w-4" aria-hidden /> Create signing envelope
            </h3>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Envelope title (e.g. Mutual NDA)"
              className="w-full rounded border border-yellow-900/40 bg-black/40 px-2 py-1.5 text-sm text-yellow-100 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
              aria-label="Envelope title"
            />
            <textarea
              value={document}
              onChange={(e) => setDocument(e.target.value)}
              placeholder="Paste the document text to be signed…"
              className="h-32 w-full rounded border border-yellow-900/40 bg-black/40 p-2 font-mono text-xs text-yellow-100 focus:border-yellow-500 focus:outline-none focus:ring-1 focus:ring-yellow-500"
              aria-label="Document text"
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
                  <Users className="h-3.5 w-3.5" aria-hidden /> Parties
                </span>
                <button
                  onClick={() => setParties((p) => [...p, { name: '', email: '', role: 'signer' }])}
                  className="inline-flex items-center gap-1 text-[11px] text-yellow-500 hover:text-yellow-300"
                >
                  <Plus className="h-3 w-3" aria-hidden /> Add party
                </button>
              </div>
              {parties.map((p, i) => (
                <div key={i} className="flex gap-1.5">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updateParty(i, { name: e.target.value })}
                    placeholder={`Party ${i + 1} name`}
                    className="flex-1 rounded border border-yellow-900/40 bg-black/40 px-2 py-1 text-xs text-yellow-100 focus:border-yellow-500 focus:outline-none"
                    aria-label={`Party ${i + 1} name`}
                  />
                  <input
                    type="text"
                    value={p.email}
                    onChange={(e) => updateParty(i, { email: e.target.value })}
                    placeholder="email"
                    className="w-32 rounded border border-yellow-900/40 bg-black/40 px-2 py-1 text-xs text-yellow-100 focus:border-yellow-500 focus:outline-none"
                    aria-label={`Party ${i + 1} email`}
                  />
                  <input
                    type="text"
                    value={p.role}
                    onChange={(e) => updateParty(i, { role: e.target.value })}
                    placeholder="role"
                    className="w-24 rounded border border-yellow-900/40 bg-black/40 px-2 py-1 text-xs text-yellow-100 focus:border-yellow-500 focus:outline-none"
                    aria-label={`Party ${i + 1} role`}
                  />
                  {parties.length > 1 && (
                    <button
                      onClick={() => setParties((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded border border-yellow-900/40 px-1.5 text-yellow-700 hover:text-red-400"
                      aria-label={`Remove party ${i + 1}`}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={createEnvelope}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-yellow-400"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSignature className="h-3.5 w-3.5" />} Route for signature
            </button>
          </div>
        )}

        {view === 'list' && (
          <div className="rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-3">
            <div className="mb-2 flex gap-0.5 rounded border border-yellow-900/40 bg-yellow-950/30 p-0.5 text-xs">
              {(['all', 'out_for_signature', 'completed', 'voided'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  aria-pressed={statusFilter === f}
                  className={`flex-1 rounded px-1.5 py-1 ${statusFilter === f ? 'bg-yellow-700/40 text-yellow-100' : 'text-yellow-600 hover:text-yellow-400'}`}
                >{f === 'out_for_signature' ? 'out' : f}</button>
              ))}
            </div>
            {list.length === 0 ? (
              <p className="py-6 text-center text-xs text-yellow-700">No envelopes yet — create one to begin.</p>
            ) : (
              <ul className="space-y-1.5">
                {list.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => openDetail(e.id)}
                      className={`flex w-full items-center justify-between rounded border px-2.5 py-2 text-left text-xs hover:bg-yellow-900/20 ${selected?.id === e.id ? 'border-yellow-600 bg-yellow-900/20' : 'border-yellow-900/30'}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-yellow-600">{e.number}</span>
                          {statusBadge(e.status)}
                        </div>
                        <div className="truncate text-yellow-200">{e.title}</div>
                      </div>
                      <span className="ml-2 shrink-0 text-yellow-700">{e.signedCount}/{e.partyCount} signed</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Right column: envelope detail + verify */}
      <div className="space-y-3">
        {selected ? (
          <div className="space-y-3 rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-yellow-600">{selected.number}</span>
                  {statusBadge(selected.status)}
                </div>
                <h3 className="text-sm font-semibold text-yellow-200">{selected.title}</h3>
              </div>
              <button onClick={() => { setSelected(null); setVerify(null); }} className="text-yellow-700 hover:text-yellow-400" aria-label="Close detail">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            <div className="rounded border border-yellow-900/40 bg-black/40 p-2">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-yellow-700">
                <FileText className="h-3 w-3" aria-hidden /> Document · SHA-256 {selected.documentHash.slice(0, 16)}…
              </div>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-yellow-300">{selected.document}</pre>
            </div>

            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
                <Users className="h-3.5 w-3.5" aria-hidden /> Signers
              </h4>
              <ul className="space-y-1.5">
                {selected.parties.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded border border-yellow-900/30 bg-black/30 px-2.5 py-1.5">
                    <div className="text-xs">
                      <span className="text-yellow-200">{p.name}</span>
                      <span className="ml-1.5 text-yellow-700">· {p.role}</span>
                      {p.signedAt && <div className="text-[10px] text-emerald-500">signed {new Date(p.signedAt).toLocaleString()}</div>}
                    </div>
                    {p.status === 'signed' ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> signed
                      </span>
                    ) : selected.status === 'out_for_signature' ? (
                      <button
                        onClick={() => signParty(selected.id, p.id)}
                        disabled={busy}
                        className="inline-flex items-center gap-1 rounded bg-yellow-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-yellow-500 disabled:opacity-40"
                      >
                        <Lock className="h-3 w-3" aria-hidden /> Sign
                      </button>
                    ) : (
                      <span className="text-[11px] text-yellow-700">pending</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => verifyEnvelope(selected.id)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded border border-yellow-700/60 px-2.5 py-1.5 text-xs font-medium text-yellow-300 hover:bg-yellow-900/30 disabled:opacity-40"
              >
                <Eye className="h-3.5 w-3.5" aria-hidden /> Verify signatures
              </button>
              {selected.status === 'out_for_signature' && (
                <button
                  onClick={() => voidEnvelope(selected.id)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded border border-red-900/60 px-2.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-950/30 disabled:opacity-40"
                >
                  <X className="h-3.5 w-3.5" aria-hidden /> Void
                </button>
              )}
            </div>

            {verify && (
              <div className={`rounded border p-2.5 text-xs ${verify.allValid ? 'border-emerald-800/60 bg-emerald-950/20' : 'border-red-900/60 bg-red-950/20'}`}>
                <div className="flex items-center gap-1.5 font-semibold">
                  {verify.allValid
                    ? <><ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden /><span className="text-emerald-300">All signatures valid</span></>
                    : <><ShieldAlert className="h-4 w-4 text-red-400" aria-hidden /><span className="text-red-300">Verification failed</span></>}
                </div>
                <p className="mt-1 text-[11px] text-yellow-600">
                  Document {verify.documentIntact ? 'intact' : 'TAMPERED — hash mismatch'} ·
                  expected {verify.expectedHash.slice(0, 12)}… / current {verify.currentHash.slice(0, 12)}…
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {verify.checks.map((c) => (
                    <li key={c.partyId} className="flex items-center justify-between">
                      <span className="text-yellow-300">{c.partyName}</span>
                      <span className={c.verified ? 'text-emerald-400' : 'text-red-400'}>
                        {c.verified ? 'verified' : (c.reason || 'invalid')}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
                <ClipboardList className="h-3.5 w-3.5" aria-hidden /> Audit trail
              </h4>
              <ul className="space-y-1 border-l-2 border-yellow-900/40 pl-2.5">
                {selected.audit.map((a, i) => (
                  <li key={i} className="text-[11px]">
                    <span className="font-mono uppercase text-yellow-500">{a.event}</span>
                    <span className="ml-1.5 text-yellow-400">{a.detail}</span>
                    <div className="text-[10px] text-yellow-700">{new Date(a.at).toLocaleString()} · {a.actor}</div>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-[10px] text-yellow-800">{selected.esignDisclosure}</p>
          </div>
        ) : (
          <div className="flex h-full min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-yellow-900/40 text-xs text-yellow-700">
            Select an envelope to view signers, verify, and inspect its audit trail.
          </div>
        )}

        <TokenVerifier />
      </div>
    </div>
  );
}

/** Standalone signature-token verifier — verifies a copied token + payload. */
function TokenVerifier() {
  const [token, setToken] = useState('');
  const [payloadJson, setPayloadJson] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ valid: boolean; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verifyToken = useCallback(async () => {
    setError(null);
    setResult(null);
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      setError('payload must be valid JSON');
      return;
    }
    setBusy(true);
    const r = await lensRun<{ valid: boolean; reason: string }>('tools', 'esign-verify-token', { token: token.trim(), payload });
    setBusy(false);
    if (r.data?.ok && r.data.result) setResult(r.data.result);
    else setError(r.data?.error || 'verify failed');
  }, [token, payloadJson]);

  return (
    <div className="space-y-2 rounded-lg border border-yellow-900/40 bg-yellow-950/10 p-3">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-yellow-500">
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Verify a standalone signature token
      </h4>
      <input
        type="text"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="signature token"
        className="w-full rounded border border-yellow-900/40 bg-black/40 px-2 py-1 font-mono text-[11px] text-yellow-100 focus:border-yellow-500 focus:outline-none"
        aria-label="Signature token"
      />
      <textarea
        value={payloadJson}
        onChange={(e) => setPayloadJson(e.target.value)}
        placeholder='signed payload JSON, e.g. {"envelopeId":"…","documentHash":"…","partyId":"…"}'
        className="h-16 w-full rounded border border-yellow-900/40 bg-black/40 p-1.5 font-mono text-[11px] text-yellow-100 focus:border-yellow-500 focus:outline-none"
        aria-label="Signed payload JSON"
      />
      <button
        onClick={verifyToken}
        disabled={busy || !token.trim() || !payloadJson.trim()}
        className="inline-flex items-center gap-1.5 rounded bg-yellow-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-yellow-500 disabled:opacity-40"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Verify token
      </button>
      {error && <p className="text-[11px] text-red-400">{error}</p>}
      {result && (
        <p className={`text-[11px] ${result.valid ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.valid ? '✓ ' : '✗ '}{result.reason}
        </p>
      )}
    </div>
  );
}
