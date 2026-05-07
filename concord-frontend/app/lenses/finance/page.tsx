'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useUIStore } from '@/store/ui';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  PieChart,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Bell,
  Settings,
  Plus,
  Search,
  Filter,
  Download,
  RefreshCw,
  Eye,
  EyeOff,
  Star,
  X,
  ExternalLink,
  AlertTriangle,
  Lock,
  ArrowRight,
  LineChart,
  CandlestickChart,
  BarChart2,
  Layers,
  Newspaper,
  ChevronDown,
  Loader2,
  Zap,
  DollarSign,
  BarChart3,
  CreditCard,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { LensFeedPanel } from '@/components/feeds/LensFeedPanel';

interface Asset {
  id: string;
  symbol: string;
  name: string;
  type: 'crypto' | 'stock' | 'dtu' | 'nft' | 'commodity';
  price: number;
  change24h: number;
  changePercent24h: number;
  volume24h: number;
  marketCap?: number;
  holdings: number;
  value: number;
  avgBuyPrice: number;
  pnl: number;
  pnlPercent: number;
  allocation: number;
  sparkline?: number[];
  isFavorite?: boolean;
}

interface Transaction {
  id: string;
  type: 'buy' | 'sell' | 'transfer' | 'stake' | 'reward';
  asset: string;
  symbol: string;
  amount: number;
  price: number;
  value: number;
  fee?: number;
  timestamp: string;
  status: 'completed' | 'pending' | 'failed';
  txHash?: string;
}

interface Order {
  id: string;
  type: 'limit' | 'market' | 'stop';
  side: 'buy' | 'sell';
  asset: string;
  symbol: string;
  amount: number;
  price?: number;
  stopPrice?: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
  createdAt: string;
}

interface PriceAlert {
  id: string;
  asset: string;
  symbol: string;
  condition: 'above' | 'below';
  price: number;
  active: boolean;
}

interface NewsItem {
  id: string;
  title: string;
  source: string;
  timestamp: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  assets: string[];
}

type TimeRange = '1H' | '24H' | '7D' | '30D' | '90D' | '1Y' | 'ALL';
type ViewMode = 'overview' | 'portfolio' | 'trade' | 'orders' | 'alerts' | 'news';
type ChartType = 'line' | 'candle' | 'area';

