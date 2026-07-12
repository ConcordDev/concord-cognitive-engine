'use client';

// WebhookSignatureVerifier — surfaces `integrations.verifyWebhookSignature`
// (server/domains/integrations.js), which was previously unsurfaced
// (docs/lens-specs/integrations-capability-map.md). Debug tool for a user
// who received an inbound `X-Concord-Signature` header on their own webhook
// receiver and wants to check whether it matches what Concord's signing key
// for this webhook would actually produce — the same HMAC-style check their
// receiver code should be doing. The webhook's signing secret never leaves
// the server; only the derived `expected` signature is returned.

import { useCallback, useState } from 'react';
import { ShieldCheck, ShieldX, Loader2, KeyRound } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface VerifyResult {
  valid: boolean;
  expected: string;
  provided: string;
  signatureHeader: string;
}

const SAMPLE_BODY = '{"event":"dtu.created","data":{"id":"dtu_123"}}';

export function WebhookSignatureVerifier({ webhookId }: { webhookId: string }) {
  const [body, setBody] = useState(SAMPLE_BODY);
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verify = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await lensRun<VerifyResult>('integrations', 'verifyWebhookSignature', {
        webhookId,
        body,
        signature,
      });
      if (r.data.ok && r.data.result) {
        setResult(r.data.result);
      } else {
        setError(r.data.error || 'Verification failed');
      }
    } finally {
      setBusy(false);
    }
  }, [webhookId, body, signature]);

  return (
    <div className="border-t border-lattice-border pt-3 space-y-2" data-testid="webhook-signature-verifier">
      <h4 className="text-xs font-semibold text-gray-300 flex items-center gap-1">
        <KeyRound className="w-3 h-3" /> Verify inbound signature
      </h4>
      <p className="text-[11px] text-gray-400">
        Paste the raw payload body you received and the value from its{' '}
        <code className="text-neon-cyan">X-Concord-Signature</code> header to check it against
        what this webhook&apos;s signing key would produce.
      </p>
      <label className="block text-[11px] text-gray-400">
        Payload body
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          className="mt-1 w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-[11px] font-mono text-gray-200"
        />
      </label>
      <label className="block text-[11px] text-gray-400">
        Received signature
        <input
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          placeholder="sha=..."
          className="mt-1 w-full px-2 py-1.5 bg-lattice-deep border border-lattice-border rounded text-[11px] font-mono text-gray-200"
        />
      </label>
      <button
        onClick={() => void verify()}
        disabled={busy || !body.trim() || !signature.trim()}
        className="btn-secondary text-xs flex items-center gap-1 px-2 py-1 disabled:opacity-40"
      >
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
        Verify
      </button>
      {error && (
        <p className="text-[11px] text-red-400">{error}</p>
      )}
      {result && (
        <div
          data-testid="webhook-signature-result"
          className={`flex items-start gap-2 rounded px-2 py-1.5 text-[11px] ${
            result.valid ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {result.valid ? <ShieldCheck className="w-3.5 h-3.5 shrink-0" /> : <ShieldX className="w-3.5 h-3.5 shrink-0" />}
          <div>
            <p>{result.valid ? 'Signature matches.' : 'Signature does not match.'}</p>
            {!result.valid && (
              <p className="font-mono text-gray-400 mt-0.5">expected: {result.expected}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
