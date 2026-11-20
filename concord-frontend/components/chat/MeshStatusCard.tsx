'use client';

import React, { useState } from 'react';
import {
  Wifi, WifiOff, Bluetooth, Radio, Phone, Nfc, Globe,
  Signal, SignalHigh, SignalLow, SignalZero,
  Send, ArrowRightLeft, Clock, Users, Activity,
  ChevronDown, ChevronUp, Layers, Zap,
} from 'lucide-react';

// ── Types ───────────────────────────────────────────────────────────────────

interface TransportChannel {
  layer: string;
  available: boolean;
  status: string;
  lastSeen: string | null;
  latencyMs: number | null;
  spec: {
    name: string;
    protocol: string;
    range: string;
    speed: string;
    bandwidth: string;
    priority: number;
    maxPayloadBytes: number;
  };
}

interface MeshPeer {
  nodeId: string;
  channels: string[];
  relay: boolean;
  firstSeen: string;
  lastSeen: string;
  transmissions: number;
  discoveredVia: string;
}

interface TransmissionRecord {
  id: string;
  channel: string;
  destinationNodeId: string;
  packetCount: number;
  totalBytes: number;
  fragmented: boolean;
  sentAt: string;
  status: string;
}

interface MeshMetrics {
  initialized: boolean;
  nodeId: string;
  activeChannelCount: number;
  totalChannels: number;
  peerCount: number;
  pendingQueueSize: number;
  activeTransfers: number;
  uptime: number;
  stats: {
    totalTransmissions: number;
    totalReceived: number;
    totalRelayed: number;
    totalStoreForward: number;
    bytesSent: number;
    bytesReceived: number;
    failovers: number;
  };
}

interface TopologyData {
  selfNodeId: string;
  nodes: Array<{ nodeId: string; channels: string[]; lastSeen: string; relay: boolean }>;
  totalNodes: number;
  activeChannels: string[];
}

interface TransferProgress {
  id: string;
  totalComponents: number;
  sentComponents: number;
  verifiedComponents: number;
  failedComponents: number;
  status: string;
  channels: string[];
  startedAt: string;
  completedAt: string | null;
}

interface MeshStatusCardProps {
  type: 'status' | 'topology' | 'channels' | 'peers' | 'stats' | 'transfer';
  metrics?: MeshMetrics;
  channels?: TransportChannel[];
  peers?: MeshPeer[];
  topology?: TopologyData;
  transmissions?: TransmissionRecord[];
  transfer?: TransferProgress;
}

// ── Channel Icons ───────────────────────────────────────────────────────────

const channelIcons: Record<string, React.ReactNode> = {
  internet: <Globe size={16} />,
  wifi_direct: <Wifi size={16} />,
  bluetooth: <Bluetooth size={16} />,
  lora: <Radio size={16} />,
  rf_packet: <Radio size={16} />,
  telephone: <Phone size={16} />,
  nfc: <Nfc size={16} />,
};

const channelLabels: Record<string, string> = {
  internet: 'Internet',
  wifi_direct: 'WiFi Direct',
  bluetooth: 'Bluetooth',
  lora: 'LoRa Radio',
  rf_packet: 'RF Packet',
  telephone: 'Telephone',
  nfc: 'NFC',
};

