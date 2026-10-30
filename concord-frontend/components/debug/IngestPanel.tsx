'use client';

/**
 * IngestPanel — connect an external app to this project's issue inbox.
 *
 * Wires the `debug` domain macros:
 *   ingest-key-create · ingest-key-list · ingest-key-revoke
 *
 * The raw ingest key is returned exactly once, by ingest-key-create;
 * only its SHA-256 hash is stored server-side. This panel keeps the
 * raw key in component state for the reveal (DSN + snippet + a test
 * event) and drops it when the reveal is dismissed — it is never
 * persisted anywhere in the browser either.
 *
 * The test event is a real envelope POST to the public endpoint with
 * the just-created key in the X-Sentry-Auth header — the same path an
 * external app takes (Review §5e A2's external leg).
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { useDebugProject } from './ProjectContext';
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plug,
  Send,
  X,
} from 'lucide-react';

interface IngestKeyRecord {
  id: string;
  projectId: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface Reveal {
  key: string;
  dsn: string;
  snippet: string;
}

// The endpoint requires an event_id; a fixed one is fine here because
// issue grouping is by error fingerprint — resending the test event
// increments the same issue's count rather than creating new issues.
const TEST_EVENT_ID = 'dec0de00000000000000000000000001';

function buildSnippet(dsn: string, key: string): string {
  return [
    '// Concord Debug ingest — dependency-free error reporter.',
    '// The key below is submit-only: it can post error events to one',
    '// project and read nothing. Keep it in client code as you would',
    '// a Sentry DSN key.',
    `const CONCORD_DSN = "${dsn}";`,
    `const CONCORD_INGEST_KEY = "${key}";`,
    'function concordReport(error) {',
    '  try {',
    '    const eventId = [...crypto.getRandomValues(new Uint8Array(16))]',
    '      .map((b) => b.toString(16).padStart(2, "0")).join("");',
    '    const event = {',
    '      event_id: eventId,',
    '      timestamp: Date.now() / 1000,',
    '      platform: "javascript",',
    '      level: "error",',
    '      exception: { values: [{',
    '        type: (error && error.name) || "Error",',
    '        value: (error && error.message) || String(error),',
    '        stacktrace: { frames: [] },',
    '      }] },',
    '    };',
    '    const envelope =',
    '      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) + "\\n" +',
    '      JSON.stringify({ type: "event", length: JSON.stringify(event).length }) + "\\n" +',
    '      JSON.stringify(event) + "\\n";',
    '    fetch(CONCORD_DSN, {',
    '      method: "POST",',
    '      headers: {',
    '        "Content-Type": "application/x-sentry-envelope",',
    '        "X-Sentry-Auth":',
    '          "Sentry sentry_version=7, sentry_key=" + CONCORD_INGEST_KEY,',
    '      },',
    '      body: envelope,',
    '      keepalive: true,',
    '    }).catch(() => {});',
    '  } catch { /* a reporter must never throw into the host app */ }',
    '}',
    'window.addEventListener("error", (e) => concordReport(e.error || e.message));',
    'window.addEventListener("unhandledrejection", (e) => concordReport(e.reason));',
  ].join('\n');
}

function buildTestEnvelope(): { body: string; eventId: string } {
  const event = {
    event_id: TEST_EVENT_ID,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error',
    environment: 'test-event',
    exception: {
      values: [
        {
          type: 'ConcordTestError',
          value: 'Test event sent from the Debug lens — the ingest path works.',
          stacktrace: {
            frames: [
              { filename: 'ingest-panel.tsx', function: 'onSendTestEvent', lineno: 1, in_app: true },
              { filename: 'app.js', function: 'concordReport', lineno: 12, in_app: true },
            ],
          },
        },
      ],
    },
  };
  const body =
    JSON.stringify({ event_id: TEST_EVENT_ID, sent_at: new Date().toISOString() }) +
    '\n' +
    JSON.stringify({ type: 'event', length: JSON.stringify(event).length }) +
    '\n' +
    JSON.stringify(event) +
    '\n';
  return { body, eventId: TEST_EVENT_ID };
}

