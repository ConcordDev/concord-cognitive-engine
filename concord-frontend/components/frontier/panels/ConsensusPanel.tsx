'use client';

/**
 * ConsensusPanel — Wave W2-C, `mesh.consensusStatus` + `consensusAppend` +
 * `consensusMergeRemote` + `consensusState` + `consensusEquivocation`.
 *
 * Reference app (per docs/UI_QUALITY_RUBRIC.md §0 — name one, adopt its
 * exact interaction language): GIT's own commit-graph tooling —
 * `git log --graph --oneline` for the linearized head/order view and
 * `git cat-file -p` for inspecting one content-addressed object. A
 * hash-DAG IS git's data model (parent-hash-linked, content-addressed,
 * signed nodes), so this panel reads as a REPL transcript over that same
 * kind of object graph: every action appends one real entry to a running
 * log, each entry inspectable, never a single static result blob.
 *
 * HONEST ARCHITECTURAL FINDING (verified against server/domains/mesh.js +
 * server/lib/consensus/hash-dag.js + server/tests/hash-dag.test.js): a
 * node's identity is pinned server-side to the authenticated caller
 * (`ctx.actor.userId`), the signing key never leaves the server, and
 * `consensusAppend` always uses the CURRENT heads as parents — there is no
 * way to make it re-use an older parent. Genuine equivocation (one signer
 * producing two conflicting messages at the SAME causal position) requires
 * an attacker who already holds the signing key, deliberately reusing
 * old parents — precisely what this API structurally prevents an honest
 * caller from doing to themselves. So `consensusEquivocation` against a
 * session built only from real `consensusAppend`/`consensusMergeRemote`
 * calls will ALWAYS return zero evidence — correctly. What IS genuinely
 * demonstrable end-to-end is the DAG's tamper/authenticity defense: take a
 * real signed record this session produced, edit its payload value (one
 * structured field, never a raw JSON paste), and merge it back in — the
 * hash no longer matches the signed content, so `consensusMergeRemote`
 * legitimately rejects it with `hash_mismatch` before it can ever be
 * integrated. This panel shows both real outcomes plainly, including the
 * "zero evidence" case, with the architectural reason spelled out rather
 * than papered over with a fabricated multi-node scenario.
 */

import { useEffect, useState } from 'react';
import { ds } from '@/lib/design-system';
import { cn } from '@/lib/utils';
import { lensRun } from '@/lib/api/client';
import { useLensCommand } from '@/hooks/useLensCommand';
import { ComputeCell, VerifyCell, BoundaryCell, type VerifyStatus } from '@/components/frontier/FrontierEngineShell';
import type { FrontierEngineDef } from '@/lib/frontier-engines';

type ActionId = 'append' | 'merge' | 'state' | 'equivocation';

const ACTION_LABEL: Record<ActionId, string> = {
  append: 'Append an update',
  merge: 'Re-merge a record (test tamper detection)',
  state: 'Read materialized state',
  equivocation: 'Check for equivocation',
};

const ACTION_MACRO: Record<ActionId, string> = {
  append: 'consensusAppend',
  merge: 'consensusMergeRemote',
  state: 'consensusState',
  equivocation: 'consensusEquivocation',
};

interface ConsensusStatus {
  nodeId: string;
  publicKeyPem: string;
  heads: string[];
  size: number;
  deferred: number;
  knownAuthors: number;
}
interface SignedRecord {
  nodeId: string;
  payload: { key: string; value: unknown };
  parents: string[];
  vectorClock: Record<string, number>;
  signature: string;
  publicKeyPem: string;
  hash: string;
}
interface AppendResult { record: SignedRecord; heads: string[]; size: number }
interface MergeOutcome {
  ok: boolean;
  duplicate?: boolean;
  integrated?: boolean;
  deferred?: boolean;
  missingParents?: string[];
  error?: string;
  hash?: string;
  expected?: string;
  claimed?: string;
}
interface MergeResult { merge: MergeOutcome; heads: string[]; size: number; deferred: number }
interface StateResult { order: string[]; state: Record<string, unknown>; heads: string[]; size: number }
interface EquivocationEvidence { nodeId: string; positionKey: string; conflicting: SignedRecord[] }
interface EquivocationResult { evidence: EquivocationEvidence[]; count: number }

