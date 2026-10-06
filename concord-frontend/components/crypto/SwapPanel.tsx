'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownUp, Loader2, Settings, AlertTriangle, Ban } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface SwappableToken {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  balance?: number;
  iconUrl?: string;
}

interface SwapPanelProps {
  tokens: SwappableToken[];
  defaultFromSymbol?: string;
  defaultToSymbol?: string;
}

/** Shown under the quote: executing a swap is not something Concord can do. */
export const SWAP_NOT_SUPPORTED =
  "Quote only. Executing swaps isn't supported yet: no wallet or DEX router is connected, so nothing is traded or recorded.";

export interface SwapQuote {
  amountOut: number;
  rate: number;
  /** null: needs live pool depth (an aggregator) — the indicative quote can't know it. */
  priceImpactPercent: number | null;
  minimumReceived: number;
  /** null: needs a gas oracle — the indicative quote can't know it. */
  gasEstimateUsd: number | null;
  feeUsd: number;
  route: string[];
}

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0];

/**
 * Indicative swap QUOTE — input token + output token, spot quote from the
 * backend crypto.swap-quote (CoinGecko prices, 0.3% fee model, slippage
 * floor). Price impact and gas come back null (they need pool depth and a
 * gas oracle) and are shown as "not estimated", never invented. There is no
 * swap button: executing a swap isn't supported yet.
 */
