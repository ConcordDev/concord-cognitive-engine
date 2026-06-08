// @env-config-ok: block-explorer links (basescan/arbiscan)
'use client';

import React, { useState, useMemo } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChainId = 'base' | 'arbitrum' | 'polygon';
type NotarizationStatus = 'idle' | 'pending' | 'confirming' | 'confirmed' | 'failed';
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

interface NotarizationRecord {
  id: string;
  dtuId: string;
  chain: ChainId;
  txHash: string;
  blockNumber: number;
  timestamp: string;
  status: 'confirmed' | 'pending';
  contentHash: string;
}

// ---------------------------------------------------------------------------
// Chain configuration (static scaffolding — block-explorer endpoints, not data)
//
// NOTE: There is no backend notarization / on-chain anchoring macro in the
// platform today. The notarization history below is an honest empty state and
// the notarize/verify actions are inert until a backend wires up.
// TODO: wire to backend once a notarization macro exists.
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
  const [currentTxHash, setCurrentTxHash] = useState<string | null>(null);
  const [confirmationCount, setConfirmationCount] = useState(0);

  const [verifyHash, setVerifyHash] = useState('');
  const [verifyResult, setVerifyResult] = useState<VerifyResult>('idle');
  const [verifyChain, setVerifyChain] = useState<ChainId>('base');

  // No backend notarization source — honest empty history, never fabricated.
  const [records] = useState<NotarizationRecord[]>([]);

  const chainInfo = useMemo(() => CHAINS.find(c => c.id === selectedChain)!, [selectedChain]);

  // Handlers
  const initiateNotarize = () => setShowConfirmDialog(true);

  const confirmNotarize = () => {
    setShowConfirmDialog(false);
    setConfirmationCount(0);
    setCurrentTxHash(null);
    // No backend notarization macro — never fabricate a tx hash / confirmation.
    // Surface an honest failure until a real on-chain anchoring service wires up.
    // TODO: wire to backend once a notarization macro exists.
    setNotarizeStatus('failed');
  };

  const resetNotarize = () => {
    setNotarizeStatus('idle');
    setCurrentTxHash(null);
    setConfirmationCount(0);
  };

  const runVerification = () => {
    if (!verifyHash.trim()) return;
    // No backend on-chain verification — check only against real local records
    // (currently none). Honest result, never a fabricated "verified".
    // TODO: wire to backend once a notarization macro exists.
    const found = records.some(r => r.contentHash === verifyHash || r.txHash === verifyHash);
    setVerifyResult(found ? 'verified' : 'not-found');
  };

  return (
    <div className={`${panel} p-5 space-y-5 text-white max-w-xl`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold tracking-tight">Notarization</h2>
        <Badge color="bg-purple-600/80 text-purple-100">On-Chain Proof</Badge>
      </div>
      <p className="text-sm text-white/50">
        Anchor DTU content hashes to a public blockchain for immutable proof of existence.
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
          <button
            onClick={initiateNotarize}
            className="w-full py-2.5 rounded-lg bg-purple-600 hover:bg-purple-500 font-semibold text-sm transition-colors"
          >
            Notarize on {chainInfo.name}
          </button>
        )}

        {/* Confirmation dialog */}
        {showConfirmDialog && (
          <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-900/10 space-y-3">
            <p className="text-sm text-yellow-200">
              This will submit a transaction to <strong>{chainInfo.name}</strong> anchoring the
              current DTU content hash. Estimated cost: <strong>{chainInfo.estimatedCost}</strong>.
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

        {/* Progress states */}
        {notarizeStatus === 'pending' && (
          <div className="flex items-center gap-3 p-3 rounded-lg border border-white/10 bg-white/5">
            <Spinner />
            <span className="text-sm text-white/70">Submitting transaction...</span>
          </div>
        )}

        {notarizeStatus === 'confirming' && (
          <div className="p-3 rounded-lg border border-cyan-500/20 bg-cyan-900/10 space-y-2">
            <div className="flex items-center gap-3">
              <Spinner />
              <span className="text-sm text-white/70">
                Confirming... {confirmationCount}/{chainInfo.confirmations}
              </span>
            </div>
            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${(confirmationCount / chainInfo.confirmations) * 100}%`,
                }}
              />
            </div>
            {currentTxHash && (
              <p className="text-[11px] font-mono text-white/30 break-all">
                Tx: {truncateHash(currentTxHash, 10, 8)}
              </p>
            )}
          </div>
        )}

        {notarizeStatus === 'confirmed' && currentTxHash && (
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-900/10 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-green-400 text-lg">&#10003;</span>
              <span className="text-sm font-semibold text-green-300">
                Notarized on {chainInfo.name}
              </span>
            </div>

            {/* Notarization badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/30">
              <span>{chainInfo.icon}</span>
              <span className="text-xs font-semibold text-green-300">Verified</span>
              <span className="text-[10px] text-green-400/60">
                {chainInfo.confirmations}/{chainInfo.confirmations} confirmations
              </span>
            </div>

            <div className="text-xs space-y-1">
              <div>
                <span className="text-white/30">Tx Hash: </span>
                <a
                  href={`${chainInfo.explorer}${currentTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-cyan-400 hover:underline"
                >
                  {truncateHash(currentTxHash, 10, 8)}
                </a>
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
                Notarization unavailable
              </span>
            </div>
            <p className="text-xs text-white/50">
              On-chain anchoring is not connected to a backend yet. No transaction
              was submitted.
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
          Verify DTU Hash
        </h3>
        <div className="flex gap-2">
          <select
            value={verifyChain}
            onChange={e => setVerifyChain(e.target.value as ChainId)}
            className="bg-black/60 border border-white/10 rounded-md px-2 py-1.5 text-xs text-white focus:border-cyan-500 outline-none"
          >
            {CHAINS.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={verifyHash}
            onChange={e => {
              setVerifyHash(e.target.value);
              setVerifyResult('idle');
            }}
            placeholder="Enter DTU content hash or tx hash..."
            className="flex-1 bg-black/60 border border-white/10 rounded-md px-3 py-1.5 text-xs font-mono text-white placeholder:text-white/20 focus:border-cyan-500 outline-none"
          />
          <button
            onClick={runVerification}
            disabled={verifyResult === 'checking'}
            className="px-3 py-1.5 rounded-md bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-xs font-semibold transition-colors"
          >
            Verify
          </button>
        </div>

        {verifyResult === 'checking' && (
          <div className="flex items-center gap-2 text-xs text-white/50">
            <Spinner /> Checking on-chain...
          </div>
        )}
        {verifyResult === 'verified' && (
          <div className="p-2 rounded-lg bg-green-900/20 border border-green-500/20 text-xs text-green-300 flex items-center gap-2">
            <span className="text-green-400">&#10003;</span>
            Hash found on-chain. DTU integrity verified.
          </div>
        )}
        {verifyResult === 'not-found' && (
          <div className="p-2 rounded-lg bg-red-900/20 border border-red-500/20 text-xs text-red-300 flex items-center gap-2">
            <span className="text-red-400">&#10007;</span>
            Hash not found on {CHAINS.find(c => c.id === verifyChain)?.name}. No matching
            notarization record.
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
          {records.map(record => {
            const chain = CHAINS.find(c => c.id === record.chain)!;
            return (
              <div
                key={record.id}
                className="p-3 rounded-lg border border-white/10 bg-white/5 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{chain.icon}</span>
                    <span className="text-sm font-semibold font-mono">{record.dtuId}</span>
                  </div>
                  <Badge
                    color={
                      record.status === 'confirmed'
                        ? 'bg-green-600/40 text-green-300'
                        : 'bg-yellow-600/40 text-yellow-300'
                    }
                  >
                    {record.status}
                  </Badge>
                </div>
                <div className="text-[11px] text-white/40 space-y-0.5">
                  <div>
                    <span className="text-white/30">Tx: </span>
                    <a
                      href={`${chain.explorer}${record.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-cyan-400 hover:underline"
                    >
                      {truncateHash(record.txHash, 10, 8)}
                    </a>
                  </div>
                  <div>
                    <span className="text-white/30">Block: </span>
                    <span className="font-mono">{record.blockNumber.toLocaleString()}</span>
                  </div>
                  <div>
                    <span className="text-white/30">Content Hash: </span>
                    <span className="font-mono text-white/50">
                      {truncateHash(record.contentHash, 12, 6)}
                    </span>
                  </div>
                </div>
                <div className="text-[10px] text-white/25">
                  {new Date(record.timestamp).toLocaleString()}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