type HistoryEntry =
  | { kind: 'append'; input: { key: string; value: string }; output: AppendResult }
  | { kind: 'merge'; input: { tampered: boolean; sourceHash: string }; output: MergeResult }
  | { kind: 'state'; output: StateResult }
  | { kind: 'equivocation'; output: EquivocationResult };

function short(hash: string): string {
  return hash ? `${hash.slice(0, 10)}…` : '—';
}

export function ConsensusPanel({ engine }: { engine: FrontierEngineDef }) {
  const [action, setAction] = useState<ActionId>('append');
  const [key, setKey] = useState('balance:alice');
  const [value, setValue] = useState('paid');
  const [records, setRecords] = useState<SignedRecord[]>([]);
  const [selectedHash, setSelectedHash] = useState('');
  const [tamper, setTamper] = useState(false);
  const [tamperedValue, setTamperedValue] = useState('TAMPERED');
  const [scopeToSelf, setScopeToSelf] = useState(true);

  const [myStatus, setMyStatus] = useState<ConsensusStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [status, setStatus] = useState<VerifyStatus>('idle');
  const [reason, setReason] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [runCount, setRunCount] = useState(0);

  async function refreshStatus() {
    try {
      const res = await lensRun<ConsensusStatus>('mesh', 'consensusStatus', {});
      if (res.data?.ok && res.data.result) {
        setMyStatus(res.data.result);
        setStatusError(null);
      } else {
        setStatusError(res.data?.error || 'Could not load node status.');
      }
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { void refreshStatus(); }, []);

  async function run() {
    setStatus('loading');
    setReason(null);
    try {
      if (action === 'append') {
        const trimmed = key.trim();
        if (!trimmed) { setReason('A key is required.'); setStatus('refused'); return; }
        const res = await lensRun<AppendResult>('mesh', 'consensusAppend', { key: trimmed, value });
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(res.data?.error || 'Unknown refusal.');
          setStatus('error');
          return;
        }
        setRecords((r) => [...r, res.data.result!.record]);
        setSelectedHash(res.data.result.record.hash);
        setHistory((h) => [...h, { kind: 'append', input: { key: trimmed, value }, output: res.data.result! }]);
        setStatus('ok');
        void refreshStatus();
      } else if (action === 'merge') {
        const source = records.find((r) => r.hash === selectedHash);
        if (!source) { setReason('Append at least one update first, then pick it to re-merge.'); setStatus('refused'); return; }
        const record: SignedRecord = tamper
          ? { ...source, payload: { ...source.payload, value: tamperedValue } }
          : source;
        const res = await lensRun<MergeResult>('mesh', 'consensusMergeRemote', { record });
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(res.data?.error || 'Unknown refusal.');
          setStatus('error');
          return;
        }
        setHistory((h) => [...h, { kind: 'merge', input: { tampered: tamper, sourceHash: source.hash }, output: res.data.result! }]);
        setStatus('ok');
        void refreshStatus();
      } else if (action === 'state') {
        const res = await lensRun<StateResult>('mesh', 'consensusState', {});
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(res.data?.error || 'Unknown refusal.');
          setStatus('error');
          return;
        }
        setHistory((h) => [...h, { kind: 'state', output: res.data.result! }]);
        setStatus('ok');
      } else {
        const input: Record<string, unknown> = scopeToSelf && myStatus ? { nodeId: myStatus.nodeId } : {};
        const res = await lensRun<EquivocationResult>('mesh', 'consensusEquivocation', input);
        setRunCount((n) => n + 1);
        if (!res.data?.ok || !res.data.result) {
          setReason(res.data?.error || 'Unknown refusal.');
          setStatus('error');
          return;
        }
        setHistory((h) => [...h, { kind: 'equivocation', output: res.data.result! }]);
        setStatus('ok');
      }
    } catch (e) {
      setReason(e instanceof Error ? e.message : String(e));
      setStatus('error');
    }
  }

  useLensCommand(
    [{ id: 'run-consensus-action', keys: 'mod+enter', description: 'Run selected consensus action', category: 'actions', action: run }],
    { lensId: 'frontier' },
  );

  const runDisabled =
    (action === 'append' && key.trim() === '')
    || (action === 'merge' && records.length === 0);

  return (
    <div className="space-y-8">
      <ComputeCell
        cellNumber={1}
        macroLabel={`mesh.${ACTION_MACRO[action]}`}
        running={status === 'loading'}
        onRun={run}
        runLabel="Run"
        runDisabled={runDisabled}
        hotkey="⌘+Enter"
      >
        <div className={cn(ds.monoXs, 'flex flex-wrap gap-x-4 gap-y-1 text-gray-500 border-b border-lattice-border pb-3')}>
          {myStatus ? (
            <>
              <span>node <span className="text-gray-300">{short(myStatus.nodeId)}</span></span>
              <span>heads <span className="text-gray-300">{myStatus.heads.length ? myStatus.heads.map(short).join(', ') : '(none yet)'}</span></span>
              <span>size <span className="text-gray-300">{myStatus.size}</span></span>
              <span>deferred <span className="text-gray-300">{myStatus.deferred}</span></span>
              <span>known authors <span className="text-gray-300">{myStatus.knownAuthors}</span></span>
            </>
          ) : statusError ? (
            <span className="text-amber-400">Could not load node status: {statusError}</span>
          ) : (
            <span>Loading node status…</span>
          )}
        </div>

        <div>
          <label className={ds.label} htmlFor="consensus-action">Action</label>
          <select
            id="consensus-action"
            className={ds.select}
            value={action}
            onChange={(e) => setAction(e.target.value as ActionId)}
          >
            {(Object.keys(ACTION_LABEL) as ActionId[]).map((id) => (
              <option key={id} value={id}>{ACTION_LABEL[id]}</option>
            ))}
          </select>
        </div>

        {action === 'append' && (
          <div className={ds.grid2}>
            <div>
              <label className={ds.label} htmlFor="consensus-key">Key</label>
              <input id="consensus-key" type="text" className={ds.input} value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            <div>
              <label className={ds.label} htmlFor="consensus-value">Value</label>
              <input id="consensus-value" type="text" className={ds.input} value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
          </div>
        )}

        {action === 'merge' && (
          <div className="space-y-3">
            <div>
              <label className={ds.label} htmlFor="consensus-record">Record to re-submit (from your own real appends this session)</label>
              <select
                id="consensus-record"
                className={ds.select}
                value={selectedHash}
                onChange={(e) => setSelectedHash(e.target.value)}
                disabled={records.length === 0}
              >
                {records.length === 0 && <option value="">Append an update first</option>}
                {records.map((r) => (
                  <option key={r.hash} value={r.hash}>
                    {short(r.hash)} — {r.payload.key} = {String(r.payload.value)}
                  </option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={tamper} onChange={(e) => setTamper(e.target.checked)} />
              Tamper the value before re-merging (simulates a Byzantine-modified record — expect a real hash_mismatch rejection)
            </label>
            {tamper && (
              <div>
                <label className={ds.label} htmlFor="consensus-tampered-value">Tampered value</label>
                <input
                  id="consensus-tampered-value"
                  type="text"
                  className={ds.input}
                  value={tamperedValue}
                  onChange={(e) => setTamperedValue(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {action === 'equivocation' && (
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={scopeToSelf} onChange={(e) => setScopeToSelf(e.target.checked)} />
            Scope to my own node id only ({myStatus ? short(myStatus.nodeId) : 'unknown until status loads'}) — uncheck to scan every author this replica has seen
          </label>
        )}
      </ComputeCell>

      <VerifyCell cellNumber={2} status={runCount === 0 ? 'idle' : status} reason={reason}>
        {history.length > 0 && (
          <div className={cn(ds.monoXs, 'space-y-3')}>
            {history.map((h, i) => (
              <HistoryRow key={i} index={i + 1} entry={h} />
            ))}
          </div>
        )}
      </VerifyCell>

      <BoundaryCell cellNumber="B" text={engine.boundary ?? ''} source={engine.boundarySource} />
    </div>
  );
}

function HistoryRow({ index, entry }: { index: number; entry: HistoryEntry }) {
  if (entry.kind === 'append') {
    return (
      <div className="border-l-2 border-l-lattice-border pl-2">
        <div className="text-gray-500">[{index}] consensusAppend({entry.input.key} = {entry.input.value})</div>
        <div className="text-emerald-400">
          → new head {short(entry.output.record.hash)}, parents [{entry.output.record.parents.map(short).join(', ') || 'none — genesis'}], DAG size {entry.output.size}
        </div>
      </div>
    );
  }
  if (entry.kind === 'merge') {
    const m = entry.output.merge;
    const rejected = m.ok === false && !!m.error;
    return (
      <div className="border-l-2 border-l-lattice-border pl-2">
        <div className="text-gray-500">
          [{index}] consensusMergeRemote({short(entry.input.sourceHash)}{entry.input.tampered ? ', value tampered' : ''})
        </div>
        {rejected ? (
          <div className="text-red-400">
            → REJECTED: {m.error}
            {m.error === 'hash_mismatch' && (
              <span className="block text-gray-400">
                expected hash {short(m.expected || '')}, claimed {short(m.claimed || '')} — the tampered payload no longer matches its own signed hash, so it was refused before integration.
              </span>
            )}
          </div>
        ) : m.duplicate ? (
          <div className="text-amber-400">→ duplicate — already integrated, no-op (idempotent re-delivery)</div>
        ) : (
          <div className="text-emerald-400">→ integrated. DAG size {entry.output.size}</div>
        )}
      </div>
    );
  }
  if (entry.kind === 'state') {
    return (
      <div className="border-l-2 border-l-lattice-border pl-2">
        <div className="text-gray-500">[{index}] consensusState()</div>
        <div className="text-gray-300">order (git-log-style, oldest→newest): {entry.output.order.map(short).join(' → ') || '(empty)'}</div>
        <pre className="mt-1 p-2 rounded border border-lattice-border bg-lattice-surface overflow-x-auto">
          {JSON.stringify(entry.output.state, null, 2)}
        </pre>
      </div>
    );
  }
  // equivocation
  return (
    <div className="border-l-2 border-l-lattice-border pl-2">
      <div className="text-gray-500">[{index}] consensusEquivocation()</div>
      {entry.output.count === 0 ? (
        <div className="text-emerald-400">
          → 0 evidence. Every message in this replica came from a real appendUpdate off the then-current heads (or was
          honestly rejected before integration) — a single identity cannot equivocate against itself through this API,
          so &quot;none found&quot; is the correct, expected answer here, not an untested code path.
        </div>
      ) : (
        <div className="text-red-400 space-y-1">
          <div>→ {entry.output.count} equivocation(s) detected:</div>
          {entry.output.evidence.map((ev, i) => (
            <div key={i} className="pl-2 text-gray-300">
              node {short(ev.nodeId)} at position {short(ev.positionKey)}: {ev.conflicting.length} conflicting records
              ({ev.conflicting.map((c) => short(c.hash)).join(', ')})
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ConsensusPanel;
