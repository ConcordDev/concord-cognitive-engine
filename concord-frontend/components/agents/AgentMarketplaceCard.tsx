'use client';

/**
 * AgentMarketplaceCard — publish a validated agent manifest at a chosen
 * price + license. Calls `agent.publish` (mint + list in one step).
 *
 * Phase 13 (Stage C). Pairs with AgentSpecEditor.
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Send, Tag, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api/client';
import { AgentSpecEditor } from './AgentSpecEditor';

const LICENSES = ['MIT', 'CC-BY-SA-4.0', 'Apache-2.0', 'proprietary'] as const;
type License = typeof LICENSES[number];

interface PublishResponse {
  ok: boolean;
  dtuId?: string;
  citationIds?: string[];
  listing?: { ok: boolean; listingId?: string; schema?: string };
  reason?: string;
  detail?: string;
}

export interface AgentMarketplaceCardProps {
  className?: string;
  onPublished?: (dtuId: string) => void;
}

export function AgentMarketplaceCard({ className, onPublished }: AgentMarketplaceCardProps) {
  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [priceCents, setPriceCents] = useState<number>(500); // default $5.00
  const [license, setLicense] = useState<License>('MIT');
  const [title, setTitle] = useState('');

  const publish = useMutation<PublishResponse, Error>({
    mutationFn: async (): Promise<PublishResponse> => {
      if (!manifest) throw new Error('manifest_not_validated');
      // license/title applied to manifest before mint
      const enriched: Record<string, unknown> = { ...manifest, license, ...(title ? { name: title } : {}) };
      const r = await api.post('/api/lens/run', {
        domain: 'agent', name: 'publish',
        input: {
          manifest: enriched,
          priceCents,
          title: title || ((enriched.name as string | undefined) ?? 'Agent'),
          description: (enriched.description as string | undefined) ?? '',
        },
      });
      return (r?.data ?? {}) as PublishResponse;
    },
    onSuccess: (r) => {
      if (r.ok && r.dtuId && onPublished) onPublished(r.dtuId);
    },
  });

  const publishDisabled = !manifest || !(priceCents > 0) || publish.isPending;

  const handlePublish = useCallback(() => {
    if (publishDisabled) return;
    publish.mutate();
  }, [publishDisabled, publish]);

  return (
    <div data-testid="agent-marketplace-card" className={className}>
      <AgentSpecEditor onValidated={setManifest} />

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-zinc-400">Title (optional override)</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Defaults to manifest.name"
            className="text-sm bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-zinc-400 inline-flex items-center gap-1"><Tag className="w-3 h-3" /> Price (cents USD)</span>
          <input
            type="number"
            min={1}
            max={10000000}
            value={priceCents}
            onChange={(e) => setPriceCents(Math.max(0, Number(e.target.value) || 0))}
            className="text-sm bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase text-zinc-400">License</span>
          <select
            value={license}
            onChange={(e) => setLicense(e.target.value as License)}
            className="text-sm bg-zinc-950 border border-zinc-800 rounded px-2 py-1 text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
          >
            {LICENSES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={handlePublish}
          disabled={publishDisabled}
          data-testid="agent-publish-button"
          className="px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-500 text-white font-medium disabled:opacity-40 inline-flex items-center gap-2"
        >
          {publish.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Publish to marketplace
        </button>
      </div>

      {publish.data && (
        <div
          data-testid="agent-publish-result"
          className={`mt-3 px-3 py-2 rounded border text-xs ${publish.data.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100' : 'border-rose-500/40 bg-rose-500/10 text-rose-100'}`}
        >
          {publish.data.ok
            ? <>Published agent <span className="font-mono">{publish.data.dtuId}</span>{publish.data.listing?.listingId ? <>, listing <span className="font-mono">{publish.data.listing.listingId}</span></> : null}.</>
            : <><AlertTriangle className="inline w-3 h-3 mr-1" />Publish failed: {publish.data.reason}{publish.data.detail ? ` (${publish.data.detail})` : ''}</>}
        </div>
      )}
    </div>
  );
}

export default AgentMarketplaceCard;
