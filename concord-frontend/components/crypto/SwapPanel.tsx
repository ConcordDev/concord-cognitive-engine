'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDownUp, Loader2, Settings, AlertTriangle } from 'lucide-react';
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
  onSwap?: (input: { fromId: string; toId: string; amountIn: number; quote: SwapQuote }) => Promise<void> | void;
}

export interface SwapQuote {
  amountOut: number;
  rate: number;
  priceImpactPercent: number;
  minimumReceived: number;
  gasEstimateUsd: number;
  feeUsd: number;
  route: string[];
}

const SLIPPAGE_PRESETS = [0.1, 0.5, 1.0];

/**
 * Uniswap-style swap panel — input token + output token, live quote via
 * the backend (with deterministic fallback math), slippage preset, gas
 * estimate, price impact warning.
 */
export function SwapPanel({ tokens, defaultFromSymbol = 'CC', defaultToSymbol = 'USDC', onSwap }: SwapPanelProps) {
  const initialFrom = tokens.find(t => t.symbol.toUpperCase() === defaultFromSymbol.toUpperCase()) || tokens[0];
  const initialTo = tokens.find(t => t.symbol.toUpperCase() === defaultToSymbol.toUpperCase()) || tokens[1] || tokens[0];

  const [fromId, setFromId] = useState<string>(initialFrom?.id || '');
  const [toId, setToId] = useState<string>(initialTo?.id || '');
  const [amountIn, setAmountIn] = useState<string>('');
  const [slippage, setSlippage] = useState<number>(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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
        if (result) setQuote(result);
      } catch (e) {
        if (!(e as { name?: string })?.name?.includes('Canceled')) {
          // Deterministic fallback so UX doesn't grey out when backend isn't deployed yet
          const fallbackRate = (fromToken.priceUsd || 0) / Math.max(0.000001, toToken.priceUsd || 0);
          const amountOut = Number(amountIn) * fallbackRate;
          const fee = amountOut * 0.003;
          const slip = slippage / 100;
          setQuote({
            amountOut: amountOut - fee,
            rate: fallbackRate,
            priceImpactPercent: 0.12,
            minimumReceived: (amountOut - fee) * (1 - slip),
            gasEstimateUsd: 1.2,
            feeUsd: fee * (toToken.priceUsd || 1),
            route: [fromToken.symbol, toToken.symbol],
          });
          setError('Using fallback rate (backend quote unavailable)');
        }
      } finally { setLoadingQuote(false); }
    }, 250);
    return () => { ac.abort(); clearTimeout(t); };
  }, [fromId, toId, amountIn, slippage, fromToken, toToken]);

  const flip = useCallback(() => {
    setFromId(toId); setToId(fromId); setAmountIn(quote?.amountOut?.toString().slice(0, 16) || '');
  }, [fromId, toId, quote]);

  const fromBalanceOk = fromToken?.balance != null ? Number(amountIn) <= fromToken.balance : true;
  const canSwap = !!quote && Number(amountIn) > 0 && fromBalanceOk && !loadingQuote && !!fromToken && !!toToken && fromId !== toId;

  async function handleSwap() {
    if (!canSwap || !quote || !fromToken || !toToken) return;
    setSubmitting(true);
    try {
      await onSwap?.({ fromId, toId, amountIn: Number(amountIn), quote });
      setAmountIn('');
      setQuote(null);
    } finally { setSubmitting(false); }
  }

  const priceImpactWarn = (quote?.priceImpactPercent || 0) > 5;
  const priceImpactCrit = (quote?.priceImpactPercent || 0) > 15;

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-xl p-4 space-y-3 w-full max-w-md">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-cyan-300">Swap</h3>
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
        <div className="p-3 border border-white/10 rounded-lg bg-white/[0.02] space-y-2">
          <p className="text-[10px] uppercase text-gray-400 tracking-wider">Slippage tolerance</p>
          <div className="flex items-center gap-2">
            {SLIPPAGE_PRESETS.map(s => (
              <button
                key={s}
                onClick={() => setSlippage(s)}
                className={cn('px-2 py-1 text-xs rounded', slippage === s ? 'bg-cyan-500 text-black font-bold' : 'border border-white/10 text-gray-300 hover:text-white')}
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
          <Row label="Gas est.">~${quote.gasEstimateUsd.toFixed(2)}</Row>
          <Row label="Route">{quote.route.join(' → ')}</Row>
          {priceImpactWarn && (
            <div className={cn('flex items-center gap-1.5 text-xs px-2 py-1 rounded', priceImpactCrit ? 'bg-red-500/10 text-red-300' : 'bg-yellow-500/10 text-yellow-300')}>
              <AlertTriangle className="w-3.5 h-3.5" />
              Price impact {quote.priceImpactPercent.toFixed(2)}% — {priceImpactCrit ? 'execution risk high' : 'review before swapping'}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-[10px] text-yellow-400">{error}</p>}
      {!fromBalanceOk && fromToken?.balance != null && (
        <p className="text-[10px] text-red-400">Insufficient {fromToken.symbol} balance ({fromToken.balance}).</p>
      )}

      <button
        onClick={handleSwap}
        disabled={!canSwap || submitting}
        className="w-full py-2.5 rounded-lg text-sm font-bold bg-cyan-500 hover:bg-cyan-400 text-black disabled:opacity-40 inline-flex items-center justify-center gap-2"
      >
        {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {!fromToken || !toToken ? 'Pick tokens'
          : fromId === toId ? 'Pick different tokens'
          : !amountIn || Number(amountIn) <= 0 ? 'Enter amount'
          : !fromBalanceOk ? 'Insufficient balance'
          : loadingQuote ? 'Quoting…'
          : `Swap ${fromToken.symbol} → ${toToken.symbol}`}
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200 tabular-nums">{children}</span>
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
    <div className="p-3 rounded-lg border border-white/10 bg-[#0a0e17] space-y-1.5">
      <div className="flex items-center justify-between text-[10px] text-gray-400 uppercase tracking-wider">
        <span>{label}</span>
        {token?.balance != null && (
          <span>
            Bal: {token.balance.toLocaleString(undefined, { maximumFractionDigits: 4 })} {token.symbol}
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
        <div className="text-[10px] text-gray-400 text-right">
          ≈ ${(Number(amount) * (token.priceUsd || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
      )}
    </div>
  );
}

export default SwapPanel;
