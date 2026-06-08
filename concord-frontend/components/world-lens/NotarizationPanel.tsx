// @env-config-ok: block-explorer links (basescan/arbiscan)
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChainId = 'base' | 'arbitrum' | 'polygon';
type NotarizationStatus = 'idle' | 'pending' | 'confirmed' | 'failed';
type VerifyResult = 'idle' | 'checking' | 'verified' | 'not-found';

interface ChainOption {
  id: ChainId;
  name: string;
  icon: string;
  color: string;
  estimatedCost: string;
  confirmations: number;
  explorer: string;
}

// A real notary record from the backend `notary` domain: a genuine SHA-256
// content hash + an honest local hash-chain (prevHash). NOT a blockchain — there
// is no transaction hash, no block number. The proof is the content hash itself.
interface NotarizationRecord {
  id: string;
  contentHash: string;
  prevHash: string | null;
  notarizedAt: string;
  title: string;
}

// ---------------------------------------------------------------------------
// Chain configuration (static scaffolding — block-explorer endpoints, not data)
//
// NOTE: The notarize/verify actions are wired to the REAL backend `notary`
// domain (SHA-256 content hash + honest local hash-chain). The chain selector
// below is presentational — there is no on-chain anchoring; we NEVER fabricate a
// transaction hash. The proof surfaced is the genuine content hash.
// ---------------------------------------------------------------------------

