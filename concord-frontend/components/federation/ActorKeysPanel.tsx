'use client';

// Signed-actor verification + key rotation handling — federation domain.
// Macros: federation.registerActorKey, verifyActorSignature, listActorKeys.

import { useState, useCallback, useEffect } from 'react';
import { lensRun } from '@/lib/api/client';
import { KeyRound, Loader2, Plus, ShieldCheck, RotateCw } from 'lucide-react';

interface ActorKeyEntry {
  domain: string;
  keyId: string;
  algo: string;
  fingerprint: string;
  verified: boolean;
  registeredAt: number;
  rotatedAt: number | null;
  rotationCount: number;
  priorFingerprint: string | null;
  lastVerifiedAt: number | null;
}

interface ActorKeysResult {
  entries: ActorKeyEntry[];
  total: number;
  verified: number;
}

interface VerifyResult {
  domain: string;
  verified: boolean;
  keyIdMatch: boolean;
  fingerprintMatch: boolean;
  expectedFingerprint: string;
  keyId: string;
}

export function ActorKeysPanel() {
  const [data, setData] = useState<ActorKeysResult | null>(null);
  const [loading, setLoading] = useState(false);

  const [domain, setDomain] = useState('');
  const [keyId, setKeyId] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [algo, setAlgo] = useState('rsa-sha256');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [verifyDomain, setVerifyDomain] = useState('');
  const [verifyKeyId, setVerifyKeyId] = useState('');
  const [signedFp, setSignedFp] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await lensRun<ActorKeysResult>('federation', 'listActorKeys', {});
      if (r.data.ok && r.data.result) setData(r.data.result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const register = useCallback(async () => {
    if (!domain.trim() || !keyId.trim() || publicKey.trim().length < 16) {
      setErr('domain, keyId and a 16+ char public key are required');
      return;
    }
    setBusy(true); setErr(null);
    try {
      const r = await lensRun<{ rotated?: boolean }>('federation', 'registerActorKey', {
        domain: domain.trim(), keyId: keyId.trim(), publicKey: publicKey.trim(), algo: algo.trim() || undefined,
      });
      if (!r.data.ok) { setErr(r.data.error || 'failed'); return; }
      setDomain(''); setKeyId(''); setPublicKey('');
      await load();
    } finally {
      setBusy(false);
    }
  }, [domain, keyId, publicKey, algo, load]);

  const verify = useCallback(async () => {
    if (!verifyDomain.trim() || !signedFp.trim()) {
      setVerifyErr('domain and signed fingerprint required');
      return;
    }
    setVerifying(true); setVerifyErr(null); setVerifyResult(null);
    try {
      const r = await lensRun<VerifyResult>('federation', 'verifyActorSignature', {
        domain: verifyDomain.trim(),
        keyId: verifyKeyId.trim() || undefined,
        signedFingerprint: signedFp.trim(),
      });
      if (!r.data.ok) { setVerifyErr(r.data.error || 'failed'); return; }
      if (r.data.result) {
        setVerifyResult(r.data.result);
        await load();
      }
    } finally {
      setVerifying(false);
    }
  }, [verifyDomain, verifyKeyId, signedFp, load]);

  return (
    <section className="rounded-lg border border-violet-500/30 bg-black/60 p-4">
      <h2 className="text-violet-300 font-semibold mb-3 inline-flex items-center gap-1.5">
        <KeyRound className="w-4 h-4" /> Signed-actor keys
      </h2>
      <p className="text-xs text-gray-500 mb-3">
        Register each peer&apos;s signing key. Re-registering a different key
        rotates it and preserves the prior fingerprint.
      </p>

      {/* Register */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="peer domain"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-violet-400"
        />
        <input
          value={keyId}
          onChange={(e) => setKeyId(e.target.value)}
          placeholder="key id (e.g. peer#main-key)"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <input
          value={algo}
          onChange={(e) => setAlgo(e.target.value)}
          placeholder="algorithm"
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
        />
        <textarea
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder="public key (PEM / base64, min 16 chars)"
          rows={2}
          className="bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-gray-200 font-mono sm:col-span-2"
        />
      </div>
      <button
        type="button"
        onClick={register}
        disabled={busy}
        className="px-3 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1 mb-2"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
        Register key
      </button>
      {err && <div className="text-rose-300 text-xs mb-2">{err}</div>}

      {/* Verify */}
      <div className="border-t border-white/10 mt-3 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">Verify signature</div>
        <div className="flex flex-wrap gap-2 mb-2">
          <input
            value={verifyDomain}
            onChange={(e) => setVerifyDomain(e.target.value)}
            placeholder="peer domain"
            className="flex-1 min-w-[140px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
          />
          <input
            value={verifyKeyId}
            onChange={(e) => setVerifyKeyId(e.target.value)}
            placeholder="key id (optional)"
            className="flex-1 min-w-[140px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200"
          />
          <input
            value={signedFp}
            onChange={(e) => setSignedFp(e.target.value)}
            placeholder="presented fingerprint"
            className="flex-1 min-w-[180px] bg-black/60 border border-white/10 rounded px-3 py-2 text-sm text-gray-200 font-mono"
          />
          <button
            type="button"
            onClick={verify}
            disabled={verifying}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-white text-sm inline-flex items-center gap-1"
          >
            {verifying ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
            Verify
          </button>
        </div>
        {verifyErr && <div className="text-rose-300 text-xs mb-2">{verifyErr}</div>}
        {verifyResult && (
          <div className={`text-xs rounded p-2 border ${
            verifyResult.verified
              ? 'bg-emerald-900/40 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-900/40 border-rose-500/30 text-rose-200'
          }`}>
            {verifyResult.verified ? 'Signature verified.' : 'Signature mismatch.'}
            {' '}keyId match: {String(verifyResult.keyIdMatch)} · fingerprint match: {String(verifyResult.fingerprintMatch)}
            <div className="text-gray-400 mt-1 font-mono">expected: {verifyResult.expectedFingerprint}</div>
          </div>
        )}
      </div>

      {/* List */}
      <div className="border-t border-white/10 mt-3 pt-3">
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-2">
          Registered keys {data ? `· ${data.verified}/${data.total} verified` : ''}
        </div>
        {loading ? (
          <p className="text-xs text-gray-500 italic">Loading keys…</p>
        ) : !data || data.entries.length === 0 ? (
          <p className="text-xs text-gray-500 italic">No actor keys registered.</p>
        ) : (
          <ul className="space-y-2">
            {data.entries.map((e) => (
              <li key={e.domain} className="border border-white/10 rounded p-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-mono text-gray-100 truncate">{e.domain}</span>
                  <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                    e.verified
                      ? 'bg-emerald-900/40 border-emerald-500/30 text-emerald-300'
                      : 'bg-zinc-800 border-white/10 text-gray-400'
                  }`}>
                    {e.verified ? 'verified' : 'unverified'}
                  </span>
                  {e.rotationCount > 0 && (
                    <span className="text-[10px] bg-amber-900/40 border border-amber-500/30 text-amber-300 rounded px-1.5 py-0.5 inline-flex items-center gap-1">
                      <RotateCw className="w-3 h-3" /> rotated ×{e.rotationCount}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-1">
                  {e.keyId} · {e.algo}
                </div>
                <div className="text-[10px] text-gray-500 font-mono mt-1">fp: {e.fingerprint}</div>
                {e.priorFingerprint && (
                  <div className="text-[10px] text-gray-600 font-mono">prior: {e.priorFingerprint}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
