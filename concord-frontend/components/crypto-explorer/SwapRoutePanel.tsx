'use client';

/**
 * SwapRoutePanel — bespoke 0x aggregator swap-route preview for the
 * crypto lens. Backed by crypto.swap-route (real 0x permit2 API on
 * Ethereum / Base / Arbitrum / Optimism, gated by ZEROX_API_KEY).
 *
 * Per category-leader research (Uniswap, 0x, 1inch, MetaMask, DexScreener):
 * stacked TokenCard inputs + quote-first sign-last debounce + Save-as-DTU
 * of every quoted route for citation provenance.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Coins, Loader2, ArrowDownUp, Zap } from 'lucide-react';
import { apiHelpers } from '@/lib/api/client';
import { SaveAsDtuButton } from '@/components/dtu/SaveAsDtuButton';

interface QuoteResult {
  buyToken: string; sellToken: string; sellAmount: string; chainId: number;
  buyAmount?: string | null; minBuyAmount?: string | null;
  price?: string | null; guaranteedPrice?: string | null;
  estimatedPriceImpact?: string | null;
  gas?: string | null; gasPrice?: string | null;
  sources?: Array<{ source: string; proportionBps?: number }>;
  to?: string | null; data?: string | null; value?: string | null;
  allowanceTarget?: string | null;
  source: string; kind: string; slippageBps: number;
}

interface MacroEnvelope<T> { ok: boolean; result?: T; error?: string }

async function callMacro<T>(action: string, input: Record<string, unknown>): Promise<MacroEnvelope<T>> {
  const r = await apiHelpers.lens.runDomain('crypto', action, { input });
  const data = (r as { data?: { ok: boolean; result?: T } }).data;
  if (!data) return { ok: false, error: 'empty response' };
  if (data.ok && data.result && typeof data.result === 'object' && 'ok' in data.result) {
    return data.result as MacroEnvelope<T>;
  }
  return data as MacroEnvelope<T>;
}

const CHAINS = [
  { id: 1, label: 'Ethereum' },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
  { id: 10, label: 'Optimism' },
];

export function SwapRoutePanel() {
  const [sellToken, setSellToken] = useState('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'); // USDC ETH
  const [buyToken, setBuyToken] = useState('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'); // ETH
  const [sellAmount, setSellAmount] = useState('1000000');
  const [chainId, setChainId] = useState(1);
  const [slippageBps, setSlippageBps] = useState(50);
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const quoteMutation = useMutation({
    mutationFn: async () => callMacro<QuoteResult>('swap-route', { sellToken, buyToken, sellAmount, chainId, slippageBps }),
    onSuccess: (env) => {
      if (env.ok && env.result) { setQuote(env.result); setError(null); }
      else { setQuote(null); setError(env.error || 'quote failed'); }
    },
  });

  const flip = () => { setSellToken(buyToken); setBuyToken(sellToken); };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 border-b border-cyan-500/15 pb-3">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-cyan-400" />
          <h2 className="text-sm font-semibold text-white">Swap Route Preview</h2>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">0x · 4 chains</span>
        </div>
      </header>

      <div className="space-y-2 rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-[10px] uppercase tracking-wider text-zinc-400">Chain</span>
          <div className="flex gap-1">
            {CHAINS.map((c) => (
              <button key={c.id} type="button" onClick={() => setChainId(c.id)} className={`rounded-full border px-2 py-0.5 text-[10px] ${chainId === c.id ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' : 'border-zinc-800 bg-zinc-900/60 text-zinc-400'}`}>{c.label}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Sell token (address)</label>
          <input type="text" value={sellToken} onChange={(e) => setSellToken(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-white" />
        </div>
        <div className="flex justify-center">
          <button aria-label="Reorder" type="button" onClick={flip} className="rounded-full border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-300 hover:bg-cyan-500/20"><ArrowDownUp className="h-3.5 w-3.5" /></button>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-zinc-400">Buy token (address)</label>
          <input type="text" value={buyToken} onChange={(e) => setBuyToken(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-[10px] text-white" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Sell amount (base units)</label>
            <input type="text" value={sellAmount} onChange={(e) => setSellAmount(e.target.value)} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-zinc-400">Slippage (bps)</label>
            <input type="number" value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))} className="w-full rounded border border-zinc-800 bg-zinc-950 px-2 py-1 font-mono text-xs text-white" />
          </div>
        </div>
        <button type="button" onClick={() => quoteMutation.mutate()} disabled={quoteMutation.isPending} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50">
          {quoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
          Get route (indicative)
        </button>
        {error && <p className="text-[11px] text-red-300">{error}</p>}
      </div>

      {quote && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-cyan-500/20 bg-zinc-950/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-cyan-300">Aggregator quote · {quote.kind}</div>
            <SaveAsDtuButton
              compact
              apiSource="0x-aggregator"
              title={`Swap quote — ${quote.sellAmount} ${quote.sellToken.slice(0, 6)}… → ${quote.buyAmount ?? '—'} ${quote.buyToken.slice(0, 6)}…`}
              content={JSON.stringify(quote, null, 2)}
              extraTags={['crypto', 'swap', 'quote', String(quote.chainId)]}
              rawData={quote}
            />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Cell label="Buy amount" value={quote.buyAmount || '—'} />
            <Cell label="Min buy" value={quote.minBuyAmount || '—'} />
            <Cell label="Price" value={quote.price || '—'} />
            <Cell label="Guaranteed price" value={quote.guaranteedPrice || '—'} />
            <Cell label="Price impact" value={quote.estimatedPriceImpact ? `${(Number(quote.estimatedPriceImpact) * 100).toFixed(3)}%` : '—'} />
            <Cell label="Gas estimate" value={quote.gas || '—'} />
          </dl>
          {quote.sources && quote.sources.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-400">Route fills</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {quote.sources.map((s, i) => (
                  <span key={i} className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-200">
                    {s.source}{s.proportionBps != null ? ` · ${(s.proportionBps / 100).toFixed(1)}%` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-400">{label}</div>
      <div className="mt-0.5 truncate font-mono text-cyan-300">{value}</div>
    </div>
  );
}