export function SwapPanel({ tokens, defaultFromSymbol = 'CC', defaultToSymbol = 'USDC' }: SwapPanelProps) {
  const initialFrom = tokens.find(t => t.symbol.toUpperCase() === defaultFromSymbol.toUpperCase()) || tokens[0];
  const initialTo = tokens.find(t => t.symbol.toUpperCase() === defaultToSymbol.toUpperCase()) || tokens[1] || tokens[0];

  const [fromId, setFromId] = useState<string>(initialFrom?.id || '');
  const [toId, setToId] = useState<string>(initialTo?.id || '');
  const [amountIn, setAmountIn] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fromToken = tokens.find(t => t.id === fromId);
  const toToken = tokens.find(t => t.id === toId);

  // Debounced quote
  useEffect(() => {
    if (!fromToken || !toToken || !amountIn || Number(amountIn) <= 0 || fromId === toId) {
      setQuote(null);
      return;
    }
    const ac = new AbortController();
    const t = setTimeout(async () => {
      setLoadingQuote(true); setError(null);
      try {
        const res = await lensRun({
          domain: 'crypto',
          action: 'swap-quote',
          input: {
            fromId,
            toId,
            amountIn: Number(amountIn),
            slippagePercent: slippage,
          },
          signal: ac.signal,
        });
        const result = res.data?.result as SwapQuote | undefined;
        if (res.data?.ok !== false && result) {
          setQuote(result);
        } else {
          // No invented fallback numbers — say the quote is unavailable.
          setQuote(null);
          setError(`Quote unavailable: ${String(res.data?.error || 'no price')}`);
        }
      } catch (e) {
        if (!(e as { name?: string })?.name?.includes('Canceled')) {
          setQuote(null);
          setError('Quote unavailable: the price service could not be reached.');
        }
      } finally { setLoadingQuote(false); }
    }, 250);
    return () => { ac.abort(); clearTimeout(t); };
  }, [fromId, toId, amountIn, slippage, fromToken, toToken]);

  const flip = useCallback(() => {
    setFromId(toId); setToId(fromId); setAmountIn(quote?.amountOut?.toString().slice(0, 16) || '');
  }, [fromId, toId, quote]);

  const fromBalanceOk = fromToken?.balance != null ? Number(amountIn) <= fromToken.balance : true;

  const priceImpactWarn = (quote?.priceImpactPercent || 0) > 5;
  const priceImpactCrit = (quote?.priceImpactPercent || 0) > 15;

  return (
    <div className="bg-lattice-void border border-cyan-500/20 rounded-xl p-4 space-y-3 w-full max-w-md">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-cyan-300">Swap quote</h3>
        <button
          onClick={() => setShowSettings(v => !v)}
          className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white"
          title="Slippage settings"
          aria-label="Swap settings"
        >
          <Settings className="w-4 h-4" />
        </button>
      </header>

      {showSettings && (
        <div className="p-3 border border-lattice-border rounded-lg bg-white/[0.02] space-y-2">
          <p className="text-[10px] uppercase text-gray-400 tracking-wider">Slippage tolerance</p>
          <div className="flex items-center gap-2">
            {SLIPPAGE_PRESETS.map(s => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={cn('px-2 py-1 text-xs rounded', slippage === s ? 'bg-cyan-500 text-black font-bold' : 'border border-lattice-border text-gray-300 hover:text-white')}
              >
                {s}%
              </button>
            ))}
            <input
              type="number"
              step={0.1}
              min={0.01}
              max={50}
              value={slippage}
              onChange={(e) => setSlippage(Math.max(0.01, Math.min(50, Number(e.target.value) || 0.5)))}
              className="w-20 px-2 py-1 text-xs bg-lattice-deep border border-lattice-border rounded text-white"
            />
            <span className="text-[10px] text-gray-400">%</span>
          </div>
        </div>
      )}

      <SwapBox
        label="You pay"
        tokens={tokens}
        tokenId={fromId}
        amount={amountIn}
        onChangeAmount={setAmountIn}
        onChangeToken={setFromId}
        showMax
      />
      <div className="flex justify-center">
        <button
          onClick={flip}
          title="Flip"
          className="p-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20"
          aria-label="Flip swap direction"
        >
          <ArrowDownUp className="w-4 h-4" />
        </button>
      </div>
      <SwapBox
        label="You receive"
        tokens={tokens}
        tokenId={toId}
        amount={quote?.amountOut?.toFixed(6) || ''}
        onChangeToken={setToId}
        readOnly
      />

      {quote && (
        <div className="text-xs text-gray-400 space-y-1.5 px-1">
          <Row label="Rate">
            1 {fromToken?.symbol} = {quote.rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} {toToken?.symbol}
          </Row>
          <Row label="Minimum received">
            {quote.minimumReceived.toLocaleString(undefined, { maximumFractionDigits: 6 })} {toToken?.symbol}
          </Row>
          <Row label="Fee">${quote.feeUsd.toFixed(4)}</Row>
          <Row label="Gas est.">{quote.gasEstimateUsd != null ? `~$${quote.gasEstimateUsd.toFixed(2)}` : 'not estimated'}</Row>
          <Row label="Price impact">{quote.priceImpactPercent != null ? `${quote.priceImpactPercent.toFixed(2)}%` : 'not estimated'}</Row>
          <Row label="Route">{quote.route.join(' → ')}</Row>
          {priceImpactWarn && (
            <div className={cn('flex items-center gap-1.5 text-xs px-2 py-1 rounded', priceImpactCrit ? 'bg-red-500/10 text-red-300' : 'bg-yellow-500/10 text-yellow-300')}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Price impact {(quote.priceImpactPercent ?? 0).toFixed(2)}% — {priceImpactCrit ? 'execution risk high' : 'review before swapping'}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[10px] text-yellow-400">{error}</p>}
      {!fromBalanceOk && fromToken?.balance != null && (
        <p className="text-[10px] text-red-400">Insufficient {fromToken.symbol} balance ({fromToken.balance}).</p>
      )}

      <p
        data-testid="swap-not-supported"
        className="flex items-start gap-1.5 text-[11px] text-amber-300/90 px-1"
      >
        <Ban className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        {loadingQuote ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
        {SWAP_NOT_SUPPORTED}
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 font-mono tabular-nums">{children}</span>
    </div>
  );
}

function SwapBox({
  label, tokens, tokenId, amount, onChangeAmount, onChangeToken, readOnly, showMax,
}: {
  label: string;
  tokens: SwappableToken[];
  tokenId: string;
  amount: string;
  onChangeAmount?: (v: string) => void;
  onChangeToken: (id: string) => void;
  readOnly?: boolean;
  showMax?: boolean;
}) {
  const token = tokens.find(t => t.id === tokenId);
  return (
    <div className="p-3 rounded-lg border border-lattice-border bg-[#0a0e17] space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-gray-400 uppercase tracking-wider">
        <span>{label}</span>
        {token?.balance != null && (
          <span>
            Bal: <span className="font-mono tabular-nums">{token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}</span> {token.symbol}
            {showMax && onChangeAmount && (
              <button
                onClick={() => onChangeAmount(String(token.balance))}
                className="ml-2 text-cyan-400 hover:text-cyan-300 font-bold"
                type="button"
              >MAX</button>
            )}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={amount}
          onChange={(e) => onChangeAmount?.(e.target.value)}
          readOnly={readOnly}
          placeholder="0.0"
          className="flex-1 bg-transparent text-2xl text-white font-mono outline-none tabular-nums min-w-0"
          min={0}
          step={0.000001}
        />
        <select
          value={tokenId}
          onChange={(e) => onChangeToken(e.target.value)}
          className="px-2 py-1.5 text-sm bg-lattice-deep border border-lattice-border rounded text-white font-bold"
        >
          {tokens.map(t => (
            <option key={t.id} value={t.id}>{t.symbol}</option>
          ))}
        </select>
      </div>
      {amount && token && (
        <div className="text-[10px] text-gray-400 text-right font-mono tabular-nums">
          ≈ ${(Number(amount) * (token.priceUsd || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

export default SwapPanel;
