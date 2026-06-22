'use client';

/**
 * PublishForgeAppDialog — Concordia content-engine bridge UI for the
 * forge lens. Mints a forge-generated app as a DTU (via
 * forge_marketplace.mint) and optionally lists it on the marketplace
 * (forge_marketplace.list). Royalty cascade tracks every derivative
 * of the template + the resulting app.
 */

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

const PRICE_TIERS: Array<{ label: string; cents: number }> = [
  { label: 'Free',             cents: 0   },
  { label: '99¢',              cents: 99  },
  { label: '$4.99',            cents: 499 },
  { label: '$9.99',            cents: 999 },
  { label: '$19.99',           cents: 1999 },
];

interface MintResult {
  ok: boolean;
  dtuId?: string;
  reason?: string;
  citationId?: string;
}
interface ListResult {
  ok: boolean;
  listingId?: string;
  schemaVersion?: 'v1' | 'v2';
  reason?: string;
}

export interface PublishForgeAppDialogProps {
  /** The template id the user generated against. */
  templateId: string;
  /** The user-supplied app name. */
  appName: string;
  /** The generated source code string. */
  sourceCode: string;
  /** The manifest object returned by the generator (sections, stats). */
  manifest: Record<string, unknown> | null;
  onClose: () => void;
}

export function PublishForgeAppDialog({
  templateId, appName, sourceCode, manifest, onClose,
}: PublishForgeAppDialogProps) {
  const [title, setTitle] = useState(appName);
  const [description, setDescription] = useState('');
  const [priceCents, setPriceCents] = useState<number>(0);
  const [listOnMarketplace, setListOnMarketplace] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [mintResult, setMintResult] = useState<MintResult | null>(null);
  const [listResult, setListResult] = useState<ListResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keyboard parity for the click-outside-to-dismiss backdrop: Escape closes
  // the dialog (matches the modal pattern used across the app, e.g. HelpButton).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = useCallback(async () => {
    if (!sourceCode || !templateId) return;
    setError(null);
    setSubmitting(true);
    setMintResult(null); setListResult(null);
    try {
      const mintResp = await lensRun('forge_marketplace', 'mint', {
        templateId,
        appName: title || appName,
        sourceCode,
        manifest,
        summary: description,
      });
      const mint = mintResp.data?.result as MintResult | null
                ?? (mintResp.data as unknown as MintResult);
      if (!mint?.ok || !mint.dtuId) {
        setError(mint?.reason || 'mint failed');
        setMintResult(mint);
        return;
      }
      setMintResult(mint);
      if (listOnMarketplace) {
        const listResp = await lensRun('forge_marketplace', 'list', {
          dtuId: mint.dtuId,
          priceCents,
          title: title || appName,
          description,
        });
        const lst = listResp.data?.result as ListResult | null
                  ?? (listResp.data as unknown as ListResult);
        setListResult(lst);
        if (lst && lst.ok === false) {
          setError(lst.reason || 'list failed');
        }
      }
    } catch (e) {
      setError(String((e as Error)?.message || e));
    } finally {
      setSubmitting(false);
    }
  }, [templateId, appName, title, description, sourceCode, manifest, priceCents, listOnMarketplace]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish forge app to the marketplace"
      tabIndex={-1}
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-zinc-950 border border-zinc-800 rounded-lg w-full max-w-xl p-5 text-zinc-200">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-zinc-300">
            Publish forge app
          </h2>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-xs">close</button>
        </div>

        <div className="space-y-3">
          <p className="text-[11px] leading-tight text-zinc-500">
            Mints your generated single-file app as a DTU. Royalty cascade
            ensures the template author receives a perpetual share of
            every downstream sale, automatically.
          </p>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Title</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </label>

          <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={600}
              rows={3}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm resize-none"
              placeholder="What does this app do?"
            />
          </label>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={listOnMarketplace}
              onChange={(e) => setListOnMarketplace(e.target.checked)}
            />
            <span>List on marketplace</span>
          </label>

          {listOnMarketplace && (
            <label className="block">
              <span className="block text-[10px] uppercase tracking-wider text-zinc-400 mb-1">Price</span>
              <div className="grid grid-cols-5 gap-1">
                {PRICE_TIERS.map((t) => {
                  const active = priceCents === t.cents;
                  return (
                    <button
                      key={t.cents}
                      type="button"
                      onClick={() => setPriceCents(t.cents)}
                      className={
                        'rounded px-2 py-1.5 text-xs border ' +
                        (active
                          ? 'bg-violet-600/30 border-violet-400 text-violet-100'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700')
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </label>
          )}

          {error && (
            <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900 rounded px-2 py-1.5">
              {error}
            </div>
          )}

          {mintResult?.ok && (
            <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-900/60 rounded px-2 py-1.5 space-y-1">
              <div>Minted as DTU <span className="font-mono">{mintResult.dtuId}</span></div>
              {mintResult.citationId && (
                <div className="text-zinc-400 font-mono text-[10px]">citation: {mintResult.citationId}</div>
              )}
              {listResult?.ok && (
                <div>
                  Listed as <span className="font-mono">{listResult.listingId}</span>{' '}
                  <span className="text-zinc-500">({listResult.schemaVersion})</span>
                </div>
              )}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!sourceCode || !templateId || submitting}
              className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
