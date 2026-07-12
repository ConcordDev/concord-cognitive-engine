'use client';

/**
 * MeshSendDtu — the mesh lens's namesake capability: transmit an actual DTU
 * through the 7-transport routing substrate (`mesh.send`, backed by
 * server/lib/concord-mesh.js#sendDTU). This is distinct from MeshMessaging,
 * which is a free-text chat feature over a separate per-user node/message
 * store — this panel routes a real DTU through the shared substrate's
 * channel selection, fragmentation, and store-and-forward logic.
 *
 * Honest-by-construction: the substrate has no peer-acknowledgement channel
 * (see server/lib/concord-mesh.js — `sendDTU` records a transmission once a
 * channel is selected; it never learns whether a remote peer actually
 * received it). So the result panel reports exactly what the macro reports —
 * "direct"/"fragmented" mean the packet was transmitted onto the chosen
 * channel, "store_forward" means no live channel exists and the frame is
 * queued — never a fabricated "delivered" claim.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { DTUPickerModal } from '@/components/dtu/DTUPickerModal';
import {
  Loader2, Radio, Package, X, CheckCircle2, Clock, AlertTriangle, Send,
} from 'lucide-react';
import type { DTU } from '@/lib/api/generated-types';

interface NodeRow {
  id: string;
  name: string;
  online: boolean;
}

type Proximity = 'unknown' | 'local' | 'nearby' | 'remote';

const PROXIMITIES: { value: Proximity; label: string }[] = [
  { value: 'unknown', label: 'Unknown — let the mesh decide' },
  { value: 'local', label: 'Local — same room (Bluetooth / NFC preferred)' },
  { value: 'nearby', label: 'Nearby — same building (WiFi Direct preferred)' },
  { value: 'remote', label: 'Remote — long haul (internet / LoRa / RF preferred)' },
];

interface SendResult {
  ok: boolean;
  mode?: 'direct' | 'fragmented' | 'store_forward';
  channel?: string | null;
  transmissionId?: string;
  relayId?: string;
  packets?: number;
  totalBytes?: number;
  alternateChannels?: string[];
  reason?: string;
  error?: string;
}

export function MeshSendDtu() {
  const [destination, setDestination] = useState('broadcast');
  const [proximity, setProximity] = useState<Proximity>('unknown');
  const [dtu, setDtu] = useState<DTU | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const nodes = useQuery({
    queryKey: ['mesh-nodes'],
    queryFn: async () => {
      const r = await apiHelpers.lens.runDomain('mesh', 'listNodes', {});
      return (r.data?.result ?? r.data) as { nodes: NodeRow[] };
    },
    refetchInterval: 30_000,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!dtu) throw new Error('Choose a DTU first.');
      const r = await apiHelpers.lens.runDomain('mesh', 'send', {
        dtuId: dtu.id,
        destination,
        proximity,
      });
      return (r.data?.result ?? r.data) as SendResult;
    },
    onSuccess: (r) => setResult(r),
    onError: (e: unknown) => setResult({ ok: false, error: e instanceof Error ? e.message : 'Transmission failed.' }),
  });

  const targets = [
    { id: 'broadcast', label: 'Broadcast (all reachable nodes)' },
    ...((nodes.data?.nodes ?? []).map((n) => ({ id: n.id, label: `${n.online ? '● ' : '○ '}${n.name}` }))),
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-teal-900/40 bg-teal-950/10 p-4">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-teal-200">
          <Radio className="h-4 w-4" aria-hidden /> Transmit a DTU over the mesh
        </h3>
        <p className="mb-3 text-xs text-teal-600">
          Routes a real DTU through the 7-transport substrate — automatic channel selection,
          fragmentation if it doesn&apos;t fit one packet, store-and-forward if nothing is live right now.
        </p>

        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-[11px] text-teal-600">DTU to send</span>
            {dtu ? (
              <div className="flex items-center gap-2 rounded border border-teal-900/50 bg-black px-3 py-2 text-xs text-teal-100">
                <Package className="h-3.5 w-3.5 shrink-0 text-teal-400" aria-hidden />
                <span className="flex-1 truncate" data-testid="mesh-send-selected-dtu">{dtu.title || dtu.id}</span>
                <button
                  type="button"
                  onClick={() => { setDtu(null); setResult(null); }}
                  className="rounded p-0.5 text-teal-500 hover:bg-teal-900/40 focus:outline-none focus:ring-2 focus:ring-teal-400"
                  aria-label="Clear selected DTU"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-teal-800/60 px-3 py-2 text-xs text-teal-400 hover:border-teal-600 hover:text-teal-200 focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                <Package className="h-3.5 w-3.5" aria-hidden /> Choose a DTU…
              </button>
            )}
          </div>

          <label className="block text-[11px] text-teal-600">
            Destination
            <select
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              className="mt-1 w-full rounded border border-teal-900/50 bg-black px-2 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          <label className="block text-[11px] text-teal-600">
            Proximity hint
            <select
              value={proximity}
              onChange={(e) => setProximity(e.target.value as Proximity)}
              className="mt-1 w-full rounded border border-teal-900/50 bg-black px-2 py-1.5 text-xs text-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-400"
            >
              {PROXIMITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>

          <button
            type="button"
            onClick={() => send.mutate()}
            disabled={!dtu || send.isPending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-teal-700/60 px-3 py-2 text-xs font-medium text-teal-100 hover:bg-teal-600/70 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-teal-400"
          >
            {send.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
            Transmit over mesh
          </button>
        </div>

        {result && (
          <div
            role={result.ok === false ? 'alert' : 'status'}
            data-testid="mesh-send-result"
            className={`mt-3 rounded border px-3 py-2 text-xs ${
              result.ok === false
                ? 'border-rose-900/50 bg-rose-950/20 text-rose-300'
                : result.mode === 'store_forward'
                  ? 'border-amber-900/50 bg-amber-950/20 text-amber-200'
                  : 'border-emerald-900/50 bg-emerald-950/20 text-emerald-200'
            }`}
          >
            {result.ok === false ? (
              <p className="flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {result.error || 'Transmission failed.'}
              </p>
            ) : result.mode === 'store_forward' ? (
              <p className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden /> Queued for store-and-forward — no live channel
                right now ({result.reason || 'no_channels_available'}). It sends automatically once a channel comes up.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 flex-wrap">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Transmitted via <span className="font-mono">{result.channel}</span>
                {result.mode === 'fragmented' ? ` across ${result.packets} fragments` : ''} ({result.totalBytes} bytes).
                {result.alternateChannels && result.alternateChannels.length > 0 && (
                  <span className="text-emerald-400/80">Fallback channels: {result.alternateChannels.join(', ')}.</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {showPicker && (
        <DTUPickerModal
          lens="mesh"
          title="Choose a DTU to send over the mesh"
          filter="user"
          onClose={() => setShowPicker(false)}
          onSelect={(d) => { setDtu(d); setResult(null); }}
        />
      )}
    </div>
  );
}