/** Hook: animates a number from 0 to `target` over `duration` ms on mount / when target changes. */
function useAnimatedNumber(target: number, duration = 1000): number {
  const [display, setDisplay] = useState(0);
  const prevTarget = useRef(0);

  useEffect(() => {
    const start = prevTarget.current;
    const delta = target - start;
    if (delta === 0) return;

    const t0 = performance.now();

    let raf: number;
    const step = (now: number) => {
      const elapsed = now - t0;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(start + delta * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(step);
      } else {
        prevTarget.current = target;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

const INITIAL_ASSETS: Asset[] = [];

const INITIAL_TRANSACTIONS: Transaction[] = [];

const INITIAL_ORDERS: Order[] = [];

const INITIAL_ALERTS: PriceAlert[] = [];

const INITIAL_NEWS: NewsItem[] = [];

export default function FinanceLensPage() {
  useLensNav('finance');
  const {
    isError: isError,
    error: error,
    refetch: refetch,
    isLoading: isLoadingAssets,
    items: assetItems,
  } = useLensData<Asset>('finance', 'asset', {
    seed: INITIAL_ASSETS.map((a) => ({
      title: a.name,
      data: a as unknown as Record<string, unknown>,
    })),
  });
  const {
    isError: isError2,
    error: error2,
    refetch: refetch2,
    isLoading: isLoadingTx,
    items: txItems,
  } = useLensData<Transaction>('finance', 'transaction', {
    seed: INITIAL_TRANSACTIONS.map((t) => ({
      title: t.type,
      data: t as unknown as Record<string, unknown>,
    })),
  });
  const {
    isError: isError3,
    error: error3,
    refetch: refetch3,
    isLoading: isLoadingOrders,
    items: orderItems,
  } = useLensData<Order>('finance', 'order', {
    seed: INITIAL_ORDERS.map((o) => ({
      title: `${o.side} ${o.symbol}`,
      data: o as unknown as Record<string, unknown>,
    })),
  });
  const {
    isError: isError4,
    error: error4,
    refetch: refetch4,
    isLoading: isLoadingAlerts,
    items: alertItems,
  } = useLensData<PriceAlert>('finance', 'alert', {
    seed: INITIAL_ALERTS.map((a) => ({
      title: `${a.symbol} ${a.condition} ${a.price}`,
      data: a as unknown as Record<string, unknown>,
    })),
  });
  const {
    isError: isError5,
    error: error5,
    refetch: refetch5,
    isLoading: isLoadingNews,
    items: newsItems,
  } = useLensData<NewsItem>('finance', 'news', {
    seed: INITIAL_NEWS.map((n) => ({
      title: n.title,
      data: n as unknown as Record<string, unknown>,
    })),
  });
  const { create: createOrderMut } = useLensData<Order>('finance', 'order', { noSeed: true });

  // Backend action wiring
  const runFinanceAction = useRunArtifact('finance');
  const [financeActionResult, setFinanceActionResult] = useState<Record<string, unknown> | null>(
    null
  );
  const [financeRunning, setFinanceRunning] = useState<string | null>(null);

  const handleFinanceAction = useCallback(
    async (action: string) => {
      const targetId = assetItems[0]?.id;
      if (!targetId) return;
      setFinanceRunning(action);
      try {
        const res = await runFinanceAction.mutateAsync({ id: targetId, action });
        if (res.ok === false) {
          setFinanceActionResult({
            _action: action,
            message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}`,
          });
        } else {
          setFinanceActionResult({ _action: action, ...(res.result as Record<string, unknown>) });
        }
      } catch (e) {
        console.error(`Finance action ${action} failed:`, e);
        setFinanceActionResult({
          message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
        });
      }
      setFinanceRunning(null);
    },
    [assetItems, runFinanceAction]
  );

  const assets: Asset[] = assetItems.map((i) => ({ ...(i.data as unknown as Asset), id: i.id }));
  const transactions: Transaction[] = txItems.map((i) => ({
    ...(i.data as unknown as Transaction),
    id: i.id,
  }));
  const orders: Order[] = orderItems.map((i) => ({ ...(i.data as unknown as Order), id: i.id }));
  const alerts: PriceAlert[] = alertItems.map((i) => ({
    ...(i.data as unknown as PriceAlert),
    id: i.id,
  }));
  const news: NewsItem[] = newsItems.map((i) => ({ ...(i.data as unknown as NewsItem), id: i.id }));

  const isLoading =
    isLoadingAssets || isLoadingTx || isLoadingOrders || isLoadingAlerts || isLoadingNews;

  const { latestData: realtimeData, isLive, lastUpdated, insights } = useRealtimeLens('finance');

  const chartRef = useRef<HTMLCanvasElement>(null);

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [timeRange, setTimeRange] = useState<TimeRange>('7D');
  const [chartType, setChartType] = useState<ChartType>('line');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [showBalances, setShowBalances] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Trading state
  const [tradeAsset, setTradeAsset] = useState('DTU');
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState<'market' | 'limit' | 'stop'>('market');
  const [tradeAmount, setTradeAmount] = useState('');
  const [tradePrice, setTradePrice] = useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [showFeatures, setShowFeatures] = useState(true);

  // Chart tooltip state
  const [chartTooltip, setChartTooltip] = useState<{
    x: number;
    y: number;
    value: number;
    index: number;
    min?: number;
  } | null>(null);
  const chartDataRef = useRef<number[]>([]);
  const chartMetaRef = useRef<{
    padding: number;
    width: number;
    height: number;
    minVal: number;
    maxVal: number;
    range: number;
  }>({ padding: 40, width: 1000, height: 320, minVal: 0, maxVal: 1, range: 1 });

  const handleSubmitOrder = async () => {
    if (!tradeAmount || isSubmittingOrder) return;
    const amount = parseFloat(tradeAmount);
    if (isNaN(amount) || amount <= 0) return;

    setIsSubmittingOrder(true);
    try {
      const selectedTradingAsset = assets.find((a) => a.symbol === tradeAsset) || assets[0];
      const price =
        orderType === 'market' ? selectedTradingAsset?.price : parseFloat(tradePrice || '0');
      const orderData: Partial<Order> = {
        type: orderType,
        side: tradeSide,
        asset: selectedTradingAsset?.name || tradeAsset,
        symbol: tradeAsset,
        amount,
        ...(orderType === 'limit' ? { price } : {}),
        ...(orderType === 'stop' ? { stopPrice: price } : {}),
        filled: 0,
        status: orderType === 'market' ? 'filled' : 'open',
        createdAt: new Date().toISOString(),
      };
      await createOrderMut({
        title: `${tradeSide} ${tradeAsset}`,
        data: orderData,
      });
      setTradeAmount('');
      setTradePrice('');
    } catch (err) {
      console.error('Failed to submit order:', err);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  // Computed values
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);
  const totalPnl = assets.reduce((sum, a) => sum + a.pnl, 0);
  const totalPnlPercent =
    totalValue - totalPnl !== 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0;

  // Animated KPI values
  const animatedTotalValue = useAnimatedNumber(totalValue);
  const animatedTotalPnl = useAnimatedNumber(totalPnl);
  const animatedVolume = useAnimatedNumber(assets.reduce((sum, a) => sum + a.volume24h, 0));
  const animatedAlertCount = useAnimatedNumber(alerts.filter((a) => a.active).length, 600);

  // Chart rendering
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, width, height);

    // Generate chart data deterministically from totalValue
    const dataPoints = 100;
    const data: number[] = [];
    let value = totalValue * 0.85;

    for (let i = 0; i < dataPoints; i++) {
      // Deterministic pseudo-movement using layered sine waves seeded from totalValue
      const wave =
        Math.sin(i * 0.15) * 0.3 + Math.sin(i * 0.07 + 2) * 0.4 + Math.cos(i * 0.23 + 1) * 0.25;
      value = value + wave * (totalValue * 0.02);
      value = Math.max(value, totalValue * 0.7);
      value = Math.min(value, totalValue * 1.1);
      data.push(value);
    }
    data[data.length - 1] = totalValue;

    // Store for tooltip handler
    chartDataRef.current = data;

    const minVal = Math.min(...data) * 0.95;
    const maxVal = Math.max(...data) * 1.05;
    const range = maxVal - minVal;

    chartMetaRef.current = { padding, width, height, minVal, maxVal, range };

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const y = padding + ((height - padding * 2) / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      const val = maxVal - (range / 5) * i;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`$${(val / 1000).toFixed(1)}k`, padding - 5, y + 4);
    }

    if (chartType === 'line' || chartType === 'area') {
      // Draw area fill
      if (chartType === 'area') {
        const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.3)');
        gradient.addColorStop(1, 'rgba(0, 212, 255, 0)');

        ctx.beginPath();
        ctx.moveTo(padding, height - padding);

        for (let i = 0; i < data.length; i++) {
          const x = padding + (i / (data.length - 1)) * (width - padding * 2);
          const y = padding + ((maxVal - data[i]) / range) * (height - padding * 2);
          ctx.lineTo(x, y);
        }

        ctx.lineTo(width - padding, height - padding);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      // Draw line
      const lineGradient = ctx.createLinearGradient(0, 0, width, 0);
      lineGradient.addColorStop(0, '#00d4ff');
      lineGradient.addColorStop(0.5, '#7c3aed');
      lineGradient.addColorStop(1, '#00d4ff');

      ctx.beginPath();
      ctx.strokeStyle = lineGradient;
      ctx.lineWidth = 2;

      for (let i = 0; i < data.length; i++) {
        const x = padding + (i / (data.length - 1)) * (width - padding * 2);
        const y = padding + ((maxVal - data[i]) / range) * (height - padding * 2);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();

      // Draw current value dot
      const lastX = width - padding;
      const lastY = padding + ((maxVal - data[data.length - 1]) / range) * (height - padding * 2);

      ctx.beginPath();
      ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#00d4ff';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (chartType === 'candle') {
      // Draw candlesticks
      const candleWidth = (width - padding * 2) / 20 - 4;

      for (let i = 0; i < 20; i++) {
        const baseIndex = Math.floor((i / 20) * data.length);
        const open = data[baseIndex];
        const close = data[Math.min(baseIndex + 5, data.length - 1)];
        const high = Math.max(open, close) * 1.01;
        const low = Math.min(open, close) * 0.99;

        const x = padding + (i / 19) * (width - padding * 2);
        const openY = padding + ((maxVal - open) / range) * (height - padding * 2);
        const closeY = padding + ((maxVal - close) / range) * (height - padding * 2);
        const highY = padding + ((maxVal - high) / range) * (height - padding * 2);
        const lowY = padding + ((maxVal - low) / range) * (height - padding * 2);

        const isGreen = close >= open;
        ctx.fillStyle = isGreen ? '#22c55e' : '#ef4444';
        ctx.strokeStyle = isGreen ? '#22c55e' : '#ef4444';

        // Wick
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();

        // Body
        ctx.fillRect(
          x - candleWidth / 2,
          Math.min(openY, closeY),
          candleWidth,
          Math.abs(closeY - openY) || 2
        );
      }
    }
  }, [timeRange, chartType, totalValue]);

  // Chart hover handler — draws crosshair and sets tooltip state
  const handleChartMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const data = chartDataRef.current;
    if (data.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const { padding, width, height, minVal, maxVal, range } = chartMetaRef.current;

    // Find nearest data index
    const chartWidth = width - padding * 2;
    const relX = mouseX - padding;
    const index = Math.round((relX / chartWidth) * (data.length - 1));
    const clampedIndex = Math.max(0, Math.min(data.length - 1, index));
    const val = data[clampedIndex];

    // Position tooltip relative to the container div
    const tooltipX = e.clientX - rect.left;
    const tooltipY = e.clientY - rect.top;

    setChartTooltip({ x: tooltipX, y: tooltipY, value: val, index: clampedIndex, min: minVal });

    // Redraw crosshair on canvas — trigger a re-render of chart + crosshair
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // We need to redraw the chart first. Instead, we'll overlay a crosshair by saving/restoring.
    // For simplicity, draw the crosshair as an overlay stroke.
    // The chart effect will redraw on next render; for now draw directly:
    const dataX = padding + (clampedIndex / (data.length - 1)) * chartWidth;
    const dataY = padding + ((maxVal - val) / range) * (height - padding * 2);

    // Clear previous crosshair area by re-triggering render is expensive;
    // instead we use a compositing trick — store image and redraw:
    // Actually the simplest approach: the chart useEffect stores an image we can restore.
    // For now, just overlay on existing canvas (will accumulate until next full redraw).

    // Save the base chart image once
    if (!(canvas as unknown as Record<string, unknown>).__baseImage) {
      (canvas as unknown as Record<string, unknown>).__baseImage = ctx.getImageData(
        0,
        0,
        width,
        height
      );
    }
    const baseImage = (canvas as unknown as Record<string, unknown>).__baseImage as ImageData;
    ctx.putImageData(baseImage, 0, 0);

    // Vertical crosshair line
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dataX, padding);
    ctx.lineTo(dataX, height - padding);
    ctx.stroke();

    // Highlight dot
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(dataX, dataY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#00d4ff';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }, []);

  const handleChartMouseLeave = useCallback(() => {
    setChartTooltip(null);
    // Restore base image
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const baseImage = (canvas as unknown as Record<string, unknown>).__baseImage as
      | ImageData
      | undefined;
    if (baseImage) {
      ctx.putImageData(baseImage, 0, 0);
    }
  }, []);

  // After chart renders, store the base image for crosshair overlay
  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    (canvas as unknown as Record<string, unknown>).__baseImage = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );
  }, [timeRange, chartType, totalValue]);

  const formatCurrency = (value: number, compact = false) => {
    if (compact) {
      if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
      if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
      if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
    }
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPercent = (value: number) => {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / 3600000);

    if (hours < 1) return 'Just now';
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  const renderMiniSparkline = (data: number[]) => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 24;

    const points = data
      .map((val, i) => {
        const x = (i / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height;
        return `${x},${y}`;
      })
      .join(' ');

    const isPositive = data[data.length - 1] >= data[0];

    const SparklineWithHover = () => {
      const [hoverInfo, setHoverInfo] = useState<{ x: number; y: number; value: number } | null>(
        null
      );
      const svgRef = useRef<SVGSVGElement>(null);

      const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
        const svg = svgRef.current;
        if (!svg) return;
        const rect = svg.getBoundingClientRect();
        const relX = e.clientX - rect.left;
        const idx = Math.round((relX / rect.width) * (data.length - 1));
        const clampedIdx = Math.max(0, Math.min(data.length - 1, idx));
        const val = data[clampedIdx];
        const x = (clampedIdx / (data.length - 1)) * width;
        const y = height - ((val - min) / range) * height;
        setHoverInfo({ x, y, value: val });
      };

      return (
        <div className="relative inline-block">
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="overflow-visible cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverInfo(null)}
          >
            <polyline
              points={points}
              fill="none"
              stroke={isPositive ? '#22c55e' : '#ef4444'}
              strokeWidth="1.5"
            />
            {hoverInfo && (
              <>
                <circle
                  cx={hoverInfo.x}
                  cy={hoverInfo.y}
                  r={3}
                  fill={isPositive ? '#22c55e' : '#ef4444'}
                  stroke="#fff"
                  strokeWidth={1}
                />
                <line
                  x1={hoverInfo.x}
                  y1={0}
                  x2={hoverInfo.x}
                  y2={height}
                  stroke="rgba(255,255,255,0.3)"
                  strokeWidth={0.5}
                  strokeDasharray="2,2"
                />
              </>
            )}
          </svg>
          {hoverInfo && (
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-lattice-elevated border border-lattice-border rounded text-[10px] font-mono whitespace-nowrap pointer-events-none z-10">
              ${hoverInfo.value.toFixed(2)}
            </div>
          )}
        </div>
      );
    };

    return <SparklineWithHover />;
  };

  const renderOverview = () => (
    <div className="space-y-6">
      {/* Portfolio Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="lens-card bg-[#111820] border-emerald-900/20 font-mono">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-emerald-500/70">Total Balance</span>
            <button
              onClick={() => setShowBalances(!showBalances)}
              className="text-gray-400 hover:text-white"
            >
              {showBalances ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-3xl font-bold font-mono tracking-tight">
            {showBalances ? formatCurrency(animatedTotalValue) : '••••••'}
          </p>
          <div
            className={cn(
              'flex items-center gap-1 mt-1 text-sm font-mono',
              totalPnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
            )}
          >
            {totalPnlPercent >= 0 ? (
              <ArrowUpRight className="w-4 h-4" />
            ) : (
              <ArrowDownRight className="w-4 h-4" />
            )}
            <span>{showBalances ? formatCurrency(animatedTotalPnl) : '••••'}</span>
            <span>({formatPercent(totalPnlPercent)})</span>
          </div>
        </div>

        <div className="lens-card">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-sm text-gray-400">Best Performer</span>
          </div>
          <p className="text-xl font-bold">
            {assets.length > 0
              ? [...assets].sort((a, b) => b.pnlPercent - a.pnlPercent)[0].symbol
              : '--'}
          </p>
          <p
            className={cn(
              'text-sm',
              assets.length > 0 &&
                [...assets].sort((a, b) => b.pnlPercent - a.pnlPercent)[0].pnlPercent >= 0
                ? 'text-green-400'
                : 'text-red-400'
            )}
          >
            {assets.length > 0
              ? formatPercent([...assets].sort((a, b) => b.pnlPercent - a.pnlPercent)[0].pnlPercent)
              : '--'}
          </p>
        </div>

        <div className="lens-card">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-4 h-4 text-neon-blue" />
            <span className="text-sm text-gray-400">24h Volume</span>
          </div>
          <p className="text-xl font-bold">{formatCurrency(animatedVolume, true)}</p>
          <p className="text-gray-400 text-sm">Across all assets</p>
        </div>

        <div className="lens-card">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="w-4 h-4 text-neon-yellow" />
            <span className="text-sm text-gray-400">Active Alerts</span>
          </div>
          <p className="text-xl font-bold">{Math.round(animatedAlertCount)}</p>
          <p className="text-gray-400 text-sm">
            {orders.filter((o) => o.status === 'open').length} open orders
          </p>
        </div>
      </div>

      {/* Main Chart */}
      <div className="panel p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold">Portfolio Performance</h2>
            <p className="text-sm text-gray-400">Total value over time</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-lattice-deep rounded-lg p-1">
              {(['line', 'area', 'candle'] as ChartType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setChartType(type)}
                  className={cn(
                    'p-2 rounded-md transition-colors',
                    chartType === type
                      ? 'bg-lattice-elevated text-neon-cyan'
                      : 'text-gray-500 hover:text-white'
                  )}
                >
                  {type === 'line' && <LineChart className="w-4 h-4" />}
                  {type === 'area' && <BarChart2 className="w-4 h-4" />}
                  {type === 'candle' && <CandlestickChart className="w-4 h-4" />}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              {(['1H', '24H', '7D', '30D', '90D', '1Y', 'ALL'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-sm transition-colors',
                    timeRange === range
                      ? 'bg-neon-cyan/20 text-neon-cyan'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  {range}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="relative h-80">
          <canvas
            ref={chartRef}
            width={1000}
            height={320}
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleChartMouseMove}
            onMouseLeave={handleChartMouseLeave}
          />
          {chartTooltip && (
            <div
              className="absolute pointer-events-none z-20"
              style={{
                left: chartTooltip.x,
                top: chartTooltip.y - 48,
                transform: 'translateX(-50%)',
              }}
            >
              <div className="bg-lattice-elevated/95 border border-lattice-border rounded-lg px-3 py-1.5 shadow-lg backdrop-blur-sm text-center">
                <p className="text-xs text-gray-400 font-mono">Point {chartTooltip.index + 1}</p>
                <p className="text-sm font-bold font-mono text-white">
                  {formatCurrency(chartTooltip.value)}
                </p>
                {chartTooltip.min !== undefined && (
                  <p className="text-[10px] text-gray-500 font-mono">
                    Min: {formatCurrency(chartTooltip.min)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Assets Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Holdings */}
        <div className="lg:col-span-2 panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Holdings</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search assets..."
                  className="pl-9 pr-4 py-1.5 bg-lattice-deep rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-neon-cyan w-48"
                />
              </div>
              <button
                onClick={() =>
                  useUIStore.getState().addToast({ type: 'info', message: 'Filter options' })
                }
                className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
              >
                <Filter className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-lattice-border">
                  <th className="pb-3 font-medium">Asset</th>
                  <th className="pb-3 font-medium">Price</th>
                  <th className="pb-3 font-medium">24h</th>
                  <th className="pb-3 font-medium hidden md:table-cell">Chart</th>
                  <th className="pb-3 font-medium text-right">Holdings</th>
                  <th className="pb-3 font-medium text-right">Value</th>
                  <th className="pb-3 font-medium text-right">P&L</th>
                </tr>
              </thead>
              <tbody>
                {assets.filter(
                  (a) =>
                    a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    a.name.toLowerCase().includes(searchQuery.toLowerCase())
                ).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-gray-500">
                      {searchQuery ? 'No assets match your search' : 'No assets in portfolio'}
                    </td>
                  </tr>
                )}
                {assets
                  .filter(
                    (a) =>
                      a.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      a.name.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((asset) => (
                    <tr
                      key={asset.id}
                      onClick={() => setSelectedAsset(asset)}
                      className="border-b border-lattice-border/50 hover:bg-lattice-elevated/50 cursor-pointer transition-colors"
                    >
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold',
                              asset.type === 'dtu' && 'bg-neon-cyan/20 text-neon-cyan',
                              asset.type === 'crypto' && 'bg-neon-purple/20 text-neon-purple',
                              asset.type === 'stock' && 'bg-neon-green/20 text-neon-green'
                            )}
                          >
                            {asset.symbol.slice(0, 2)}
                          </div>
                          <div>
                            <p className="font-medium">{asset.symbol}</p>
                            <p className="text-xs text-gray-400">{asset.name}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 font-mono">{formatCurrency(asset.price)}</td>
                      <td
                        className={cn(
                          'py-4',
                          asset.changePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
                        )}
                      >
                        <div className="flex items-center gap-1">
                          {asset.changePercent24h >= 0 ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {formatPercent(asset.changePercent24h)}
                        </div>
                      </td>
                      <td className="py-4 hidden md:table-cell">
                        {asset.sparkline && renderMiniSparkline(asset.sparkline)}
                      </td>
                      <td className="py-4 text-right font-mono">
                        {showBalances ? asset.holdings.toLocaleString() : '••••'}
                      </td>
                      <td className="py-4 text-right font-mono">
                        {showBalances ? formatCurrency(asset.value) : '••••••'}
                      </td>
                      <td
                        className={cn(
                          'py-4 text-right',
                          asset.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                        )}
                      >
                        {showBalances ? (
                          <div>
                            <p>{formatCurrency(asset.pnl)}</p>
                            <p className="text-xs">{formatPercent(asset.pnlPercent)}</p>
                          </div>
                        ) : (
                          '••••'
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Allocation */}
        <div className="panel p-4">
          <h3 className="font-semibold mb-4">Asset Allocation</h3>

          <div className="relative w-full aspect-square max-w-[200px] mx-auto mb-6">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              {(() => {
                let offset = 0;
                return assets.map((asset, i) => {
                  const circumference = 2 * Math.PI * 40;
                  const strokeDasharray = (asset.allocation / 100) * circumference;
                  const strokeDashoffset = -offset;
                  offset += strokeDasharray;

                  const colors = ['#00d4ff', '#7c3aed', '#22c55e', '#f59e0b', '#ef4444'];

                  return (
                    <circle
                      key={asset.id}
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke={colors[i % colors.length]}
                      strokeWidth="12"
                      strokeDasharray={`${strokeDasharray} ${circumference}`}
                      strokeDashoffset={strokeDashoffset}
                      className="transition-all duration-500"
                    />
                  );
                });
              })()}
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <p className="text-2xl font-bold">{assets.length}</p>
                <p className="text-xs text-gray-400">Assets</p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {assets.map((asset, i) => {
              const colors = [
                'bg-neon-cyan',
                'bg-neon-purple',
                'bg-green-500',
                'bg-amber-500',
                'bg-red-500',
              ];
              return (
                <div key={asset.id} className="flex items-center gap-3">
                  <div className={cn('w-3 h-3 rounded-full', colors[i % colors.length])} />
                  <span className="flex-1 text-sm">{asset.symbol}</span>
                  <span className="text-sm text-gray-400">{asset.allocation}%</span>
                  <span className="text-sm font-mono">
                    {showBalances ? formatCurrency(asset.value, true) : '••••'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Recent Transactions + News */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Transactions */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">Recent Transactions</h3>
            <button
              onClick={() => setViewMode('portfolio')}
              className="text-sm text-neon-cyan hover:underline"
            >
              View all
            </button>
          </div>

          <div className="space-y-3">
            {transactions.slice(0, 5).map((tx) => (
              <div
                key={tx.id}
                className="flex items-center gap-4 p-3 rounded-lg bg-lattice-deep/50"
              >
                <div
                  className={cn(
                    'w-10 h-10 rounded-full flex items-center justify-center',
                    tx.type === 'buy' && 'bg-green-500/20 text-green-400',
                    tx.type === 'sell' && 'bg-red-500/20 text-red-400',
                    tx.type === 'transfer' && 'bg-blue-500/20 text-blue-400',
                    tx.type === 'stake' && 'bg-purple-500/20 text-purple-400',
                    tx.type === 'reward' && 'bg-yellow-500/20 text-yellow-400'
                  )}
                >
                  {tx.type === 'buy' && <ArrowDownRight className="w-5 h-5" />}
                  {tx.type === 'sell' && <ArrowUpRight className="w-5 h-5" />}
                  {tx.type === 'transfer' && <ArrowRight className="w-5 h-5" />}
                  {tx.type === 'stake' && <Lock className="w-5 h-5" />}
                  {tx.type === 'reward' && <Star className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium capitalize">{tx.type}</p>
                    <span className="text-sm text-gray-400">{tx.symbol}</span>
                  </div>
                  <p className="text-xs text-gray-400">{formatTime(tx.timestamp)}</p>
                </div>
                <div className="text-right">
                  <p
                    className={cn(
                      'font-mono',
                      tx.type === 'sell' || tx.type === 'reward'
                        ? 'text-green-400'
                        : tx.type === 'buy'
                          ? 'text-red-400'
                          : 'text-gray-300'
                    )}
                  >
                    {tx.type === 'sell' || tx.type === 'reward'
                      ? '+'
                      : tx.type === 'buy'
                        ? '-'
                        : ''}
                    {formatCurrency(tx.value)}
                  </p>
                  <p className="text-xs text-gray-400">
                    {tx.amount} {tx.symbol}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* News */}
        <div className="panel p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Newspaper className="w-4 h-4 text-neon-cyan" />
              Market News
            </h3>
            <button
              onClick={() =>
                useUIStore
                  .getState()
                  .addToast({ type: 'info', message: 'Loading more market news' })
              }
              className="text-sm text-neon-cyan hover:underline"
            >
              More
            </button>
          </div>

          <div className="space-y-3">
            {news.map((newsItem) => (
              <div
                key={newsItem.id}
                className="p-3 rounded-lg bg-lattice-deep/50 hover:bg-lattice-elevated/50 cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full mt-2',
                      newsItem.sentiment === 'positive' && 'bg-green-400',
                      newsItem.sentiment === 'negative' && 'bg-red-400',
                      newsItem.sentiment === 'neutral' && 'bg-gray-400'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm leading-tight">{newsItem.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-gray-400">{newsItem.source}</span>
                      <span className="text-xs text-gray-500">·</span>
                      <span className="text-xs text-gray-400">
                        {formatTime(newsItem.timestamp)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-2">
                      {newsItem.assets.map((asset) => (
                        <span
                          key={asset}
                          className="px-2 py-0.5 bg-lattice-elevated rounded text-xs"
                        >
                          {asset}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  const renderTrade = () => {
    const selectedTradingAsset = assets.find((a) => a.symbol === tradeAsset) || assets[0];
    if (!selectedTradingAsset)
      return <div className="p-8 text-center text-gray-400">No assets available for trading.</div>;
    const estimatedValue =
      parseFloat(tradeAmount || '0') *
      (orderType === 'market' ? selectedTradingAsset.price : parseFloat(tradePrice || '0'));

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Order Book / Chart */}
        <div className="lg:col-span-2 space-y-4">
          <div className="panel p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <select
                  value={tradeAsset}
                  onChange={(e) => setTradeAsset(e.target.value)}
                  className="bg-lattice-deep rounded-lg px-4 py-2 font-semibold focus:outline-none focus:ring-1 focus:ring-neon-cyan"
                >
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.symbol}>
                      {asset.symbol}/USD
                    </option>
                  ))}
                </select>
                <div>
                  <p className="text-2xl font-bold">{formatCurrency(selectedTradingAsset.price)}</p>
                  <p
                    className={cn(
                      'text-sm',
                      selectedTradingAsset.changePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {formatPercent(selectedTradingAsset.changePercent24h)} today
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {(['1H', '24H', '7D', '30D'] as TimeRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setTimeRange(range)}
                    className={cn(
                      'px-3 py-1 rounded text-sm',
                      timeRange === range ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-gray-400'
                    )}
                  >
                    {range}
                  </button>
                ))}
              </div>
            </div>

            <div className="h-64">
              <canvas ref={chartRef} width={800} height={256} className="w-full h-full" />
            </div>
          </div>

          {/* Order Book */}
          <div className="panel p-4">
            <h3 className="font-semibold mb-4">Order Book</h3>
            <div className="grid grid-cols-2 gap-4">
              {/* Bids */}
              <div>
                <div className="text-xs text-gray-400 mb-2 flex justify-between">
                  <span>Price (USD)</span>
                  <span>Amount ({tradeAsset})</span>
                </div>
                {orders.filter(
                  (o) => o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
                ).length > 0 ? (
                  orders
                    .filter(
                      (o) => o.side === 'buy' && (o.status === 'open' || o.status === 'partial')
                    )
                    .slice(0, 8)
                    .map((order, i) => {
                      const depth = (order.filled / order.amount) * 100 || ((i + 1) / 8) * 100;
                      return (
                        <div key={order.id} className="relative flex justify-between text-sm py-1">
                          <div
                            className="absolute inset-0 bg-green-500/10"
                            style={{ width: `${depth}%` }}
                          />
                          <span className="relative text-green-400 font-mono">
                            {formatCurrency(order.price || selectedTradingAsset.price)}
                          </span>
                          <span className="relative text-gray-400 font-mono">
                            {order.amount.toFixed(4)}
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div className="text-center text-xs text-gray-500 py-4">No buy orders yet</div>
                )}
              </div>

              {/* Asks */}
              <div>
                <div className="text-xs text-gray-400 mb-2 flex justify-between">
                  <span>Price (USD)</span>
                  <span>Amount ({tradeAsset})</span>
                </div>
                {orders.filter(
                  (o) => o.side === 'sell' && (o.status === 'open' || o.status === 'partial')
                ).length > 0 ? (
                  orders
                    .filter(
                      (o) => o.side === 'sell' && (o.status === 'open' || o.status === 'partial')
                    )
                    .slice(0, 8)
                    .map((order, i) => {
                      const depth = (order.filled / order.amount) * 100 || ((i + 1) / 8) * 100;
                      return (
                        <div key={order.id} className="relative flex justify-between text-sm py-1">
                          <div
                            className="absolute inset-0 right-0 bg-red-500/10"
                            style={{ width: `${depth}%`, marginLeft: 'auto' }}
                          />
                          <span className="relative text-red-400 font-mono">
                            {formatCurrency(
                              order.price || order.stopPrice || selectedTradingAsset.price
                            )}
                          </span>
                          <span className="relative text-gray-400 font-mono">
                            {order.amount.toFixed(4)}
                          </span>
                        </div>
                      );
                    })
                ) : (
                  <div className="text-center text-xs text-gray-500 py-4">No sell orders yet</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Order Form */}
        <div className="panel p-4">
          <div className="flex items-center gap-2 mb-6">
            <button
              onClick={() => setTradeSide('buy')}
              className={cn(
                'flex-1 py-3 rounded-lg font-semibold transition-colors',
                tradeSide === 'buy'
                  ? 'bg-green-500 text-white'
                  : 'bg-lattice-deep text-gray-400 hover:text-white'
              )}
            >
              Buy
            </button>
            <button
              onClick={() => setTradeSide('sell')}
              className={cn(
                'flex-1 py-3 rounded-lg font-semibold transition-colors',
                tradeSide === 'sell'
                  ? 'bg-red-500 text-white'
                  : 'bg-lattice-deep text-gray-400 hover:text-white'
              )}
            >
              Sell
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">Order Type</label>
              <div className="flex items-center gap-2">
                {(['market', 'limit', 'stop'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setOrderType(type)}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-sm capitalize',
                      orderType === type
                        ? 'bg-neon-cyan/20 text-neon-cyan'
                        : 'bg-lattice-deep text-gray-400'
                    )}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {orderType !== 'market' && (
              <div>
                <label className="text-xs text-gray-400 mb-1 block">
                  {orderType === 'limit' ? 'Limit Price' : 'Stop Price'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                  <input
                    type="number"
                    value={tradePrice}
                    onChange={(e) => setTradePrice(e.target.value)}
                    placeholder={selectedTradingAsset.price.toString()}
                    className="w-full pl-8 pr-4 py-3 bg-lattice-deep rounded-lg focus:outline-none focus:ring-1 focus:ring-neon-cyan font-mono"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-gray-400 mb-1 block">Amount</label>
              <div className="relative">
                <input
                  type="number"
                  value={tradeAmount}
                  onChange={(e) => setTradeAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pr-20 py-3 bg-lattice-deep rounded-lg focus:outline-none focus:ring-1 focus:ring-neon-cyan font-mono"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {tradeAsset}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() =>
                      setTradeAmount(((selectedTradingAsset.holdings * pct) / 100).toString())
                    }
                    className="flex-1 py-1 text-xs bg-lattice-deep rounded hover:bg-lattice-elevated"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-lattice-border">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400">Available</span>
                <span>
                  {showBalances
                    ? `${selectedTradingAsset.holdings.toFixed(4)} ${tradeAsset}`
                    : '••••'}
                </span>
              </div>
              <div className="flex justify-between text-sm mb-4">
                <span className="text-gray-400">Estimated Value</span>
                <span className="font-mono">{formatCurrency(estimatedValue)}</span>
              </div>

              <button
                onClick={handleSubmitOrder}
                disabled={isSubmittingOrder || !tradeAmount}
                className={cn(
                  'w-full py-4 rounded-lg font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                  tradeSide === 'buy'
                    ? 'bg-green-500 hover:bg-green-600 text-white'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                )}
              >
                {isSubmittingOrder
                  ? 'Submitting...'
                  : `${tradeSide === 'buy' ? 'Buy' : 'Sell'} ${tradeAsset}`}
              </button>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="mt-6 pt-4 border-t border-lattice-border space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">24h High</span>
              <span className="text-green-400 font-mono">
                {formatCurrency(selectedTradingAsset.price * 1.05)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">24h Low</span>
              <span className="text-red-400 font-mono">
                {formatCurrency(selectedTradingAsset.price * 0.95)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">24h Volume</span>
              <span className="font-mono">
                {formatCurrency(selectedTradingAsset.volume24h, true)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Market Cap</span>
              <span className="font-mono">
                {formatCurrency(selectedTradingAsset.marketCap || 0, true)}
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderOrders = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Open Orders</h2>
        <button
          onClick={() =>
            useUIStore.getState().addToast({ type: 'info', message: 'Opening order form...' })
          }
          className="btn-neon"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Order
        </button>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-lattice-deep text-left text-xs text-gray-400">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Pair</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Side</th>
              <th className="px-4 py-3">Price</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Filled</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  No orders yet
                </td>
              </tr>
            )}
            {orders.map((order) => (
              <tr
                key={order.id}
                className="border-t border-lattice-border hover:bg-lattice-elevated/30"
              >
                <td className="px-4 py-4 text-sm text-gray-400">{formatTime(order.createdAt)}</td>
                <td className="px-4 py-4 font-medium">{order.symbol}/USD</td>
                <td className="px-4 py-4 capitalize text-sm">{order.type}</td>
                <td className="px-4 py-4">
                  <span
                    className={cn(
                      'px-2 py-1 rounded text-xs font-medium',
                      order.side === 'buy'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    )}
                  >
                    {order.side.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-4 font-mono text-sm">
                  {order.price
                    ? formatCurrency(order.price)
                    : order.stopPrice
                      ? `Stop: ${formatCurrency(order.stopPrice)}`
                      : 'Market'}
                </td>
                <td className="px-4 py-4 font-mono text-sm">{order.amount}</td>
                <td className="px-4 py-4">
                  <div className="w-20 h-2 bg-lattice-deep rounded-full overflow-hidden">
                    <div
                      className="h-full bg-neon-cyan"
                      style={{ width: `${(order.filled / order.amount) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-gray-400">
                    {((order.filled / order.amount) * 100).toFixed(0)}%
                  </span>
                </td>
                <td className="px-4 py-4">
                  <span
                    className={cn(
                      'px-2 py-1 rounded text-xs',
                      order.status === 'open' && 'bg-yellow-500/20 text-yellow-400',
                      order.status === 'partial' && 'bg-blue-500/20 text-blue-400',
                      order.status === 'filled' && 'bg-green-500/20 text-green-400',
                      order.status === 'cancelled' && 'bg-gray-500/20 text-gray-400'
                    )}
                  >
                    {order.status}
                  </span>
                </td>
                <td className="px-4 py-4">
                  <button
                    onClick={() =>
                      useUIStore
                        .getState()
                        .addToast({ type: 'info', message: `Cancelling order ${order.id}` })
                    }
                    className="p-2 rounded hover:bg-lattice-elevated text-gray-400 hover:text-red-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderAlerts = () => (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Price Alerts</h2>
        <button
          onClick={() =>
            useUIStore.getState().addToast({ type: 'info', message: 'Creating new price alert...' })
          }
          className="btn-neon"
        >
          <Plus className="w-4 h-4 mr-2" />
          New Alert
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {alerts.map((alert) => {
          const asset = assets.find((a) => a.symbol === alert.symbol);
          const triggered =
            alert.condition === 'above'
              ? (asset?.price || 0) >= alert.price
              : (asset?.price || 0) <= alert.price;

          return (
            <div key={alert.id} className={cn('panel p-4', triggered && 'ring-2 ring-neon-yellow')}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-neon-cyan/20 flex items-center justify-center text-neon-cyan font-bold">
                    {alert.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <p className="font-medium">{alert.symbol}</p>
                    <p className="text-xs text-gray-400">{alert.asset}</p>
                  </div>
                </div>
                <button
                  onClick={() =>
                    useUIStore
                      .getState()
                      .addToast({
                        type: 'info',
                        message: alert.active ? 'Alert paused' : 'Alert activated',
                      })
                  }
                  className={cn(
                    'p-2 rounded-lg',
                    alert.active ? 'text-neon-green' : 'text-gray-500'
                  )}
                >
                  {alert.active ? <Bell className="w-5 h-5" /> : <Bell className="w-5 h-5" />}
                </button>
              </div>

              <div className="flex items-center gap-2 mb-3">
                {alert.condition === 'above' ? (
                  <ArrowUpRight className="w-5 h-5 text-green-400" />
                ) : (
                  <ArrowDownRight className="w-5 h-5 text-red-400" />
                )}
                <span className="text-sm text-gray-400">Price goes {alert.condition}</span>
                <span className="font-mono font-bold">{formatCurrency(alert.price)}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Current:</span>
                <span className="font-mono">{formatCurrency(asset?.price || 0)}</span>
              </div>

              {triggered && (
                <div className="mt-3 p-2 bg-neon-yellow/10 rounded text-neon-yellow text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alert triggered!
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (isError || isError2 || isError3 || isError4 || isError5) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState
          error={
            error?.message ||
            error2?.message ||
            error3?.message ||
            error4?.message ||
            error5?.message
          }
          onRetry={() => {
            refetch();
            refetch2();
            refetch3();
            refetch4();
            refetch5();
          }}
        />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="flex flex-col items-center gap-4">
          <RefreshCw className="w-8 h-8 text-neon-cyan animate-spin" />
          <p className="text-gray-400">Loading finance data...</p>
        </div>
      </div>
    );
  }

  return (
    <div data-lens-theme="finance" className="p-6 space-y-6 bg-[#0c0f14] font-mono">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded bg-emerald-900/40 border border-emerald-700/30 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono tracking-tight text-emerald-100">
                Finance Lens
              </h1>
              <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} />
            </div>
            <p className="text-sm text-gray-400">Portfolio tracking & trading dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DTUExportButton domain="finance" data={{}} compact />
          <button
            onClick={() => {
              refetch();
              refetch2();
              refetch3();
              refetch4();
              refetch5();
            }}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          <button
            onClick={() => {
              const data = JSON.stringify({ assets: assetItems, transactions: txItems }, null, 2);
              const blob = new Blob([data], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'finance-export.json';
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
          >
            <Download className="w-5 h-5" />
          </button>
          <button
            onClick={() =>
              useUIStore.getState().addToast({ type: 'info', message: 'Finance settings' })
            }
            className="p-2 rounded-lg hover:bg-lattice-elevated text-gray-400"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      <RealtimeDataPanel
        domain="finance"
        data={realtimeData}
        isLive={isLive}
        lastUpdated={lastUpdated}
        insights={insights}
        compact
      />
      <UniversalActions domain="finance" artifactId={null} compact />

      {/* Finance Actions */}
      <div className="bg-white/5 border border-emerald-900/20 rounded-xl p-4 space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-400" />
          Finance Analysis
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            {
              action: 'portfolioAnalysis',
              label: 'Portfolio Analysis',
              icon: BarChart3,
              color: 'text-emerald-400',
            },
            {
              action: 'budgetTracker',
              label: 'Budget Tracker',
              icon: DollarSign,
              color: 'text-neon-cyan',
            },
            {
              action: 'compoundInterest',
              label: 'Compound Interest',
              icon: TrendingUp,
              color: 'text-neon-green',
            },
            { action: 'debtPayoff', label: 'Debt Payoff', icon: CreditCard, color: 'text-red-400' },
          ].map(({ action, label, icon: Icon, color }) => (
            <button
              key={action}
              onClick={() => handleFinanceAction(action)}
              disabled={!!financeRunning || !assetItems[0]?.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 border border-emerald-900/20 text-sm hover:border-emerald-500/30 disabled:opacity-40 transition-colors"
            >
              {financeRunning === action ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Icon className={`w-4 h-4 ${color}`} />
              )}
              <span className="truncate text-xs">{label}</span>
            </button>
          ))}
        </div>

        {financeActionResult && (
          <div className="mt-3 rounded-lg bg-black/30 border border-emerald-900/20 p-4 relative">
            <button
              onClick={() => setFinanceActionResult(null)}
              className="absolute top-3 right-3 text-gray-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>

            {/* portfolioAnalysis */}
            {financeActionResult._action === 'portfolioAnalysis' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Portfolio Analysis
                </p>
                {(financeActionResult.message as string) ? (
                  <p className="text-sm text-gray-400">{financeActionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        {
                          label: 'Total Value',
                          value: `$${((financeActionResult.totalValue as number) || 0).toLocaleString()}`,
                          color: 'text-emerald-400',
                        },
                        {
                          label: 'Gain/Loss',
                          value: `$${((financeActionResult.totalGainLoss as number) || 0).toLocaleString()}`,
                          color:
                            (financeActionResult.totalGainLoss as number) >= 0
                              ? 'text-neon-green'
                              : 'text-red-400',
                        },
                        {
                          label: 'Return',
                          value: `${financeActionResult.returnPercent ?? 0}%`,
                          color: 'text-neon-cyan',
                        },
                        {
                          label: 'Diversification',
                          value: String(financeActionResult.diversificationScore ?? '—'),
                          color:
                            financeActionResult.diversificationScore === 'well-diversified'
                              ? 'text-neon-green'
                              : 'text-yellow-400',
                        },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-black/20 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(financeActionResult.holdings) &&
                      (
                        financeActionResult.holdings as {
                          symbol: string;
                          value: number;
                          allocation: number;
                          gainLoss: number;
                          type: string;
                        }[]
                      )
                        .slice(0, 5)
                        .map((h) => (
                          <div
                            key={h.symbol}
                            className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5 font-mono"
                          >
                            <span className="text-white w-16">{h.symbol}</span>
                            <span className="text-gray-400 w-12">{h.type}</span>
                            <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500/60 rounded-full"
                                style={{ width: `${h.allocation}%` }}
                              />
                            </div>
                            <span className="text-gray-300 w-14 text-right">{h.allocation}%</span>
                            <span
                              className={`w-20 text-right ${h.gainLoss >= 0 ? 'text-neon-green' : 'text-red-400'}`}
                            >
                              ${h.gainLoss.toLocaleString()}
                            </span>
                          </div>
                        ))}
                  </>
                )}
              </div>
            )}

            {/* budgetTracker */}
            {financeActionResult._action === 'budgetTracker' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Budget Tracker
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Income',
                      value: `$${((financeActionResult.monthlyIncome as number) || 0).toLocaleString()}`,
                      color: 'text-neon-green',
                    },
                    {
                      label: 'Spent',
                      value: `$${((financeActionResult.totalSpent as number) || 0).toLocaleString()}`,
                      color: 'text-red-400',
                    },
                    {
                      label: 'Remaining',
                      value: `$${((financeActionResult.remaining as number) || 0).toLocaleString()}`,
                      color: 'text-neon-cyan',
                    },
                    {
                      label: 'Savings Rate',
                      value: `${financeActionResult.savingsRate ?? 0}%`,
                      color: 'text-emerald-400',
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-black/20 rounded-lg p-3 text-center">
                      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {Array.isArray(financeActionResult.categories) &&
                  (
                    financeActionResult.categories as {
                      category: string;
                      spent: number;
                      budget: number;
                      percentUsed: number;
                      status: string;
                    }[]
                  ).map((c) => (
                    <div key={c.category} className="flex items-center gap-3 text-xs">
                      <span className="text-gray-400 w-28 truncate">{c.category}</span>
                      <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${c.status === 'over-budget' ? 'bg-red-500/60' : c.status === 'near-limit' ? 'bg-yellow-500/60' : 'bg-emerald-500/60'}`}
                          style={{ width: `${Math.min(100, c.percentUsed)}%` }}
                        />
                      </div>
                      <span className="text-white w-10 text-right font-mono">{c.percentUsed}%</span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${c.status === 'over-budget' ? 'bg-red-400/20 text-red-400' : c.status === 'near-limit' ? 'bg-yellow-400/20 text-yellow-400' : 'bg-neon-green/20 text-neon-green'}`}
                      >
                        {c.status}
                      </span>
                    </div>
                  ))}
              </div>
            )}

            {/* compoundInterest */}
            {financeActionResult._action === 'compoundInterest' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Compound Interest Projection
                </p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'Final Balance',
                      value: `$${((financeActionResult.finalBalance as number) || 0).toLocaleString()}`,
                      color: 'text-emerald-400',
                    },
                    {
                      label: 'Contributed',
                      value: `$${((financeActionResult.totalContributed as number) || 0).toLocaleString()}`,
                      color: 'text-neon-cyan',
                    },
                    {
                      label: 'Interest Earned',
                      value: `$${((financeActionResult.totalInterest as number) || 0).toLocaleString()}`,
                      color: 'text-neon-green',
                    },
                    {
                      label: 'Rate',
                      value: String(financeActionResult.annualRate ?? '—'),
                      color: 'text-yellow-400',
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-black/20 rounded-lg p-3 text-center">
                      <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
                      <p className="text-xs text-gray-400">{label}</p>
                    </div>
                  ))}
                </div>
                {Array.isArray(financeActionResult.timeline) && (
                  <div className="grid grid-cols-5 gap-1">
                    {(financeActionResult.timeline as { year: number; balance: number }[])
                      .filter(
                        (_, i, arr) =>
                          i % Math.max(1, Math.floor(arr.length / 5)) === 0 || i === arr.length - 1
                      )
                      .slice(0, 5)
                      .map((t) => (
                        <div key={t.year} className="bg-black/20 rounded p-2 text-center">
                          <p className="text-xs text-gray-400">Yr {t.year}</p>
                          <p className="text-xs font-mono text-neon-green">
                            ${(t.balance / 1000).toFixed(0)}k
                          </p>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* debtPayoff */}
            {financeActionResult._action === 'debtPayoff' && (
              <div className="space-y-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Debt Payoff Plan
                </p>
                {(financeActionResult.message as string) ? (
                  <p className="text-sm text-gray-400">{financeActionResult.message as string}</p>
                ) : (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                      {[
                        {
                          label: 'Total Debt',
                          value: `$${((financeActionResult.totalDebt as number) || 0).toLocaleString()}`,
                          color: 'text-red-400',
                        },
                        {
                          label: 'Total Interest',
                          value: `$${((financeActionResult.totalInterest as number) || 0).toLocaleString()}`,
                          color: 'text-orange-400',
                        },
                        {
                          label: 'First Target',
                          value: String(financeActionResult.firstTarget ?? '—'),
                          color: 'text-neon-cyan',
                        },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="bg-black/20 rounded-lg p-3 text-center">
                          <p className={`text-sm font-bold font-mono ${color}`}>{value}</p>
                          <p className="text-xs text-gray-400">{label}</p>
                        </div>
                      ))}
                    </div>
                    {financeActionResult.strategy && (
                      <p className="text-xs text-gray-500 italic">
                        {financeActionResult.strategy as string}
                      </p>
                    )}
                    {Array.isArray(financeActionResult.debts) && (
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {(
                          financeActionResult.debts as {
                            name: string;
                            balance: number;
                            rate: string;
                            monthsToPayoff: number;
                          }[]
                        ).map((d) => (
                          <div
                            key={d.name}
                            className="flex items-center gap-3 text-xs px-2 py-1 rounded bg-white/5 font-mono"
                          >
                            <span className="flex-1 text-white">{d.name}</span>
                            <span className="text-red-400">${d.balance.toLocaleString()}</span>
                            <span className="text-orange-400">{d.rate}</span>
                            <span className="text-gray-400">
                              {d.monthsToPayoff < 999 ? `${d.monthsToPayoff}mo` : '∞'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex items-center gap-1 border-b border-emerald-900/20 pb-4">
        {(
          [
            { id: 'overview', label: 'Overview', icon: PieChart },
            { id: 'trade', label: 'Trade', icon: Activity },
            { id: 'orders', label: 'Orders', icon: Layers },
            { id: 'alerts', label: 'Alerts', icon: Bell },
            { id: 'news', label: 'News', icon: Newspaper },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            onClick={() => setViewMode(item.id)}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md transition-colors font-mono text-sm',
              viewMode === item.id
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                : 'text-gray-500 hover:text-emerald-300 hover:bg-emerald-900/10 border border-transparent'
            )}
          >
            <item.icon className="w-4 h-4" />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Content */}
      {viewMode === 'overview' && renderOverview()}
      {viewMode === 'trade' && renderTrade()}
      {viewMode === 'orders' && renderOrders()}
      {viewMode === 'alerts' && renderAlerts()}
      {viewMode === 'news' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Market News & Analysis</h2>
          <div className="grid gap-4">
            {news.map((newsItem) => (
              <div
                key={newsItem.id}
                className="panel p-4 hover:bg-lattice-elevated/50 cursor-pointer transition-colors"
              >
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'w-1 h-full min-h-[60px] rounded-full',
                      newsItem.sentiment === 'positive' && 'bg-green-400',
                      newsItem.sentiment === 'negative' && 'bg-red-400',
                      newsItem.sentiment === 'neutral' && 'bg-gray-400'
                    )}
                  />
                  <div className="flex-1">
                    <h3 className="font-semibold mb-1">{newsItem.title}</h3>
                    <div className="flex items-center gap-3 text-sm text-gray-400 mb-2">
                      <span>{newsItem.source}</span>
                      <span>·</span>
                      <span>{formatTime(newsItem.timestamp)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {newsItem.assets.map((asset) => (
                        <span
                          key={asset}
                          className="px-2 py-1 bg-lattice-deep rounded text-xs font-medium"
                        >
                          {asset}
                        </span>
                      ))}
                    </div>
                  </div>
                  <ExternalLink className="w-4 h-4 text-gray-400" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Asset Detail Modal */}
      <AnimatePresence>
        {selectedAsset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={() => setSelectedAsset(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-lattice-surface border border-lattice-border rounded-xl p-6 max-w-lg w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-neon-cyan/20 flex items-center justify-center text-neon-cyan text-xl font-bold">
                    {selectedAsset.symbol.slice(0, 2)}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedAsset.name}</h2>
                    <p className="text-gray-400">{selectedAsset.symbol}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedAsset(null)}
                  className="p-2 rounded-lg hover:bg-lattice-elevated"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="p-3 bg-lattice-deep rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Current Price</p>
                  <p className="text-xl font-bold">{formatCurrency(selectedAsset.price)}</p>
                  <p
                    className={cn(
                      'text-sm',
                      selectedAsset.changePercent24h >= 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {formatPercent(selectedAsset.changePercent24h)} today
                  </p>
                </div>
                <div className="p-3 bg-lattice-deep rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Your Holdings</p>
                  <p className="text-xl font-bold">
                    {showBalances ? selectedAsset.holdings.toLocaleString() : '••••'}
                  </p>
                  <p className="text-sm text-gray-400">
                    {showBalances ? formatCurrency(selectedAsset.value) : '••••'}
                  </p>
                </div>
                <div className="p-3 bg-lattice-deep rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Avg Buy Price</p>
                  <p className="text-xl font-bold">{formatCurrency(selectedAsset.avgBuyPrice)}</p>
                </div>
                <div className="p-3 bg-lattice-deep rounded-lg">
                  <p className="text-xs text-gray-400 mb-1">Total P&L</p>
                  <p
                    className={cn(
                      'text-xl font-bold',
                      selectedAsset.pnl >= 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {showBalances ? formatCurrency(selectedAsset.pnl) : '••••'}
                  </p>
                  <p
                    className={cn(
                      'text-sm',
                      selectedAsset.pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'
                    )}
                  >
                    {formatPercent(selectedAsset.pnlPercent)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setTradeAsset(selectedAsset.symbol);
                    setTradeSide('buy');
                    setViewMode('trade');
                    setSelectedAsset(null);
                  }}
                  className="flex-1 py-3 rounded-lg bg-green-500 text-white font-semibold hover:bg-green-600"
                >
                  Buy
                </button>
                <button
                  onClick={() => {
                    setTradeAsset(selectedAsset.symbol);
                    setTradeSide('sell');
                    setViewMode('trade');
                    setSelectedAsset(null);
                  }}
                  className="flex-1 py-3 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600"
                >
                  Sell
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Live Web Feed */}
      <div className="px-4 mb-2">
        <LensFeedPanel lensId="finance" />
      </div>

      {/* Lens Features */}
      <div className="border-t border-white/10">
        <button
          onClick={() => setShowFeatures(!showFeatures)}
          className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-300 hover:text-white transition-colors bg-white/[0.02] hover:bg-white/[0.04] rounded-lg"
        >
          <span className="flex items-center gap-2">
            <Layers className="w-4 h-4" />
            Lens Features & Capabilities
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`}
          />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="finance" />
          </div>
        )}
      </div>
    </div>
  );
}
