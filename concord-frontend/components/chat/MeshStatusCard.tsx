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
  if (!available) return <SignalZero size={14} className="text-zinc-400" />;
  if (speed === 'high') return <SignalHigh size={14} className="text-emerald-500" />;
  if (speed === 'medium') return <Signal size={14} className="text-amber-500" />;
  return <SignalLow size={14} className="text-blue-500" />;
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
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        {metrics.initialized ? (
          <Wifi size={18} className="text-cyan-400" />
        ) : (
          <WifiOff size={18} className="text-zinc-400" />
        )}
        <span className="text-sm font-semibold text-zinc-200">Mesh Status</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${
          metrics.initialized ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'
        }`}>
          {metrics.initialized ? 'Active' : 'Offline'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Node ID</div>
          <div className="text-zinc-300 font-mono truncate">{metrics.nodeId || '—'}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Uptime</div>
          <div className="text-zinc-300">{formatUptime(metrics.uptime)}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Active Channels</div>
          <div className="text-cyan-400 font-semibold">{metrics.activeChannelCount} / {metrics.totalChannels}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Peers</div>
          <div className="text-zinc-300">{metrics.peerCount}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Transmitted</div>
          <div className="text-zinc-300">{metrics.stats.totalTransmissions}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Received</div>
          <div className="text-zinc-300">{metrics.stats.totalReceived}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Relayed</div>
          <div className="text-zinc-300">{metrics.stats.totalRelayed}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Pending Queue</div>
          <div className="text-zinc-300">{metrics.pendingQueueSize}</div>
        </div>
      </div>

      <div className="flex gap-4 text-xs text-zinc-400">
        <span>Sent: {formatBytes(metrics.stats.bytesSent)}</span>
        <span>Received: {formatBytes(metrics.stats.bytesReceived)}</span>
        {metrics.stats.failovers > 0 && (
          <span className="text-amber-500">Failovers: {metrics.stats.failovers}</span>
        )}
      </div>

      {metrics.uptime > 0 && (
        <div className="flex items-center gap-1 text-xs text-zinc-400">
          <Clock size={12} />
          <span>Uptime: {formatUptime(metrics.uptime)}</span>
        </div>
      )}
    </div>
  );
}

function ChannelsView({ channels }: { channels: TransportChannel[] }) {
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-200">Transport Channels</span>
      </div>

      <div className="space-y-1">
        {channels.map(ch => (
          <div key={ch.layer} className={`flex items-center gap-2 p-2 rounded text-xs ${
            ch.available ? 'bg-zinc-800' : 'bg-zinc-850 opacity-60'
          }`}>
            <span className="text-zinc-400">{channelIcons[ch.layer] || <Radio size={16} />}</span>
            <span className="text-zinc-300 flex-1">{channelLabels[ch.layer] || ch.layer}</span>
            <SignalIndicator available={ch.available} speed={ch.spec?.speed} />
            <span className="text-zinc-400 w-16 text-right">{ch.spec?.range || '—'}</span>
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
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Users size={18} className="text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-200">Mesh Peers</span>
        <span className="ml-auto text-xs text-zinc-400">{peers.length} discovered</span>
      </div>

      {peers.length === 0 ? (
        <div className="text-xs text-zinc-400 text-center py-3">No peers discovered yet</div>
      ) : (
        <div className="space-y-1">
          {peers.map(peer => (
            <div key={peer.nodeId}>
              <button
                onClick={() => setExpanded(expanded === peer.nodeId ? null : peer.nodeId)}
                className="flex items-center gap-2 w-full p-2 rounded bg-zinc-800 hover:bg-zinc-750 text-xs text-left"
              >
                <span className="text-zinc-300 font-mono flex-1 truncate">{peer.nodeId}</span>
                <span className="text-zinc-400">{peer.channels.length} ch</span>
                {peer.relay && <ArrowRightLeft size={12} className="text-cyan-500" />}
                {expanded === peer.nodeId ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              {expanded === peer.nodeId && (
                <div className="ml-4 mt-1 p-2 bg-zinc-850 rounded text-xs space-y-1">
                  <div className="text-zinc-400">Channels: <span className="text-zinc-300">{peer.channels.join(', ') || 'none'}</span></div>
                  <div className="text-zinc-400">Discovered via: <span className="text-zinc-300">{peer.discoveredVia}</span></div>
                  <div className="text-zinc-400">Transmissions: <span className="text-zinc-300">{peer.transmissions}</span></div>
                  <div className="text-zinc-400">First seen: <span className="text-zinc-300">{new Date(peer.firstSeen).toLocaleString()}</span></div>
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
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Layers size={18} className="text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-200">Mesh Topology</span>
        <span className="ml-auto text-xs text-zinc-400">{topology.totalNodes} nodes</span>
      </div>

      <div className="bg-zinc-800 rounded p-3 text-xs space-y-2">
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-cyan-400" />
          <span className="text-cyan-300 font-mono">{topology.selfNodeId}</span>
          <span className="text-zinc-400">(self)</span>
        </div>
        <div className="text-zinc-400">
          Active channels: {topology.activeChannels.map(ch => channelLabels[ch] || ch).join(', ')}
        </div>
      </div>

      {topology.nodes.length > 0 && (
        <div className="space-y-1">
          {topology.nodes.map(node => (
            <div key={node.nodeId} className="flex items-center gap-2 p-2 bg-zinc-800 rounded text-xs">
              <span className="text-zinc-300 font-mono flex-1 truncate">{node.nodeId}</span>
              {node.relay && <ArrowRightLeft size={12} className="text-cyan-500" />}
              <span className="text-zinc-400">{node.channels.length} ch</span>
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
    completed: 'text-emerald-400',
    in_progress: 'text-cyan-400',
    partial: 'text-amber-400',
    failed: 'text-red-400',
    pending: 'text-zinc-400',
  };

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Send size={18} className="text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-200">Consciousness Transfer</span>
        <span className={`ml-auto text-xs font-semibold ${statusColors[transfer.status] || 'text-zinc-400'}`}>
          {transfer.status.toUpperCase()}
        </span>
      </div>

      <div className="space-y-2">
        <div className="w-full bg-zinc-800 rounded-full h-2">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-zinc-400">
          <span>{transfer.sentComponents} / {transfer.totalComponents} components sent</span>
          <span>{progress}%</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Verified</div>
          <div className="text-emerald-400">{transfer.verifiedComponents}</div>
        </div>
        <div className="bg-zinc-800 rounded p-2">
          <div className="text-zinc-400">Failed</div>
          <div className={transfer.failedComponents > 0 ? 'text-red-400' : 'text-zinc-400'}>
            {transfer.failedComponents}
          </div>
        </div>
      </div>

      {transfer.channels.length > 0 && (
        <div className="text-xs text-zinc-400">
          Channels: {transfer.channels.map(ch => channelLabels[ch] || ch).join(', ')}
        </div>
      )}

      <div className="flex gap-4 text-xs text-zinc-400">
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
    <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity size={18} className="text-cyan-400" />
        <span className="text-sm font-semibold text-zinc-200">Recent Transmissions</span>
      </div>

      {(!transmissions || transmissions.length === 0) ? (
        <div className="text-xs text-zinc-400 text-center py-3">No recent transmissions</div>
      ) : (
        <div className="space-y-1">
          {transmissions.slice(0, 10).map(tx => (
            <div key={tx.id} className="flex items-center gap-2 p-2 bg-zinc-800 rounded text-xs">
              <span className="text-zinc-400">{channelIcons[tx.channel] || <Send size={12} />}</span>
              <span className="text-zinc-300 font-mono truncate flex-1">{tx.destinationNodeId}</span>
              <span className="text-zinc-400">{formatBytes(tx.totalBytes)}</span>
              {tx.fragmented && <span className="text-amber-500">fragmented</span>}
              <span className={tx.status === 'sent' ? 'text-emerald-400' : 'text-zinc-400'}>
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
