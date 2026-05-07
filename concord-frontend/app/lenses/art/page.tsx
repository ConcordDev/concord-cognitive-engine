'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useLensNav } from '@/hooks/useLensNav';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiHelpers } from '@/lib/api/client';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '@/store/ui';
import {
  Palette,
  Image as ImageIcon,
  Upload,
  Plus,
  Grid,
  Layers,
  Wand2,
  Download,
  Heart,
  Share2,
  Filter,
  Search,
  Eye,
  ShoppingBag,
  DollarSign,
  X,
  Brush,
  Droplets,
  Pen,
  Square,
  Circle,
  Type,
  Eraser,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Move,
  Pipette,
  Save,
  ChevronDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { ErrorState } from '@/components/common/EmptyState';
import { useLensDTUs } from '@/hooks/useLensDTUs';
import type { DTU } from '@/lib/api/generated-types';
import { LensContextPanel } from '@/components/lens/LensContextPanel';

import { ArtifactRenderer } from '@/components/artifact/ArtifactRenderer';
import { ArtifactUploader } from '@/components/artifact/ArtifactUploader';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { LensFeaturePanel } from '@/components/lens/LensFeaturePanel';
import { VisionAnalyzeButton } from '@/components/common/VisionAnalyzeButton';
import { PullToSubstrate } from '@/components/lens/PullToSubstrate';
import { FeedBanner } from '@/components/lens/FeedBanner';

type ViewMode = 'gallery' | 'canvas' | 'marketplace' | 'my-art';
type CanvasTool = 'brush' | 'eraser' | 'fill' | 'text' | 'shape-rect' | 'shape-circle' | 'eyedropper' | 'move' | 'pen' | 'rectangle' | 'circle' | 'line';

interface ArtAsset {
  id: string;
  title: string;
  description: string;
  type: string;
  tags: string[];
  ownerId: string;
  likes: number;
  plays: number;
  createdAt: number;
  metadata?: Record<string, unknown>;
}

interface ArtListing {
  id: string;
  title: string;
  artType: string;
  style: string;
  price: number;
  tags: string[];
  totalSales: number;
  ownerId: string;
  createdAt: number;
}

const ART_STYLES = ['Digital Painting', 'Pixel Art', 'Vector', 'Photo Manipulation', '3D Render', 'Abstract', 'Collage', 'Generative', 'Album Cover', 'Typography'];
const ART_TYPES = ['cover-art', 'banner', 'logo', 'illustration', 'background', 'character', 'concept-art', 'poster', 'social-media', 'nft'];

const COLOR_PALETTE = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#82E0AA', '#F8C471', '#E74C3C', '#3498DB', '#2ECC71', '#9B59B6',
];

