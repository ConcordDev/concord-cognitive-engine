'use client';

import { useState, type CSSProperties } from 'react';

type Verdict = {
  valid: boolean;
  reason: string | null;
  keyId?: string;
  digest?: string;
};

const OFFLINE = `import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

// node verify-receipt.mjs receipt.json concord-receipt-keys.json
const receipt = JSON.parse(readFileSync(process.argv[2], "utf8"));
const keys = JSON.parse(readFileSync(process.argv[3], "utf8")).keys;
const { signature: block, ...body } = receipt;
if (!block || block.signature == null) {
  console.log("unsigned:", block?.reason || "missing signature");
  process.exit(1);
}
const canonical = canon(body);
const digest = createHash("sha256").update(canonical).digest("hex");
if (digest !== block.digest) throw new Error("digest_mismatch");
const raw = Buffer.from(keys[block.keyId], "base64");
if (raw.length !== 32) throw new Error("unknown_key");
const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
const pub = createPublicKey({ key: spki, format: "der", type: "spki" });
const ok = verify(null, Buffer.from(canonical), pub, Buffer.from(block.signature, "base64"));
console.log(ok ? "valid" : "invalid");

function canon(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}`;

export default function VerifyReceipt() {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [httpError, setHttpError] = useState<string | null>(null);

  async function onVerify() {
    setParseError(null);
    setHttpError(null);
    setVerdict(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setParseError('That text is not JSON.');
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setParseError('Paste a receipt object, not a list or a bare value.');
      return;
    }
    const receipt = 'receipt' in parsed && parsed.receipt && typeof parsed.receipt === 'object'
      ? parsed.receipt
      : parsed;
    setPending(true);
    try {
      const res = await fetch('/api/receipts/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429) {
        setHttpError('Too many checks from this address. Wait a minute and try again.');
        return;
      }
      // A 403 is the gate refusing the request. It is not a signature verdict,
      // even if the body happens to carry a valid flag.
      if (res.status === 403) {
        const code = data && typeof data === 'object' && 'code' in data ? String(data.code) : '';
        setHttpError(
          code === 'CSRF_FAILED'
            ? 'The server blocked the check (CSRF) before it read the receipt. Nothing was verified.'
            : 'The server refused the check (403). Nothing was verified.',
        );
        return;
      }
      if (!res.ok || !data || typeof data.valid !== 'boolean') {
        setHttpError(data?.reason ? `The server rejected the receipt (${data.reason}).` : `The server returned ${res.status}.`);
        return;
      }
      setVerdict(data as Verdict);
    } catch {
      setHttpError('The verify request did not reach the server.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main style={page}>
      <header style={{ marginBottom: 28 }}>
        <p style={kicker}>Concord receipts</p>
        <h1 style={title}>Verify a receipt</h1>
        <p style={lede}>
          Paste the JSON a ConKay job returned. This page asks the server whether the Ed25519
          signature matches the receipt body. Nothing you paste is stored.
        </p>
      </header>

      <label htmlFor="receipt-json" style={label}>Receipt JSON</label>
      <textarea
        id="receipt-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        placeholder='{ "solver": "fea-solver@5.0.0", "issuedAt": "...", "signature": { ... } }'
        style={area}
      />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 12 }}>
        <button type="button" onClick={onVerify} disabled={pending || text.trim() === ''} style={button}>
          {pending ? 'Checking…' : 'Verify'}
        </button>
        <span style={hint}>POST /api/receipts/verify</span>
      </div>

      {parseError && <p role="alert" style={errorText}>{parseError}</p>}
      {httpError && <p role="alert" style={errorText}>{httpError}</p>}
      {verdict && (
        <section role="status" aria-live="polite" style={{ ...panel, borderColor: verdict.valid ? 'var(--accent-primary)' : 'var(--accent-warm)' }}>
          <p style={{ ...verdictWord, color: verdict.valid ? 'var(--accent-primary)' : 'var(--accent-warm)' }}>
            {verdict.valid ? 'Valid' : 'Invalid'}
          </p>
          <dl style={facts}>
            <dt>Reason</dt>
            <dd>{verdict.reason ?? 'signature matches the canonical receipt'}</dd>
            {verdict.keyId && (<><dt>Key id</dt><dd><code>{verdict.keyId}</code></dd></>)}
            {verdict.digest && (<><dt>Digest</dt><dd><code style={monoWrap}>{verdict.digest}</code></dd></>)}
          </dl>
        </section>
      )}

      <section style={{ ...panel, marginTop: 28 }}>
        <h2 style={h2}>Check it offline, with only the public key</h2>
        <p style={prose}>
          The signed bytes are the receipt with the <code>signature</code> property removed.
          Canonical form is UTF-8 JSON: object keys sorted lexicographically, arrays left in
          order, no extra whitespace. <code>signature.digest</code> is the SHA-256 hex of those
          bytes. <code>signature.signature</code> is an Ed25519 signature of the same bytes,
          standard base64. <code>signature.keyId</code> selects the key.
        </p>
        <p style={prose}>
          Public keys are published at{' '}
          <a href="/.well-known/concord-receipt-keys.json" style={link}>/.well-known/concord-receipt-keys.json</a>
          {' '}as <code>keys[keyId]</code>, each value the raw 32-byte public key in base64.
          The key id is the first 16 hex characters of SHA-256 of those 32 bytes. A receipt
          with <code>signature.signature</code> set to null was issued while the server had no
          signing key; <code>signature.reason</code> says why. That receipt is not valid.
        </p>
        <p style={prose}>
          Save the receipt and the key document, then run this with Node. It uses only
          <code> node:crypto</code>. No Concord server and no private key.
        </p>
        <pre style={pre}><code>{OFFLINE}</code></pre>
      </section>
    </main>
  );
}