const CHAINS: ChainOption[] = [
  {
    id: 'base',
    name: 'Base',
    icon: '🔵',
    color: 'border-blue-500 bg-blue-500/10 text-blue-300',
    estimatedCost: '~$0.002',
    confirmations: 12,
    explorer: 'https://basescan.org/tx/',
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    icon: '🔷',
    color: 'border-sky-500 bg-sky-500/10 text-sky-300',
    estimatedCost: '~$0.005',
    confirmations: 20,
    explorer: 'https://arbiscan.io/tx/',
  },
  {
    id: 'polygon',
    name: 'Polygon',
    icon: '🟣',
    color: 'border-purple-500 bg-purple-500/10 text-purple-300',
    estimatedCost: '~$0.001',
    confirmations: 30,
    explorer: 'https://polygonscan.com/tx/',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

function truncateHash(hash: string, start = 6, end = 4): string {
  if (hash.length <= start + end + 3) return hash;
  return `${hash.slice(0, start)}...${hash.slice(-end)}`;
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${color}`}>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NotarizationPanel() {
  // State
  const [selectedChain, setSelectedChain] = useState<ChainId>('base');
  const [notarizeStatus, setNotarizeStatus] = useState<NotarizationStatus>('idle');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [notarizeContent, setNotarizeContent] = useState('');
  const [lastRecord, setLastRecord] = useState<NotarizationRecord | null>(null);
  const [notarizeError, setNotarizeError] = useState<string | null>(null);

  const [verifyRecordId, setVerifyRecordId] = useState('');
  const [verifyContent, setVerifyContent] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult>('idle');
  const [verifyDetail, setVerifyDetail] = useState<{ expectedHash: string; actualHash: string } | null>(null);

  // Real backend-backed history (notary domain, per-user, newest-first).
  const [records, setRecords] = useState<NotarizationRecord[]>([]);

  const loadRecords = useCallback(async () => {
    const res = await lensRun<{ records?: NotarizationRecord[] }>('notary', 'records-list', {});
    if (res.data.ok && res.data.result?.records) setRecords(res.data.result.records);
  }, []);

  // Load real records on mount.
  useEffect(() => { void loadRecords(); }, [loadRecords]);

  // Handlers
  const initiateNotarize = () => {
    if (!notarizeContent.trim()) return;
    setShowConfirmDialog(true);
  };

  const confirmNotarize = async () => {
    setShowConfirmDialog(false);
    setNotarizeStatus('pending');
    setNotarizeError(null);
    setLastRecord(null);
    const res = await lensRun<{ record?: NotarizationRecord }>('notary', 'notarize', {
      content: notarizeContent,
      title: notarizeContent.slice(0, 48),
    });
    if (res.data.ok && res.data.result?.record) {
      setLastRecord(res.data.result.record);
      setNotarizeStatus('confirmed');
      void loadRecords();
    } else {
      setNotarizeError(res.data.error || 'Notarization failed.');
      setNotarizeStatus('failed');
    }
  };

  const resetNotarize = () => {
    setNotarizeStatus('idle');
    setLastRecord(null);
    setNotarizeError(null);
    setNotarizeContent('');
  };

  const runVerification = async () => {
    if (!verifyRecordId.trim()) return;
    setVerifyResult('checking');
    setVerifyDetail(null);
    const res = await lensRun<{ valid?: boolean; expectedHash?: string; actualHash?: string }>(
      'notary',
      'verify',
      { recordId: verifyRecordId.trim(), content: verifyContent },
    );
    if (res.data.ok && res.data.result) {
      const { valid, expectedHash, actualHash } = res.data.result;
      if (expectedHash && actualHash) setVerifyDetail({ expectedHash, actualHash });
      setVerifyResult(valid ? 'verified' : 'not-found');
    } else {
      setVerifyResult('not-found');
    }
  };

  return (
    <div className={`${panel} p-5 space-y-5 text-white max-w-xl`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Notarization</h2>
        <Badge color="bg-purple-600/80 text-purple-100">SHA-256 Proof</Badge>
      </div>
      <p className="text-sm text-white/50">
        Compute a real SHA-256 content hash and anchor it to an honest local
        hash-chain for tamper-evident proof of existence.
      </p>

      {/* Chain Selector */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Target Chain
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {CHAINS.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedChain(c.id)}
              className={`p-3 rounded-lg border text-center transition-all ${
                selectedChain === c.id ? c.color : 'border-white/10 bg-white/5 hover:border-white/25'
              }`}
            >
              <div className="text-xl mb-1">{c.icon}</div>
              <div className="text-sm font-semibold">{c.name}</div>
              <div className="text-[11px] text-white/40 mt-0.5">{c.estimatedCost}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Notarize Action */}
      <section className="space-y-3">
        {notarizeStatus === 'idle' && (
          <>
            <textarea
              value={notarizeContent}
              onChange={e => setNotarizeContent(e.target.value)}
              placeholder="Paste the content to notarize..."
              rows={4}
              className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-2 text-xs font-mono text-white placeholder:text-white/20 focus:border-cyan-500 outline-none resize-y"
            />
            <button
              onClick={initiateNotarize}
              disabled={!notarizeContent.trim()}
              className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed font-semibold text-sm transition-colors"
            >
              Notarize
            </button>
          </>
        )}

        {/* Confirmation dialog */}
        {showConfirmDialog && (
          <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-900/10 space-y-3">
            <p className="text-sm text-yellow-200">
              This computes a real SHA-256 hash of the content and links it into
              your local hash-chain. No blockchain transaction is created.
            </p>
            <div className="flex gap-2">
              <button
                onClick={confirmNotarize}
                className="flex-1 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-sm font-semibold transition-colors"
              >
                Confirm
              </button>
              <button
                onClick={() => setShowConfirmDialog(false)}
                className="flex-1 py-2 rounded-lg border border-white/10 text-sm text-white/50 hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Progress state */}
        {notarizeStatus === 'pending' && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <Spinner />
            <span className="text-sm text-white/70">Hashing and anchoring...</span>
          </div>
        )}

        {notarizeStatus === 'confirmed' && lastRecord && (
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-900/10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-lg">&#10003;</span>
              <span className="text-sm font-semibold text-green-300">
                Notarized
              </span>
            </div>

            <div className="text-xs space-y-1.5">
              <div>
                <span className="text-white/30">Record ID: </span>
                <span className="font-mono text-cyan-400 break-all">{lastRecord.id}</span>
              </div>
              <div>
                <span className="text-white/30">Content Hash: </span>
                <span className="font-mono text-white/70 break-all">{lastRecord.contentHash}</span>
              </div>
              <div>
                <span className="text-white/30">Prev Hash: </span>
                <span className="font-mono text-white/50">
                  {lastRecord.prevHash ? truncateHash(lastRecord.prevHash, 12, 6) : '(chain start)'}
                </span>
              </div>
            </div>

            <button
              onClick={resetNotarize}
              className="w-full py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              New Notarization
            </button>
          </div>
        )}

        {notarizeStatus === 'failed' && (
          <div className="p-4 rounded-lg border border-red-500/30 bg-red-900/10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-red-400 text-lg">&#10007;</span>
              <span className="text-sm font-semibold text-red-300">
                Notarization failed
              </span>
            </div>
            <p className="text-xs text-white/50">
              {notarizeError || 'No record was created.'}
            </p>
            <button
              onClick={resetNotarize}
              className="w-full py-1.5 rounded-lg border border-white/10 text-xs text-white/50 hover:text-white/80 transition-colors"
            >
              Dismiss
            </button>
          </div>
        )}
      </section>

      {/* Verification Panel */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Verify Content
        </h3>
        <input
          type="text"
          value={verifyRecordId}
          onChange={e => {
            setVerifyRecordId(e.target.value);
            setVerifyResult('idle');
          }}
          placeholder="Record ID (e.g. ntr_...)"
          className="w-full bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-xs font-mono text-white placeholder:text-white/20 focus:border-cyan-500 outline-none"
        />
        <div className="flex gap-2">
          <textarea
            value={verifyContent}
            onChange={e => {
              setVerifyContent(e.target.value);
              setVerifyResult('idle');
            }}
            placeholder="Paste the content to verify against the record..."
            rows={3}
            className="flex-1 bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-xs font-mono text-white placeholder:text-white/20 focus:border-cyan-500 outline-none resize-y"
          />
          <button
            onClick={runVerification}
            disabled={verifyResult === 'checking' || !verifyRecordId.trim()}
            className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-semibold transition-colors self-start"
          >
            Verify
          </button>
        </div>

        {verifyResult === 'checking' && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Spinner /> Recomputing hash...
          </div>
        )}
        {verifyResult === 'verified' && (
          <div className="p-2 rounded-lg bg-green-900/20 border border-green-500/20 text-xs text-green-300 flex items-center gap-2">
            <span className="text-green-400">&#10003;</span>
            Content matches the notarized hash. Integrity verified.
          </div>
        )}
        {verifyResult === 'not-found' && (
          <div className="p-2 rounded-lg bg-red-900/20 border border-red-500/20 text-xs text-red-300 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-red-400">&#10007;</span>
              Content does NOT match the notarized hash (or record not found).
            </div>
            {verifyDetail && (
              <div className="font-mono text-[10px] text-white/40 break-all">
                expected {truncateHash(verifyDetail.expectedHash, 10, 6)} · got{' '}
                {truncateHash(verifyDetail.actualHash, 10, 6)}
              </div>
            )}
          </div>
        )}
      </section>

      {/* History */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">
          Notarization History
        </h3>
        <div className="space-y-2">
          {records.length === 0 && (
            <p className="text-sm text-white/30 py-4 text-center">
              No notarization records yet.
            </p>
          )}
          {records.map(record => (
            <div
              key={record.id}
              className="p-3 rounded-lg border border-white/10 bg-white/5 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold truncate">{record.title}</span>
                <Badge color="bg-green-600/40 text-green-300">notarized</Badge>
              </div>
              <div className="text-[11px] text-white/40 space-y-0.5">
                <div>
                  <span className="text-white/30">Record: </span>
                  <span className="font-mono text-cyan-400">{record.id}</span>
                </div>
                <div>
                  <span className="text-white/30">Content Hash: </span>
                  <span className="font-mono text-white/50">
                    {truncateHash(record.contentHash, 12, 6)}
                  </span>
                </div>
                <div>
                  <span className="text-white/30">Prev: </span>
                  <span className="font-mono text-white/40">
                    {record.prevHash ? truncateHash(record.prevHash, 10, 6) : '(chain start)'}
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-white/25">
                {new Date(record.notarizedAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