export default function ArtLensPage() {
  useLensNav('art');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('art');
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [showFeatures, setShowFeatures] = useState(true);

  // Backend action wiring
  const runAction = useRunArtifact('art');
  const { items: artItems } = useLensData<Record<string, unknown>>('art', 'artwork', { seed: [] });
  const [actionResult, setActionResult] = useState<Record<string, unknown> | null>(null);
  const [isRunning, setIsRunning] = useState<string | null>(null);

  const handleArtAction = async (action: string) => {
    const targetId = artItems[0]?.id;
    if (!targetId) return;
    setIsRunning(action);
    try {
      const res = await runAction.mutateAsync({ id: targetId, action });
      if (res.ok === false) { setActionResult({ message: `Action failed: ${(res as Record<string, unknown>).error || 'Unknown error'}` }); } else { setActionResult(res.result as Record<string, unknown>); }
    } catch (e) { console.error(`Action ${action} failed:`, e); setActionResult({ message: `Action failed: ${e instanceof Error ? e.message : 'Unknown error'}` }); }
    setIsRunning(null);
  };

  const [viewMode, setViewMode] = useState<ViewMode>('gallery');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStyle, setSelectedStyle] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateListing, setShowCreateListing] = useState(false);

  // Canvas state
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('brush');
  const [brushSize, setBrushSize] = useState(5);
  const [brushColor, setBrushColor] = useState('#FFFFFF');
  const [canvasZoom, setCanvasZoom] = useState(100);
  const [canvasTitle, setCanvasTitle] = useState('Untitled Artwork');
  const [artTypeFilter, setArtTypeFilter] = useState<string | null>(null);
  const [myArtView, setMyArtView] = useState<'grid' | 'list'>('grid');

  // Drawing state
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const undoStackRef = useRef<ImageData[]>([]);
  const redoStackRef = useRef<ImageData[]>([]);
  const [brushOpacity, setBrushOpacity] = useState(100);

  // Dynamic brush cursor — shows brush size circle
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const showBrushCursor = canvasTool === 'brush' || canvasTool === 'eraser';

  // Keyboard shortcuts for tools — use refs for undo/redo to avoid stale closures
  const undoFnRef = useRef<() => void>(() => {});
  const redoFnRef = useRef<() => void>(() => {});
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const key = e.key.toLowerCase();
      if (key === 'b') setCanvasTool('brush');
      else if (key === 'e') setCanvasTool('eraser');
      else if (key === 'g') setCanvasTool('fill');
      else if (key === 'i') setCanvasTool('eyedropper');
      else if (key === 't') setCanvasTool('text');
      else if (key === 'r') setCanvasTool('rectangle');
      else if (key === 'c') setCanvasTool('circle');
      else if (key === 'l') setCanvasTool('line');
      else if (key === '[') setBrushSize(s => Math.max(1, s - 2));
      else if (key === ']') setBrushSize(s => Math.min(100, s + 2));
      else if (e.ctrlKey && key === 'z' && !e.shiftKey) { e.preventDefault(); undoFnRef.current(); }
      else if ((e.ctrlKey && key === 'z' && e.shiftKey) || (e.ctrlKey && key === 'y')) { e.preventDefault(); redoFnRef.current(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Initialize canvas with white background
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    undoStackRef.current = [ctx.getImageData(0, 0, canvas.width, canvas.height)];
  }, []);

  const saveToUndoStack = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    undoStackRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    redoStackRef.current = [];
  }, []);

  const getCanvasPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const drawLine = useCallback((ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, []);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);
    isDrawingRef.current = true;
    lastPosRef.current = pos;
    saveToUndoStack();

    if (canvasTool === 'fill') {
      ctx.fillStyle = brushColor;
      ctx.globalAlpha = brushOpacity / 100;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
      isDrawingRef.current = false;
      return;
    }

    if (canvasTool === 'eyedropper') {
      const pixel = ctx.getImageData(pos.x, pos.y, 1, 1).data;
      const hex = '#' + [pixel[0], pixel[1], pixel[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      setBrushColor(hex);
      isDrawingRef.current = false;
      return;
    }

    if (canvasTool === 'text') {
      const text = prompt('Enter text:');
      if (text) {
        ctx.fillStyle = brushColor;
        ctx.globalAlpha = brushOpacity / 100;
        ctx.font = `${brushSize * 3}px sans-serif`;
        ctx.fillText(text, pos.x, pos.y);
        ctx.globalAlpha = 1;
      }
      isDrawingRef.current = false;
      return;
    }

    // Set up drawing context
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = brushOpacity / 100;

    if (canvasTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = brushColor;
    }

    // Draw a dot at click position
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = canvasTool === 'eraser' ? 'rgba(0,0,0,1)' : brushColor;
    ctx.fill();
  }, [canvasTool, brushColor, brushSize, brushOpacity, getCanvasPos, saveToUndoStack]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastPosRef.current) return;
    if (canvasTool === 'move' || canvasTool === 'eyedropper' || canvasTool === 'fill' || canvasTool === 'text') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getCanvasPos(e);

    if (canvasTool === 'shape-rect' || canvasTool === 'shape-circle') {
      // Shapes preview on move — restore last saved state and draw shape
      const lastState = undoStackRef.current[undoStackRef.current.length - 1];
      if (lastState) ctx.putImageData(lastState, 0, 0);
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.globalAlpha = brushOpacity / 100;
      ctx.globalCompositeOperation = 'source-over';
      const start = lastPosRef.current;
      if (canvasTool === 'shape-rect') {
        ctx.strokeRect(start.x, start.y, pos.x - start.x, pos.y - start.y);
      } else {
        const rx = Math.abs(pos.x - start.x) / 2;
        const ry = Math.abs(pos.y - start.y) / 2;
        const cx = (start.x + pos.x) / 2;
        const cy = (start.y + pos.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      return;
    }

    drawLine(ctx, lastPosRef.current, pos);
    lastPosRef.current = pos;
  }, [canvasTool, brushColor, brushSize, brushOpacity, getCanvasPos, drawLine]);

  const handleCanvasMouseUp = useCallback(() => {
    if (isDrawingRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  // AI generation state
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Upload form
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadTags, setUploadTags] = useState('');
  const [uploadStyle, setUploadStyle] = useState('Digital Painting');

  // Listing form
  const [listingTitle, setListingTitle] = useState('');
  const [listingType, setListingType] = useState('cover-art');
  const [listingStyle, setListingStyle] = useState('digital');
  const [listingPrice, setListingPrice] = useState('50');
  const [listingTags, setListingTags] = useState('');

  const { data: artAssets, isLoading: assetsLoading, isError: isError, error: error, refetch: refetch,} = useQuery({
    queryKey: ['art-assets', selectedStyle, searchQuery],
    queryFn: () => apiHelpers.artistry.assets.list({ type: 'artwork', search: searchQuery || undefined })
    .then(r => r.data?.assets || []).catch((err) => { console.error('Failed to fetch art assets:', err instanceof Error ? err.message : err); return []; }),
    initialData: [],
  });

  const { data: artListings, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['art-marketplace'],
    queryFn: () => apiHelpers.artistry.marketplace.art.list().then(r => r.data?.artworks || []).catch((err) => { console.error('Failed to fetch art listings:', err instanceof Error ? err.message : err); return []; }),
    initialData: [],
  });

  // DTU context (v3.0 artifact support)
  const {
    contextDTUs, hyperDTUs, megaDTUs, regularDTUs, domainDTUs,
    tierDistribution, publishToMarketplace: publishDTU,
    isLoading: dtusLoading, refetch: refetchDTUs,
  } = useLensDTUs({ lens: 'art' });

  const imageArtifacts = contextDTUs.filter((d: DTU) => d.artifact?.type?.startsWith('image/'));

  const uploadMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiHelpers.artistry.assets.create(data as { type: string; title?: string; description?: string; tags?: string[]; genre?: string; bpm?: number; key?: string; ownerId?: string; metadata?: Record<string, unknown> }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['art-assets'] });
      setShowUpload(false);
      setUploadTitle('');
      setUploadDescription('');
      setUploadTags('');
    },
    onError: (err) => {
      console.error('Upload failed:', err instanceof Error ? err.message : err);
    },
  });

  const createListingMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => apiHelpers.artistry.marketplace.art.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['art-marketplace'] });
      setShowCreateListing(false);
    },
    onError: (err) => {
      console.error('Failed to create listing:', err instanceof Error ? err.message : err);
    },
  });

  const handleUpload = useCallback(() => {
    uploadMutation.mutate({
      type: 'artwork',
      title: uploadTitle || 'Untitled',
      description: uploadDescription,
      tags: uploadTags.split(',').map(t => t.trim()).filter(Boolean),
      metadata: { style: uploadStyle },
    });
  }, [uploadTitle, uploadDescription, uploadTags, uploadStyle, uploadMutation]);

  const handleCreateListing = useCallback(() => {
    createListingMutation.mutate({
      title: listingTitle,
      artType: listingType,
      style: listingStyle,
      price: Number(listingPrice),
      tags: listingTags.split(',').map(t => t.trim()).filter(Boolean),
    });
  }, [listingTitle, listingType, listingStyle, listingPrice, listingTags, createListingMutation]);

  const purchaseMutation = useMutation({
    mutationFn: (listingId: string) => apiHelpers.artistry.marketplace.purchase({ buyerId: 'current-user', listingId, listingType: 'art' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['art-marketplace'] });
      useUIStore.getState().addToast({ type: 'success', message: 'Purchase complete!' });
    },
    onError: () => {
      useUIStore.getState().addToast({ type: 'error', message: 'Operation failed. Please try again.' });
    },
  });

  const handleCanvasUndo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (undoStackRef.current.length <= 1) return;
    const current = undoStackRef.current.pop()!;
    redoStackRef.current.push(current);
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    if (prev) ctx.putImageData(prev, 0, 0);
  }, []);

  const handleCanvasRedo = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(next);
    ctx.putImageData(next, 0, 0);
  }, []);

  // Wire keyboard shortcut refs to actual handlers
  undoFnRef.current = handleCanvasUndo;
  redoFnRef.current = handleCanvasRedo;

  const handleCanvasSave = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Upload as media with actual image data
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      await api.post('/api/media/upload', {
        title: canvasTitle || 'Untitled',
        mediaType: 'image',
        mimeType: 'image/png',
        fileSize: Math.ceil(base64Data.length * 0.75),
        originalFilename: `${canvasTitle.replace(/\s+/g, '-').toLowerCase()}.png`,
        tags: ['art', 'canvas'],
        data: base64Data,
      });
      useUIStore.getState().addToast({ type: 'success', message: 'Artwork saved!' });
    } catch (err) {
      console.error('Save failed:', err);
      useUIStore.getState().addToast({ type: 'error', message: 'Failed to save artwork' });
    }
  }, [canvasTitle]);

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;
    setAiGenerating(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await api.post('/api/lens/run', {
        domain: 'art',
        action: 'generate',
        input: { prompt: aiPrompt.trim(), type: 'text-to-image' },
      });
      const data = res.data;
      const content = typeof data?.result === 'string'
        ? data.result
        : typeof data?.result?.content === 'string'
          ? data.result.content
          : typeof data?.result?.url === 'string'
            ? data.result.url
            : JSON.stringify(data?.result ?? data, null, 2);
      setAiResult(content);
      useUIStore.getState().addToast({ type: 'success', message: 'AI generation complete' });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt]);

  const handleCanvasExport = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${canvasTitle.replace(/\s+/g, '-').toLowerCase()}.png`;
    a.click();
  }, [canvasTitle]);

  const handleShareArt = useCallback((artId: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/lenses/art?id=${artId}`);
    useUIStore.getState().addToast({ type: 'success', message: 'Link copied to clipboard' });
  }, []);

  const handleDownloadArt = useCallback(async (artId: string) => {
    try {
      const resp = await apiHelpers.durableArtifacts.download(artId);
      const url = URL.createObjectURL(resp.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `artwork-${artId}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      useUIStore.getState().addToast({ type: 'info', message: 'Download not available for this item' });
    }
  }, []);

  const handleListArt = useCallback((artId: string) => {
    setShowCreateListing(true);
    setListingTitle(`Artwork ${artId}`);
  }, []);

  const renderNav = () => (
    <div className="flex items-center justify-between border-b border-rose-900/15 px-6 py-3 bg-neutral-950/50">
      <div className="flex items-center gap-2">
        <Palette className="w-6 h-6 text-rose-400" />
        <h1 className="text-xl font-bold text-rose-50 tracking-tight">Art Studio</h1>
        {dtusLoading ? (
          <span className="ml-2 w-4 h-4 border-2 border-neon-pink border-t-transparent rounded-full animate-spin inline-block" />
        ) : (
          <span className="ml-2 text-xs text-gray-400">({domainDTUs.length} DTUs)</span>
        )}
      </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="art" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {(['gallery', 'canvas', 'marketplace', 'my-art'] as ViewMode[]).map(mode => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize',
              viewMode === mode ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-white/5'
            )}
          >
            {mode === 'my-art' ? 'My Art' : mode}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <VisionAnalyzeButton
          domain="art"
          prompt="Analyze this artwork image. Describe the style, medium, colors, composition, and mood. Suggest relevant tags for categorization."
          onResult={(res) => {
            setUploadDescription(res.analysis);
            if (res.suggestedTags?.length) setUploadTags(res.suggestedTags.join(', '));
          }}
        />
        <button onClick={() => setShowUpload(true)} className="flex items-center gap-2 px-4 py-2 bg-neon-pink/20 text-neon-pink rounded-lg hover:bg-neon-pink/30 text-sm">
          <Upload className="w-4 h-4" />
          Upload
        </button>
        <button onClick={() => setViewMode('canvas')} className="flex items-center gap-2 px-4 py-2 bg-neon-purple/20 text-neon-purple rounded-lg hover:bg-neon-purple/30 text-sm">
          <Brush className="w-4 h-4" />
          Create
        </button>
      </div>
    </div>
  );

  const renderGallery = () => (
    <div className="p-6 space-y-6">
      <FeedBanner domain="art" />
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search artwork..."
            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setSelectedStyle(null)}
            className={cn('px-3 py-1.5 rounded-full text-xs whitespace-nowrap', !selectedStyle ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/5 text-gray-400 hover:text-white')}
          >
            All
          </button>
          {ART_STYLES.slice(0, 6).map(style => (
            <button
              key={style}
              onClick={() => setSelectedStyle(selectedStyle === style ? null : style)}
              className={cn('px-3 py-1.5 rounded-full text-xs whitespace-nowrap', selectedStyle === style ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/5 text-gray-400 hover:text-white')}
            >
              {style}
            </button>
          ))}
        </div>
      </div>

      {/* Featured Section */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-bold">Featured Artwork</h2>
          {assetsLoading && <span className="w-4 h-4 border-2 border-neon-pink border-t-transparent rounded-full animate-spin inline-block" />}
        </div>
        <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
          {(artAssets as ArtAsset[]).length > 0 ? (artAssets as ArtAsset[]).map((art: ArtAsset) => (
            <motion.div
              key={art.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="group relative rounded-xl overflow-hidden bg-neutral-900/50 border border-neutral-800/30 hover:border-rose-400/30 transition-all duration-300 cursor-pointer break-inside-avoid mb-4 hover:shadow-xl hover:shadow-rose-900/10"
            >
              <div className="aspect-[3/4] bg-gradient-to-br from-rose-900/20 to-neutral-900/40 flex items-center justify-center">
                <ImageIcon className="w-16 h-16 opacity-20 text-rose-300" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                <div className="absolute bottom-0 left-0 right-0 p-4">
                  <p className="font-medium text-sm truncate text-rose-50">{art.title}</p>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-rose-200/70">
                    <span className="flex items-center gap-1"><Heart className="w-3 h-3 text-rose-400" />{art.likes}</span>
                    <span className="flex items-center gap-1"><Eye className="w-3 h-3" />{art.plays}</span>
                    <PullToSubstrate domain="art" artifactId={art.id} compact />
                  </div>
                </div>
              </div>
            </motion.div>
          )) : (
            // Placeholder cards
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-xl overflow-hidden bg-white/5 border border-white/10">
                <div className="aspect-square flex items-center justify-center" style={{ background: `linear-gradient(135deg, hsl(${i * 45}, 60%, 25%), hsl(${i * 45 + 60}, 60%, 20%))` }}>
                  <ImageIcon className="w-12 h-12 opacity-20" />
                </div>
                <div className="p-3">
                  <p className="font-medium text-sm text-gray-300">{['Neon Dreams', 'Digital Horizons', 'Abstract Flow', 'Cosmic Pulse', 'Neural Art', 'Pixel Paradise', 'Wave Form', 'Fractal Mind'][i]}</p>
                  <p className="text-xs text-gray-500 mt-1">{ART_STYLES[i % ART_STYLES.length]}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Trending */}
      <section>
        <h2 className="text-lg font-bold mb-4">Trending Styles</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {ART_STYLES.map((style, i) => (
            <button
              key={style}
              onClick={() => setSelectedStyle(style)}
              className="p-4 rounded-xl text-left text-sm font-bold overflow-hidden relative hover:scale-[1.02] transition-transform"
              style={{ background: `linear-gradient(135deg, hsl(${i * 36}, 70%, 35%), hsl(${i * 36 + 40}, 60%, 25%))` }}
            >
              <Palette className="absolute top-2 right-2 w-8 h-8 opacity-20" />
              {style}
            </button>
          ))}
        </div>
      </section>
    </div>
  );

  const renderCanvas = () => {
    const tools: { id: CanvasTool; icon: React.ElementType; label: string }[] = [
      { id: 'brush', icon: Brush, label: 'Brush' },
      { id: 'pen', icon: Pen, label: 'Pen' },
      { id: 'eraser', icon: Eraser, label: 'Eraser' },
      { id: 'fill', icon: Droplets, label: 'Fill' },
      { id: 'text', icon: Type, label: 'Text' },
      { id: 'shape-rect', icon: Square, label: 'Rectangle' },
      { id: 'shape-circle', icon: Circle, label: 'Circle' },
      { id: 'eyedropper', icon: Pipette, label: 'Eyedropper' },
      { id: 'move', icon: Move, label: 'Move' },
    ];

    return (
      <div className="flex h-full">
        {/* Toolbar */}
        <aside className="w-16 bg-black/40 border-r border-white/10 flex flex-col items-center py-4 gap-2">
          {tools.map(tool => (
            <button
              key={tool.id}
              onClick={() => setCanvasTool(tool.id)}
              title={tool.label}
              className={cn(
                'w-10 h-10 rounded-lg flex items-center justify-center transition-colors',
                canvasTool === tool.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white hover:bg-white/10'
              )}
            >
              <tool.icon className="w-5 h-5" />
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={handleCanvasUndo} title="Undo" className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10">
            <Undo2 className="w-5 h-5" />
          </button>
          <button onClick={handleCanvasRedo} title="Redo" className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10">
            <Redo2 className="w-5 h-5" />
          </button>
        </aside>

        {/* Canvas Area */}
        <main className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-black/20">
            <input
              type="text"
              value={canvasTitle}
              onChange={e => setCanvasTitle(e.target.value)}
              className="bg-transparent text-sm font-medium focus:outline-none"
            />
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <button onClick={() => setCanvasZoom(Math.max(25, canvasZoom - 25))} className="p-1 text-gray-400 hover:text-white"><ZoomOut className="w-4 h-4" /></button>
                <span className="text-xs text-gray-400 w-10 text-center">{canvasZoom}%</span>
                <button onClick={() => setCanvasZoom(Math.min(400, canvasZoom + 25))} className="p-1 text-gray-400 hover:text-white"><ZoomIn className="w-4 h-4" /></button>
              </div>
              <button onClick={handleCanvasSave} className="flex items-center gap-1.5 px-3 py-1.5 bg-neon-pink/20 text-neon-pink rounded text-xs hover:bg-neon-pink/30">
                <Save className="w-3.5 h-3.5" />
                Save
              </button>
              <button onClick={handleCanvasExport} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 text-gray-300 rounded text-xs hover:bg-white/20">
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center bg-[#1a1a2e] overflow-auto p-8 relative">
            <div className="relative">
              <canvas
                ref={canvasRef}
                width={1024}
                height={768}
                className="bg-white/10 border border-white/20 rounded shadow-2xl"
                style={{
                  width: `${1024 * canvasZoom / 100}px`,
                  height: `${768 * canvasZoom / 100}px`,
                  cursor: showBrushCursor ? 'none' : canvasTool === 'eyedropper' ? 'crosshair' : canvasTool === 'text' ? 'text' : 'crosshair',
                }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={(e) => {
                  handleCanvasMouseMove(e);
                  if (showBrushCursor) {
                    const rect = canvasRef.current?.getBoundingClientRect();
                    if (rect) setCursorPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }
                }}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={() => { handleCanvasMouseUp(); setCursorPos(null); }}
                onMouseEnter={() => setCursorPos({ x: 0, y: 0 })}
              />
              {/* Dynamic brush cursor */}
              {showBrushCursor && cursorPos && (
                <div
                  className="pointer-events-none absolute rounded-full border"
                  style={{
                    width: `${brushSize * canvasZoom / 100}px`,
                    height: `${brushSize * canvasZoom / 100}px`,
                    left: `${cursorPos.x - (brushSize * canvasZoom / 100) / 2}px`,
                    top: `${cursorPos.y - (brushSize * canvasZoom / 100) / 2}px`,
                    borderColor: canvasTool === 'eraser' ? 'rgba(255,255,255,0.5)' : brushColor,
                    opacity: 0.8,
                  }}
                />
              )}
            </div>
            {/* Keyboard shortcut hint */}
            <div className="absolute bottom-4 left-4 text-xs text-gray-500 space-x-3 select-none">
              <span title="Brush">B</span>
              <span title="Eraser">E</span>
              <span title="Fill">G</span>
              <span title="Eyedropper">I</span>
              <span title="Text">T</span>
              <span title="Rectangle">R</span>
              <span title="Circle">C</span>
              <span title="Line">L</span>
              <span className="text-gray-600">|</span>
              <span title="Decrease brush size">[</span>
              <span title="Increase brush size">]</span>
              <span className="text-gray-600">|</span>
              <span title="Undo">Ctrl+Z</span>
            </div>
          </div>
        </main>

        {/* Properties Panel */}
        <aside className="w-64 bg-black/40 border-l border-white/10 p-4 space-y-6 overflow-y-auto">
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Brush Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Size: {brushSize}px</label>
                <input type="range" min="1" max="100" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} className="w-full accent-neon-pink" />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Opacity: {brushOpacity}%</label>
                <input type="range" min="1" max="100" value={brushOpacity} onChange={e => setBrushOpacity(Number(e.target.value))} className="w-full accent-neon-pink" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Color</h3>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-lg border border-white/20" style={{ backgroundColor: brushColor }} />
              <input type="color" value={brushColor} onChange={e => setBrushColor(e.target.value)} className="w-8 h-8 cursor-pointer" />
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {COLOR_PALETTE.map(color => (
                <button
                  key={color}
                  onClick={() => setBrushColor(color)}
                  className={cn('w-7 h-7 rounded-md border transition-transform hover:scale-110', brushColor === color ? 'border-white scale-110' : 'border-white/10')}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Layers</h3>
            <div className="space-y-1">
              {['Background', 'Layer 1', 'Layer 2'].map((layer, i) => (
                <div key={i} className={cn('flex items-center gap-2 px-2 py-1.5 rounded text-sm', i === 1 ? 'bg-white/10' : 'hover:bg-white/5')}>
                  <Layers className="w-3.5 h-3.5 text-gray-400" />
                  <span className="flex-1 text-gray-300">{layer}</span>
                  <Eye className="w-3.5 h-3.5 text-gray-400 cursor-pointer hover:text-white" />
                </div>
              ))}
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Layer added' })} className="flex items-center gap-2 px-2 py-1.5 text-sm text-gray-400 hover:text-white w-full">
                <Plus className="w-3.5 h-3.5" />
                Add Layer
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">AI Assist</h3>
            <div className="space-y-2">
              <input
                type="text"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAiGenerate()}
                placeholder="Describe artwork to generate..."
                className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs focus:outline-none focus:border-neon-purple/50"
              />
              <button
                onClick={handleAiGenerate}
                disabled={aiGenerating || !aiPrompt.trim()}
                className="w-full flex items-center gap-2 px-3 py-2 bg-neon-purple/10 text-neon-purple rounded-lg text-xs hover:bg-neon-purple/20 disabled:opacity-50"
              >
                {aiGenerating ? (
                  <span className="w-4 h-4 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                {aiGenerating ? 'Generating...' : 'Generate from Text'}
              </button>
              {aiError && (
                <p className="text-xs text-red-400 px-1">{aiError}</p>
              )}
              {aiResult && (
                <div className="p-2 rounded-lg bg-neon-purple/5 border border-neon-purple/20">
                  <p className="text-xs text-gray-300 whitespace-pre-wrap max-h-32 overflow-auto">{aiResult}</p>
                  <button
                    onClick={() => {
                      const blob = new Blob([aiResult], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = 'ai-art-result.txt';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center gap-1 mt-2 px-2 py-1 text-xs text-neon-purple hover:bg-neon-purple/10 rounded"
                  >
                    <Download className="w-3 h-3" /> Download
                  </button>
                </div>
              )}
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Style transfer initiated' })} className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 text-gray-300 rounded-lg text-xs hover:bg-white/10">
                <Palette className="w-4 h-4" />
                Style Transfer
              </button>
              <button onClick={() => useUIStore.getState().addToast({ type: 'info', message: 'Auto-enhance applied' })} className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 text-gray-300 rounded-lg text-xs hover:bg-white/10">
                <Filter className="w-4 h-4" />
                Auto-Enhance
              </button>
            </div>
          </div>
        </aside>
      </div>
    );
  };

  const renderMarketplace = () => (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Art Marketplace</h2>
        <button onClick={() => setShowCreateListing(true)} className="flex items-center gap-2 px-4 py-2 bg-neon-pink/20 text-neon-pink rounded-lg text-sm">
          <ShoppingBag className="w-4 h-4" />
          List Artwork
        </button>
      </div>

      <div className="flex gap-3 flex-wrap pb-2">
        {ART_TYPES.map(type => (
          <button key={type} onClick={() => setArtTypeFilter(artTypeFilter === type ? null : type)} className={cn('px-3 py-1.5 rounded-full text-xs whitespace-nowrap capitalize', artTypeFilter === type ? 'bg-neon-pink/20 text-neon-pink' : 'bg-white/5 text-gray-400 hover:text-white')}>
            {type.replace('-', ' ')}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(artListings as ArtListing[]).length > 0 ? (artListings as ArtListing[]).map((listing: ArtListing) => (
          <div key={listing.id} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden hover:border-neon-pink/30 transition-colors">
            <div className="aspect-[4/3] bg-gradient-to-br from-purple-600/20 to-pink-600/20 flex items-center justify-center">
              <ImageIcon className="w-12 h-12 opacity-20" />
            </div>
            <div className="p-4">
              <h3 className="font-medium">{listing.title}</h3>
              <p className="text-xs text-gray-400 mt-1 capitalize">{listing.artType} - {listing.style}</p>
              <div className="flex items-center justify-between mt-3">
                <span className="text-neon-green font-bold">${listing.price}</span>
                <span className="text-xs text-gray-400">{listing.totalSales} sold</span>
              </div>
              <button onClick={() => purchaseMutation.mutate(listing.id)} disabled={purchaseMutation.isPending} className="w-full mt-3 px-4 py-2 bg-neon-pink/20 text-neon-pink rounded-lg text-sm hover:bg-neon-pink/30 disabled:opacity-50">
                {purchaseMutation.isPending ? 'Processing...' : 'Purchase'}
              </button>
            </div>
          </div>
        )) : (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <div className="aspect-[4/3] flex items-center justify-center" style={{ background: `linear-gradient(135deg, hsl(${i * 60}, 50%, 20%), hsl(${i * 60 + 30}, 50%, 15%))` }}>
                <ImageIcon className="w-10 h-10 opacity-20" />
              </div>
              <div className="p-4">
                <h3 className="font-medium text-gray-300">{['Album Cover Pack', 'Neon Logo Kit', 'Abstract Backgrounds', 'Character Set', 'Social Media Kit', 'Poster Templates'][i]}</h3>
                <p className="text-xs text-gray-500 mt-1">{ART_TYPES[i]?.replace('-', ' ')}</p>
                <div className="flex items-center justify-between mt-3">
                  <span className="text-neon-green font-bold">${[25, 50, 35, 75, 15, 100][i]}</span>
                  <button onClick={() => setViewMode('gallery')} className="px-3 py-1.5 bg-white/10 text-gray-300 rounded text-xs hover:bg-white/20">View</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderMyArt = () => (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">My Artwork</h2>
        <div className="flex items-center gap-2">
          <button onClick={() => setMyArtView('grid')} className={cn('p-2', myArtView === 'grid' ? 'text-white' : 'text-gray-400 hover:text-white')}><Grid className="w-5 h-5" /></button>
          <button onClick={() => setMyArtView('list')} className={cn('p-2', myArtView === 'list' ? 'text-white' : 'text-gray-400 hover:text-white')}><Layers className="w-5 h-5" /></button>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <button
          onClick={() => setViewMode('canvas')}
          className="aspect-square rounded-xl border-2 border-dashed border-white/20 flex flex-col items-center justify-center gap-2 hover:border-neon-pink/50 hover:bg-neon-pink/5 transition-colors"
        >
          <Plus className="w-8 h-8 text-gray-400" />
          <span className="text-xs text-gray-400">New Artwork</span>
        </button>
        {(artAssets as ArtAsset[]).filter((a: ArtAsset) => a.type === 'artwork').map((art: ArtAsset) => (
          <div key={art.id} className="aspect-square rounded-xl bg-white/5 border border-white/10 overflow-hidden group relative cursor-pointer hover:border-neon-pink/30">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-600/20 to-pink-600/20 flex items-center justify-center">
              <ImageIcon className="w-10 h-10 opacity-20" />
            </div>
            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2">
              <span className="text-sm font-medium">{art.title}</span>
              <div className="flex gap-2">
                <PullToSubstrate domain="art" artifactId={art.id} compact />
                <button onClick={() => handleShareArt(art.id)} className="p-1.5 bg-white/10 rounded hover:bg-white/20"><Share2 className="w-4 h-4" /></button>
                <button onClick={() => handleDownloadArt(art.id)} className="p-1.5 bg-white/10 rounded hover:bg-white/20"><Download className="w-4 h-4" /></button>
                <button onClick={() => handleListArt(art.id)} className="p-1.5 bg-white/10 rounded hover:bg-white/20"><DollarSign className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );


  if (isError || isError2) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message} onRetry={() => { refetch(); refetch2(); }} />
      </div>
    );
  }
  return (
    <div data-lens-theme="art" className="h-[calc(100vh-4rem)] flex flex-col bg-gradient-to-b from-rose-950/10 via-neutral-950 to-black">
      {renderNav()}
      <div className="flex-1 overflow-hidden flex">
        <div className="flex-1 overflow-hidden">
          {viewMode === 'gallery' && <div className="h-full overflow-y-auto">{renderGallery()}{/* Image Artifacts from DTU Context */}
            {imageArtifacts.length > 0 && (
              <section className="px-6 pb-6 space-y-4">
                <h2 className="text-lg font-bold">Image Artifacts</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {imageArtifacts.slice(0, 8).map((dtu: DTU) => (
                    <div key={dtu.id} className="rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-neon-pink/30 transition-colors">
                      <ArtifactRenderer dtuId={dtu.id} artifact={dtu.artifact!} mode="thumbnail" />
                      <div className="p-3">
                        <p className="text-sm font-medium truncate">{dtu.title || dtu.human?.summary || 'Untitled'}</p>
                        <FeedbackWidget targetType="dtu" targetId={dtu.id} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}</div>}
          {viewMode === 'canvas' && renderCanvas()}
          {viewMode === 'marketplace' && <div className="h-full overflow-y-auto">{renderMarketplace()}</div>}
          {viewMode === 'my-art' && <div className="h-full overflow-y-auto">{renderMyArt()}</div>}
        </div>
        {/* DTU Context Sidebar */}
        <aside className="w-72 shrink-0 hidden xl:block border-l border-white/10 bg-black/20 overflow-y-auto p-4 space-y-4">
          <ArtifactUploader lens="art" acceptTypes="image/*" multi compact onUploadComplete={() => refetchDTUs()} />
          <LensContextPanel
            hyperDTUs={hyperDTUs}
            megaDTUs={megaDTUs}
            regularDTUs={regularDTUs}
            tierDistribution={tierDistribution}
            onPublish={(dtu) => publishDTU({ dtuId: dtu.id })}
            title="Art DTUs"
            className="!bg-transparent !border-0 !p-0"
          />
          <FeedbackWidget targetType="lens" targetId="art" />
        </aside>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUpload && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-lattice-surface border border-white/10 rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">Upload Artwork</h3>
                <button onClick={() => setShowUpload(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Title</label>
                  <input type="text" value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50" placeholder="Artwork title" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Description</label>
                  <textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} rows={3} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50 resize-none" placeholder="Describe your artwork" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Style</label>
                  <select value={uploadStyle} onChange={e => setUploadStyle(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none">
                    {ART_STYLES.map(s => <option key={s} value={s} className="bg-lattice-surface">{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Tags (comma separated)</label>
                  <input type="text" value={uploadTags} onChange={e => setUploadTags(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none focus:border-neon-pink/50" placeholder="abstract, neon, digital" />
                </div>
                <div className="border-2 border-dashed border-white/20 rounded-lg p-8 text-center">
                  <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
                  <p className="text-sm text-gray-400">Drop files here or click to upload</p>
                  <p className="text-xs text-gray-500 mt-1">PNG, JPG, SVG, WebP up to 50MB</p>
                </div>
                <button onClick={handleUpload} disabled={uploadMutation.isPending} className="w-full py-2.5 bg-neon-pink text-white rounded-lg font-medium hover:bg-neon-pink/80 disabled:opacity-50">
                  {uploadMutation.isPending ? 'Uploading...' : 'Upload Artwork'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Listing Modal */}
      <AnimatePresence>
        {showCreateListing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }} className="bg-lattice-surface border border-white/10 rounded-xl p-6 w-full max-w-md">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold">List on Marketplace</h3>
                <button onClick={() => setShowCreateListing(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
              </div>
              <div className="space-y-4">
                <input type="text" value={listingTitle} onChange={e => setListingTitle(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none" placeholder="Listing title" />
                <div className="grid grid-cols-2 gap-3">
                  <select value={listingType} onChange={e => setListingType(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none">
                    {ART_TYPES.map(t => <option key={t} value={t} className="bg-lattice-surface">{t.replace('-', ' ')}</option>)}
                  </select>
                  <input type="number" value={listingPrice} onChange={e => setListingPrice(e.target.value)} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none" placeholder="Price ($)" />
                </div>
                <div>
                  <label className="text-sm text-gray-400 block mb-1">Style</label>
                  <select value={listingStyle} onChange={e => setListingStyle(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none">
                    {ART_STYLES.map(s => <option key={s} value={s} className="bg-lattice-surface">{s}</option>)}
                  </select>
                </div>
                <input type="text" value={listingTags} onChange={e => setListingTags(e.target.value)} className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm focus:outline-none" placeholder="Tags (comma separated)" />
                <button onClick={handleCreateListing} disabled={createListingMutation.isPending} className="w-full py-2.5 bg-neon-pink text-white rounded-lg font-medium hover:bg-neon-pink/80 disabled:opacity-50">
                  {createListingMutation.isPending ? 'Creating...' : 'Create Listing'}
                </button>

      {/* ── Backend Action Panels ── */}
      <div className="bg-white/5 border border-white/10 rounded-lg p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><Wand2 className="w-4 h-4 text-neon-pink" /> Art Compute Actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <button onClick={() => handleArtAction('colorHarmony')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-neon-pink/50 transition-colors disabled:opacity-50">
            {isRunning === 'colorHarmony' ? <div className="w-5 h-5 border-2 border-neon-pink border-t-transparent rounded-full animate-spin" /> : <Palette className="w-5 h-5 text-neon-pink" />}
            <span className="text-xs text-gray-300">Color Harmony</span>
          </button>
          <button onClick={() => handleArtAction('compositionScore')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-neon-cyan/50 transition-colors disabled:opacity-50">
            {isRunning === 'compositionScore' ? <div className="w-5 h-5 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" /> : <Grid className="w-5 h-5 text-neon-cyan" />}
            <span className="text-xs text-gray-300">Composition Score</span>
          </button>
          <button onClick={() => handleArtAction('generatePalette')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-neon-purple/50 transition-colors disabled:opacity-50">
            {isRunning === 'generatePalette' ? <div className="w-5 h-5 border-2 border-neon-purple border-t-transparent rounded-full animate-spin" /> : <Droplets className="w-5 h-5 text-neon-purple" />}
            <span className="text-xs text-gray-300">Generate Palette</span>
          </button>
          <button onClick={() => handleArtAction('styleClassify')} disabled={isRunning !== null} className="flex flex-col items-center gap-2 p-3 bg-white/5 rounded-lg border border-white/10 hover:border-yellow-400/50 transition-colors disabled:opacity-50">
            {isRunning === 'styleClassify' ? <div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" /> : <Eye className="w-5 h-5 text-yellow-400" />}
            <span className="text-xs text-gray-300">Style Classify</span>
          </button>
        </div>
        {actionResult && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-3 bg-white/5 rounded-lg border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold flex items-center gap-2"><Palette className="w-4 h-4 text-neon-pink" /> Result</h4>
              <button onClick={() => setActionResult(null)} className="text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {/* Color Harmony */}
            {actionResult.harmonies !== undefined && actionResult.paletteSize !== undefined && (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-neon-pink">{actionResult.paletteSize as number}</p><p className="text-[10px] text-gray-500">Colors</p></div>
                  <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-neon-cyan">{actionResult.harmonyScore as number}</p><p className="text-[10px] text-gray-500">Harmony Score</p></div>
                  <div className="p-2 bg-white/5 rounded text-center"><p className="text-sm font-bold text-yellow-400">{actionResult.temperature as string}</p><p className="text-[10px] text-gray-500">Temperature</p></div>
                </div>
                {(actionResult.harmonies as Array<{ type: string; colors: string[] }>)?.slice(0, 4).map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs"><span className="text-white capitalize">{h.type}</span><div className="flex gap-1">{h.colors.map((c, j) => <span key={j} className="w-4 h-4 rounded-sm border border-white/20" style={{ backgroundColor: c }} />)}</div></div>
                ))}
              </div>
            )}
            {/* Composition Score */}
            {actionResult.overall !== undefined && actionResult.scores !== undefined && (
              <div className="space-y-2">
                <div className="text-3xl font-bold text-neon-cyan">{actionResult.overall as number}<span className="text-sm text-gray-400">/100</span></div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(actionResult.scores as Record<string, number>).map(([key, val]) => (
                    <div key={key} className="p-2 bg-white/5 rounded"><p className="text-[10px] text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1')}</p><p className="text-sm font-bold text-white">{val}</p></div>
                  ))}
                </div>
              </div>
            )}
            {/* Generate Palette */}
            {actionResult.palette !== undefined && !actionResult.harmonies && (
              <div className="space-y-2">
                <div className="flex gap-2">{(actionResult.palette as Array<{ hex: string }>)?.map((c, i) => <div key={i} className="flex-1 h-10 rounded" style={{ backgroundColor: c.hex || (c as unknown as string) }} title={c.hex || (c as unknown as string)} />)}</div>
              </div>
            )}
            {/* Style Classify */}
            {actionResult.topMatch !== undefined && actionResult.confidence !== undefined && (
              <div className="space-y-2">
                <div className="flex items-center gap-3"><span className="text-2xl font-bold text-yellow-400 capitalize">{(actionResult.topMatch as { style: string }).style}</span><span className="text-xs text-gray-400">Confidence: {actionResult.confidence as string}</span></div>
                {(actionResult.allMatches as Array<{ style: string; similarity: number }>)?.slice(1).map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-1.5 bg-white/5 rounded"><span className="text-white capitalize">{s.style}</span><span className="text-gray-400">{s.similarity}%</span></div>
                ))}
              </div>
            )}
            {!!actionResult.message && !actionResult.harmonies && !actionResult.overall && !actionResult.palette && !actionResult.topMatch && (
              <p className="text-sm text-gray-400">{actionResult.message as string}</p>
            )}
          </motion.div>
        )}
      </div>

      {/* Real-time Data Panel */}
      <UniversalActions domain="art" artifactId={null} compact />
      {realtimeData && (
        <RealtimeDataPanel
          domain="art"
          data={realtimeData}
          isLive={isLive}
          lastUpdated={lastUpdated}
          insights={realtimeInsights}
          compact
        />
      )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
          <ChevronDown className={`w-4 h-4 transition-transform ${showFeatures ? 'rotate-180' : ''}`} />
        </button>
        {showFeatures && (
          <div className="px-4 pb-4">
            <LensFeaturePanel lensId="artistry" />
          </div>
        )}
      </div>
    </div>
  );
}