const page: CSSProperties = {
  maxWidth: 760,
  margin: '0 auto',
  padding: '48px 20px 80px',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-body)',
};

const kicker: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

const title: CSSProperties = {
  margin: '8px 0 12px',
  fontFamily: 'var(--font-display)',
  fontSize: 36,
  fontWeight: 560,
  letterSpacing: '-0.02em',
};

const lede: CSSProperties = {
  margin: 0,
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
  maxWidth: 62 * 8,
};

const label: CSSProperties = {
  display: 'block',
  marginTop: 28,
  marginBottom: 8,
  fontSize: 13,
  color: 'var(--text-secondary)',
};

const area: CSSProperties = {
  width: '100%',
  minHeight: 220,
  resize: 'vertical',
  boxSizing: 'border-box',
  padding: 14,
  borderRadius: 10,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 13,
  lineHeight: 1.45,
};

const button: CSSProperties = {
  appearance: 'none',
  border: 0,
  borderRadius: 8,
  padding: '10px 16px',
  background: 'var(--accent-primary)',
  color: 'var(--bg-base)',
  fontWeight: 600,
  cursor: 'pointer',
};

const hint: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  color: 'var(--text-tertiary)',
};

const errorText: CSSProperties = {
  color: 'var(--accent-warm)',
  marginTop: 16,
};

const panel: CSSProperties = {
  marginTop: 20,
  padding: 16,
  borderRadius: 12,
  border: '1px solid var(--border-default)',
  background: 'var(--bg-surface)',
};

const verdictWord: CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
};

const facts: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '88px 1fr',
  gap: '6px 12px',
  margin: '12px 0 0',
  fontSize: 14,
};

const monoWrap: CSSProperties = {
  wordBreak: 'break-all',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
};

const h2: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18,
  fontWeight: 600,
};

const prose: CSSProperties = {
  margin: '8px 0',
  color: 'var(--text-secondary)',
  lineHeight: 1.55,
  fontSize: 14,
};

const link: CSSProperties = {
  color: 'var(--accent-cool)',
};

const pre: CSSProperties = {
  margin: '14px 0 0',
  padding: 14,
  overflow: 'auto',
  borderRadius: 10,
  background: 'var(--bg-base)',
  border: '1px solid var(--border-subtle)',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--text-primary)',
};