function SignalIndicator({ available, speed }: { available: boolean; speed?: string }) {
  if (!available) return <SignalZero size={14} className="text-[color:var(--nb-muted,#a1a1aa)]" />;
  if (speed === 'high') return <SignalHigh size={14} className="text-[color:var(--nb-green,#10b981)]" />;
  if (speed === 'medium') return <Signal size={14} className="text-[color:var(--nb-ochre,#f59e0b)]" />;
  return <SignalLow size={14} className="text-[color:var(--nb-blue,#3b82f6)]" />;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

// ── Sub-Components ──────────────────────────────────────────────────────────

function MeshStatusView({ metrics }: { metrics: MeshMetrics }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        {metrics.initialized ? (
          <Wifi size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        ) : (
          <WifiOff size={18} className="text-[color:var(--nb-muted,#a1a1aa)]" />
        )}
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Mesh Status</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          metrics.initialized ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'
        }`}>
          {metrics.initialized ? 'Active' : 'Offline'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Node ID</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)] font-mono truncate">{metrics.nodeId || '—'}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Uptime</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{formatUptime(metrics.uptime)}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Active Channels</div>
          <div className="text-[color:var(--nb-blue,#22d3ee)] font-semibold">{metrics.activeChannelCount} / {metrics.totalChannels}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Peers</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{metrics.peerCount}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Transmitted</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{metrics.stats.totalTransmissions}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Received</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{metrics.stats.totalReceived}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Relayed</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{metrics.stats.totalRelayed}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Pending Queue</div>
          <div className="text-[color:var(--nb-ink-2,#d4d4d8)]">{metrics.pendingQueueSize}</div>
        </div>
      </div>

      <div className="flex gap-4 text-xs text-[color:var(--nb-muted,#a1a1aa)]">
        <span>Sent: {formatBytes(metrics.stats.bytesSent)}</span>
        <span>Received: {formatBytes(metrics.stats.bytesReceived)}</span>
        {metrics.stats.failovers > 0 && (
          <span className="text-[color:var(--nb-ochre,#f59e0b)]">Failovers: {metrics.stats.failovers}</span>
        )}
      </div>

      {metrics.uptime > 0 && (
        <div className="flex items-center gap-1 text-xs text-[color:var(--nb-muted,#a1a1aa)]">
          <Clock size={12} />
          <span>Uptime: {formatUptime(metrics.uptime)}</span>
        </div>
      )}
    </div>
  );
}

function ChannelsView({ channels }: { channels: TransportChannel[] }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Transport Channels</span>
      </div>

      <div className="space-y-1">
        {channels.map(ch => (
          <div key={ch.layer} className={`flex items-center gap-2 p-2 rounded text-xs ${
            ch.available ? 'bg-zinc-800' : 'bg-zinc-850 opacity-60'
          }`}>
            <span className="text-[color:var(--nb-muted,#a1a1aa)]">{channelIcons[ch.layer] || <Radio size={16} />}</span>
            <span className="text-[color:var(--nb-ink-2,#d4d4d8)] flex-1">{channelLabels[ch.layer] || ch.layer}</span>
            <SignalIndicator available={ch.available} speed={ch.spec?.speed} />
            <span className="text-[color:var(--nb-muted,#a1a1aa)] w-16 text-right">{ch.spec?.range || '—'}</span>
            <span className={`w-14 text-right ${ch.available ? 'text-emerald-400' : 'text-zinc-600'}`}>
              {ch.available ? 'Active' : 'Off'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeersView({ peers }: { peers: MeshPeer[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Mesh Peers</span>
        <span className="ml-auto text-xs text-[color:var(--nb-muted,#a1a1aa)]">{peers.length} discovered</span>
      </div>

      {peers.length === 0 ? (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-3">No peers discovered yet</div>
      ) : (
        <div className="space-y-1">
          {peers.map(peer => (
            <div key={peer.nodeId}>
              <button
                onClick={() => setExpanded(expanded === peer.nodeId ? null : peer.nodeId)}
                className="flex items-center gap-2 w-full p-2 rounded bg-[var(--nb-wash,#27272a)] hover:bg-zinc-750 text-xs text-left"
              >
                <span className="text-[color:var(--nb-ink-2,#d4d4d8)] font-mono flex-1 truncate">{peer.nodeId}</span>
                <span className="text-[color:var(--nb-muted,#a1a1aa)]">{peer.channels.length} ch</span>
                {peer.relay && <ArrowRightLeft size={12} className="text-[color:var(--nb-blue,#06b6d4)]" />}
                {expanded === peer.nodeId ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {expanded === peer.nodeId && (
                <div className="ml-4 mt-1 p-2 bg-zinc-850 rounded text-xs space-y-1">
                  <div className="text-[color:var(--nb-muted,#a1a1aa)]">Channels: <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{peer.channels.join(', ') || 'none'}</span></div>
                  <div className="text-[color:var(--nb-muted,#a1a1aa)]">Discovered via: <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{peer.discoveredVia}</span></div>
                  <div className="text-[color:var(--nb-muted,#a1a1aa)]">Transmissions: <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{peer.transmissions}</span></div>
                  <div className="text-[color:var(--nb-muted,#a1a1aa)]">First seen: <span className="text-[color:var(--nb-ink-2,#d4d4d8)]">{new Date(peer.firstSeen).toLocaleString()}</span></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TopologyView({ topology }: { topology: TopologyData }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Mesh Topology</span>
        <span className="ml-auto text-xs text-[color:var(--nb-muted,#a1a1aa)]">{topology.totalNodes} nodes</span>
      </div>

      <div className="bg-[var(--nb-wash,#27272a)] rounded p-3 text-xs space-y-2">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-[color:var(--nb-blue,#22d3ee)]" />
          <span className="text-[color:var(--nb-blue,#67e8f9)] font-mono">{topology.selfNodeId}</span>
          <span className="text-[color:var(--nb-muted,#a1a1aa)]">(self)</span>
        </div>
        <div className="text-[color:var(--nb-muted,#a1a1aa)]">
          Active channels: {topology.activeChannels.map(ch => channelLabels[ch] || ch).join(', ')}
        </div>
      </div>

      {topology.nodes.length > 0 && (
        <div className="space-y-1">
          {topology.nodes.map(node => (
            <div key={node.nodeId} className="flex items-center gap-2 p-2 bg-[var(--nb-wash,#27272a)] rounded text-xs">
              <span className="text-[color:var(--nb-ink-2,#d4d4d8)] font-mono flex-1 truncate">{node.nodeId}</span>
              {node.relay && <ArrowRightLeft size={12} className="text-[color:var(--nb-blue,#06b6d4)]" />}
              <span className="text-[color:var(--nb-muted,#a1a1aa)]">{node.channels.length} ch</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TransferView({ transfer }: { transfer: TransferProgress }) {
  const progress = transfer.totalComponents > 0
    ? Math.round((transfer.sentComponents / transfer.totalComponents) * 100)
    : 0;

  const statusColors: Record<string, string> = {
    completed: 'text-[color:var(--nb-green,#34d399)]',
    in_progress: 'text-[color:var(--nb-blue,#22d3ee)]',
    partial: 'text-[color:var(--nb-ochre,#fbbf24)]',
    failed: 'text-[color:var(--nb-red,#f87171)]',
    pending: 'text-[color:var(--nb-muted,#a1a1aa)]',
  };

  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Consciousness Transfer</span>
        <span className={`ml-auto text-xs font-semibold ${statusColors[transfer.status] || 'text-zinc-400'}`}>
          {transfer.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-2">
        <div className="w-full bg-[var(--nb-wash,#27272a)] rounded-full h-2">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-[var(--nb-blue-soft,#06b6d4)] to-[var(--nb-green-soft,#10b981)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[color:var(--nb-muted,#a1a1aa)]">
          <span>{transfer.sentComponents} / {transfer.totalComponents} components sent</span>
          <span>{progress}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Verified</div>
          <div className="text-[color:var(--nb-green,#34d399)]">{transfer.verifiedComponents}</div>
        </div>
        <div className="bg-[var(--nb-wash,#27272a)] rounded p-2">
          <div className="text-[color:var(--nb-muted,#a1a1aa)]">Failed</div>
          <div className={transfer.failedComponents > 0 ? 'text-[color:var(--nb-red,#f87171)]' : 'text-[color:var(--nb-muted,#a1a1aa)]'}>
            {transfer.failedComponents}
          </div>
        </div>
      </div>

      {transfer.channels.length > 0 && (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)]">
          Channels: {transfer.channels.map(ch => channelLabels[ch] || ch).join(', ')}
        </div>
      )}

      <div className="flex gap-4 text-xs text-[color:var(--nb-muted,#a1a1aa)]">
        <span>Started: {new Date(transfer.startedAt).toLocaleTimeString()}</span>
        {transfer.completedAt && (
          <span>Completed: {new Date(transfer.completedAt).toLocaleTimeString()}</span>
        )}
      </div>
    </div>
  );
}

function StatsView({ transmissions }: { transmissions: TransmissionRecord[] }) {
  return (
    <div className="rounded-lg border border-[color:var(--nb-rule,#3f3f46)] bg-[var(--nb-sheet,#18181b)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-[color:var(--nb-blue,#22d3ee)]" />
        <span className="text-sm font-semibold text-[color:var(--nb-ink,#e4e4e7)]">Recent Transmissions</span>
      </div>

      {(!transmissions || transmissions.length === 0) ? (
        <div className="text-xs text-[color:var(--nb-muted,#a1a1aa)] text-center py-3">No recent transmissions</div>
      ) : (
        <div className="space-y-1">
          {transmissions.slice(0, 10).map(tx => (
            <div key={tx.id} className="flex items-center gap-2 p-2 bg-[var(--nb-wash,#27272a)] rounded text-xs">
              <span className="text-[color:var(--nb-muted,#a1a1aa)]">{channelIcons[tx.channel] || <Send size={12} />}</span>
              <span className="text-[color:var(--nb-ink-2,#d4d4d8)] font-mono truncate flex-1">{tx.destinationNodeId}</span>
              <span className="text-[color:var(--nb-muted,#a1a1aa)]">{formatBytes(tx.totalBytes)}</span>
              {tx.fragmented && <span className="text-[color:var(--nb-ochre,#f59e0b)]">fragmented</span>}
              <span className={tx.status === 'sent' ? 'text-[color:var(--nb-green,#34d399)]' : 'text-[color:var(--nb-muted,#a1a1aa)]'}>
                {tx.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function MeshStatusCard({ type, metrics, channels, peers, topology, transmissions, transfer }: MeshStatusCardProps) {
  switch (type) {
    case 'status':
      return metrics ? <MeshStatusView metrics={metrics} /> : null;
    case 'channels':
      return channels ? <ChannelsView channels={channels} /> : null;
    case 'peers':
      return peers ? <PeersView peers={peers} /> : null;
    case 'topology':
      return topology ? <TopologyView topology={topology} /> : null;
    case 'transfer':
      return transfer ? <TransferView transfer={transfer} /> : null;
    case 'stats':
      return transmissions ? <StatsView transmissions={transmissions} /> : null;
    default:
      return null;
  }
}