export function IngestPanel({ onIngested }: { onIngested?: () => void }) {
  const { projectId } = useDebugProject();
  const [keys, setKeys] = useState<IngestKeyRecord[]>([]);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    const r = await lensRun('debug', 'ingest-key-list', { projectId });
    if (r.data?.ok && r.data.result) {
      setKeys(r.data.result.keys || []);
    } else {
      setError(r.data?.error || 'Failed to load ingest keys');
    }
  }, [projectId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const copy = useCallback(async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied((c) => (c === what ? null : c)), 1500);
    } catch {
      setError('Clipboard unavailable in this browser — copy the text manually.');
    }
  }, []);

  const create = useCallback(async () => {
    if (!projectId) return;
    setBusy('create');
    setError(null);
    const r = await lensRun('debug', 'ingest-key-create', {
      projectId,
      label: label.trim() || undefined,
    });
    setBusy(null);
    if (r.data?.ok && r.data.result?.key) {
      const origin = window.location.origin;
      const dsn = `${origin}${r.data.result.dsnPath}`;
      const key = r.data.result.key as string;
      setReveal({ key, dsn, snippet: buildSnippet(dsn, key) });
      setTestState('idle');
      setLabel('');
      load();
    } else {
      setError(r.data?.error || 'Key creation failed');
    }
  }, [label, load, projectId]);

  const revoke = useCallback(
    async (id: string) => {
      setBusy(id);
      setError(null);
      const r = await lensRun('debug', 'ingest-key-revoke', { id });
      setBusy(null);
      setConfirmRevokeId(null);
      if (r.data?.ok) {
        load();
      } else {
        setError(r.data?.error || 'Revoke failed');
      }
    },
    [load]
  );

  const sendTestEvent = useCallback(async () => {
    if (!reveal) return;
    setTestState('sending');
    const { body } = buildTestEnvelope();
    try {
      const res = await fetch(reveal.dsn, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-sentry-envelope',
          'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${reveal.key}`,
        },
        body,
      });
      if (res.ok) {
        setTestState('sent');
        onIngested?.();
      } else {
        setTestState('failed');
      }
    } catch {
      setTestState('failed');
    }
  }, [reveal, onIngested]);

  return (
    <div className="bg-lattice-deep rounded-lg p-3 border border-lattice-border space-y-3">
      <div>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Plug className="w-3 h-3" /> Connect an External App
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          Your own apps can report errors into this project over a Sentry-compatible
          endpoint. Each key is submit-only — it can post events to this project and
          read nothing — and events are never billed or metered.
        </p>
      </div>

      {/* Existing keys */}
      {keys.length > 0 && (
        <div className="space-y-1.5">
          {keys.map((k) => (
            <div
              key={k.id}
              className="flex items-center gap-2 text-[11px] bg-lattice-surface border border-lattice-border rounded px-2 py-1.5"
            >
              <KeyRound className={`w-3 h-3 shrink-0 ${k.revokedAt ? 'text-gray-600' : 'text-neon-cyan'}`} />
              <span className="text-gray-200 truncate">{k.label}</span>
              <span className="font-mono text-gray-500 shrink-0">{k.prefix}</span>
              <span className="text-gray-500 shrink-0 ml-auto hidden sm:block">
                {k.revokedAt
                  ? `revoked ${new Date(k.revokedAt).toLocaleDateString()}`
                  : k.lastUsedAt
                    ? `last used ${new Date(k.lastUsedAt).toLocaleString()}`
                    : 'never used'}
              </span>
              {!k.revokedAt &&
                (confirmRevokeId === k.id ? (
                  <span className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => revoke(k.id)}
                      disabled={busy === k.id}
                      className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40"
                    >
                      {busy === k.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm'}
                    </button>
                    <button
                      onClick={() => setConfirmRevokeId(null)}
                      className="px-1.5 py-0.5 rounded text-gray-400 hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setConfirmRevokeId(k.id)}
                    className="shrink-0 text-red-400 hover:underline"
                  >
                    Revoke
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Create */}
      <div className="flex items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Key label (e.g. storefront web app)"
          className="flex-1 px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded text-xs"
        />
        <button
          onClick={create}
          disabled={!projectId || busy === 'create'}
          className="px-3 py-1.5 text-xs rounded bg-neon-cyan/15 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/25 disabled:opacity-50 flex items-center gap-1.5 shrink-0"
        >
          {busy === 'create' ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <KeyRound className="w-3 h-3" />
          )}
          Create Ingest Key
        </button>
      </div>

      {/* One-time reveal */}
      {reveal && (
        <div className="rounded border border-neon-cyan/30 bg-neon-cyan/[0.04] p-3 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] text-neon-cyan font-medium">
              Store this key now — it isn&apos;t shown again.
            </p>
            <button
              onClick={() => setReveal(null)}
              className="text-gray-400 hover:text-white shrink-0"
              title="Dismiss (key is gone from this panel for good)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            Only the key&apos;s hash is kept on the server, so neither this panel nor
            support can recover it. Lost it? Create a new key and revoke the old one.
          </p>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">Ingest key</p>
              <button
                onClick={() => copy('key', reveal.key)}
                className="text-[10px] text-neon-cyan hover:underline flex items-center gap-1"
              >
                {copied === 'key' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'key' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="font-mono text-[11px] text-gray-200 break-all bg-lattice-surface rounded px-2 py-1.5 mt-1">
              {reveal.key}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">DSN (endpoint)</p>
              <button
                onClick={() => copy('dsn', reveal.dsn)}
                className="text-[10px] text-neon-cyan hover:underline flex items-center gap-1"
              >
                {copied === 'dsn' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'dsn' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="font-mono text-[11px] text-gray-200 break-all bg-lattice-surface rounded px-2 py-1.5 mt-1">
              {reveal.dsn}
            </p>
            <p className="text-[10px] text-gray-500 mt-1">
              Using a Sentry SDK instead? Build its DSN as
              https://&lt;key&gt;@&lt;this host&gt;/api/debug/ingest/&lt;project id&gt; —
              the SDK sends the key in the X-Sentry-Auth header.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400 uppercase tracking-wider">
                Or drop in this snippet (no SDK)
              </p>
              <button
                onClick={() => copy('snippet', reveal.snippet)}
                className="text-[10px] text-neon-cyan hover:underline flex items-center gap-1"
              >
                {copied === 'snippet' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copied === 'snippet' ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="bg-lattice-surface p-2 rounded text-[10px] text-gray-300 overflow-auto max-h-48 font-mono mt-1">
              {reveal.snippet}
            </pre>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={sendTestEvent}
              disabled={testState === 'sending' || testState === 'sent'}
              className="px-3 py-1.5 text-xs rounded bg-neon-green/15 border border-neon-green/30 text-neon-green hover:bg-neon-green/25 disabled:opacity-50 flex items-center gap-1.5"
            >
              {testState === 'sending' ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Send className="w-3 h-3" />
              )}
              {testState === 'sent' ? 'Test Event Sent' : 'Send Test Event'}
            </button>
            {testState === 'sent' && (
              <p className="text-[11px] text-gray-400">
                It&apos;s in the list below as <span className="font-mono">ConcordTestError</span> —
                refresh if it hasn&apos;t appeared yet.
              </p>
            )}
            {testState === 'failed' && (
              <p className="text-[11px] text-red-400">
                The endpoint didn&apos;t accept the test event — check the deployment and try a fresh key.
              </p>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
