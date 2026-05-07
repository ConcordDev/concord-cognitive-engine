'use client';

import { useLensNav } from '@/hooks/useLensNav';
import { UniversalActions } from '@/components/lens/UniversalActions';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  PenTool,
  Plus,
  Link2,
  Square,
  Circle,
  Type,
  ArrowRight,
  MousePointer,
  Pencil,
  Trash2,
  Download,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Palette,
  X,
  Save,
  Grid3X3,
  Move,
  Image as ImageIcon,
  StickyNote,
  Bookmark,
  LayoutGrid,
  Clock,
  ChevronDown,
  GripVertical,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import { useRunArtifact } from '@/lib/hooks/use-lens-artifacts';
import { Zap } from 'lucide-react';

/* ---------- types ---------- */
type BoardMode = 'canvas' | 'moodboard' | 'arrangement';
type Tool =
  | 'select' | 'draw' | 'rectangle' | 'ellipse' | 'line' | 'arrow'
  | 'text' | 'dtu' | 'audio' | 'image' | 'notecard' | 'section';

type Element = {
  id: string;
  type: 'rectangle' | 'ellipse' | 'line' | 'arrow' | 'text' | 'freehand' | 'dtu'
    | 'audio' | 'image' | 'notecard' | 'section';
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: { x: number; y: number }[];
  text?: string;
  dtuId?: string;
  dtuTitle?: string;
  stroke: string;
  fill: string;
  strokeWidth: number;
  rotation?: number;
  /* audio pin */
  clipName?: string;
  duration?: number;
  playing?: boolean;
  /* image pin */
  imageUrl?: string;
  imageLabel?: string;
  /* notecard */
  cardColor?: string;
  /* section marker */
  sectionType?: string;
  bars?: number;
};

type ArrangementSection = {
  id: string;
  type: string;
  label: string;
  bars: number;
  color: string;
};

type MoodZone = {
  id: string;
  label: string;
  items: { kind: 'color' | 'text' | 'image' | 'audio'; value: string }[];
};

/* ---------- constants ---------- */
const COLORS = ['#00d4ff', '#a855f7', '#ec4899', '#22c55e', '#f59e0b', '#ef4444', '#ffffff', '#6b7280'];
const STROKE_WIDTHS = [1, 2, 4, 6, 8];
const CARD_COLORS = ['#fbbf24', '#34d399', '#f472b6', '#60a5fa', '#c084fc', '#fb923c'];
const SECTION_PRESETS: { type: string; label: string; bars: number; color: string }[] = [
  { type: 'intro', label: 'Intro', bars: 4, color: '#60a5fa' },
  { type: 'verse', label: 'Verse', bars: 8, color: '#34d399' },
  { type: 'prechorus', label: 'Pre-Chorus', bars: 4, color: '#fbbf24' },
  { type: 'chorus', label: 'Chorus', bars: 8, color: '#f472b6' },
  { type: 'bridge', label: 'Bridge', bars: 4, color: '#c084fc' },
  { type: 'outro', label: 'Outro', bars: 4, color: '#fb923c' },
];
const DEFAULT_ARRANGEMENT: ArrangementSection[] = [
  { id: 'arr_1', type: 'intro', label: 'Intro', bars: 4, color: '#60a5fa' },
  { id: 'arr_2', type: 'verse', label: 'Verse 1', bars: 8, color: '#34d399' },
  { id: 'arr_3', type: 'prechorus', label: 'Pre-Chorus', bars: 4, color: '#fbbf24' },
  { id: 'arr_4', type: 'chorus', label: 'Chorus 1', bars: 8, color: '#f472b6' },
  { id: 'arr_5', type: 'verse', label: 'Verse 2', bars: 8, color: '#34d399' },
  { id: 'arr_6', type: 'chorus', label: 'Chorus 2', bars: 8, color: '#f472b6' },
  { id: 'arr_7', type: 'bridge', label: 'Bridge', bars: 4, color: '#c084fc' },
  { id: 'arr_8', type: 'chorus', label: 'Final Chorus', bars: 8, color: '#f472b6' },
  { id: 'arr_9', type: 'outro', label: 'Outro', bars: 4, color: '#fb923c' },
];
const DEFAULT_MOOD_ZONES: MoodZone[] = [
  { id: 'mz_1', label: 'Ideas & Concepts', items: [] },
  { id: 'mz_2', label: 'Visual References', items: [] },
  { id: 'mz_3', label: 'Mood Words', items: [] },
  { id: 'mz_4', label: 'Color Palette', items: [] },
  { id: 'mz_5', label: 'Tools & Resources', items: [] },
  { id: 'mz_6', label: 'Inspiration Board', items: [] },
];

/* ---------- tiny helpers ---------- */
const uid = () => `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ================================================================== */
export default function WhiteboardLensPage() {
  useLensNav('whiteboard');
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('whiteboard');
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Lens artifact persistence layer
  const { isError: isError, error: error, refetch: refetch, items: boardArtifacts, create: createBoardArtifact } = useLensData('whiteboard', 'board', { noSeed: true });

  /* board list state */
  const [showCreate, setShowCreate] = useState(false);
  const [selectedWbId, setSelectedWbId] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>('canvas');
  const [showModeMenu, setShowModeMenu] = useState(false);

  /* canvas state */
  const [tool, setTool] = useState<Tool>('select');
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [viewingDtuId, setViewingDtuId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<Element | null>(null);
  const [undoStack, setUndoStack] = useState<Element[][]>([]);
  const [redoStack, setRedoStack] = useState<Element[][]>([]);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [strokeColor, setStrokeColor] = useState('#00d4ff');
  const [fillColor, setFillColor] = useState('transparent');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [showGrid, setShowGrid] = useState(true);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showDtuPicker, setShowDtuPicker] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [textPosition, setTextPosition] = useState<{ x: number; y: number } | null>(null);

  const runWbAction = useRunArtifact('whiteboard');
  const [wbActionResult, setWbActionResult] = useState<{ action: string; result: Record<string, unknown> } | null>(null);
  const [wbActiveAction, setWbActiveAction] = useState<string | null>(null);

  const handleWbAction = useCallback(async (action: string) => {
    const id = boardArtifacts[0]?.id;
    if (!id) return;
    setWbActiveAction(action);
    try {
      const res = await runWbAction.mutateAsync({ id, action });
      if (res.ok) setWbActionResult({ action, result: res.result as Record<string, unknown> });
    } finally {
      setWbActiveAction(null);
    }
  }, [boardArtifacts, runWbAction]);

  /* new-tool input dialogs */
  const [showAudioDialog, setShowAudioDialog] = useState(false);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [showSectionDialog, setShowSectionDialog] = useState(false);
  const [audioClipName, setAudioClipName] = useState('');
  const [audioClipDur, setAudioClipDur] = useState(30);
  const [imageLabel, setImageLabel] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteColor, setNoteColor] = useState(CARD_COLORS[0]);
  const [sectionChoice, setSectionChoice] = useState(SECTION_PRESETS[0]);

  /* arrangement state */
  const [arrangement, setArrangement] = useState<ArrangementSection[]>(DEFAULT_ARRANGEMENT);
  const [pace, setPace] = useState(120);
  const [theme, setTheme] = useState('Minimal');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  /* moodboard state */
  const [moodZones, setMoodZones] = useState<MoodZone[]>(DEFAULT_MOOD_ZONES);
  const [moodInput, setMoodInput] = useState('');
  const [moodTarget, setMoodTarget] = useState<string | null>(null);
  const [moodKind, setMoodKind] = useState<'text' | 'color' | 'audio' | 'image'>('text');

  /* ---------- queries / mutations ---------- */
  const { data: whiteboards, isLoading, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['whiteboards'],
    queryFn: () => apiHelpers.whiteboard.list().then(r => r.data),
  });

  const { data: selectedWb, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['whiteboard', selectedWbId],
    queryFn: () => apiHelpers.whiteboard.get(selectedWbId!).then(r => r.data),
    enabled: !!selectedWbId,
  });

  const { data: dtus, isError: isError4, error: error4, refetch: refetch4,} = useQuery({
    queryKey: ['dtus-whiteboard'],
    queryFn: () => apiHelpers.dtus.paginated({ limit: 100 }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; linkedDtus: string[] }) => {
      const res = await apiHelpers.whiteboard.create(data);
      await createBoardArtifact({ title: data.title, data: { linkedDtus: data.linkedDtus, createdAt: new Date().toISOString() } as Record<string, unknown> });
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
      setSelectedWbId(res.data.dtuId);
      setShowCreate(false);
    },
    onError: (err) => {
      console.error('Failed to create whiteboard:', err instanceof Error ? err.message : err);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: { elements: Element[] }) => apiHelpers.whiteboard.update(selectedWbId!, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whiteboard', selectedWbId] }),
    onError: (err) => {
      console.error('Failed to save whiteboard:', err instanceof Error ? err.message : err);
    },
  });

  /* load elements */
  useEffect(() => {
    if (selectedWb?.whiteboard?.elements) {
      setElements(selectedWb.whiteboard.elements);
    } else {
      setElements([]);
    }
  }, [selectedWb]);

  /* auto-save: debounce save elements to backend when they change */
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!selectedWbId || elements.length === 0) return;
    // Skip the initial load (when elements were just set from server data)
    if (selectedWb?.whiteboard?.elements && JSON.stringify(selectedWb.whiteboard.elements) === JSON.stringify(elements)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveMutation.mutate({ elements });
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedWbId]);

  /* resize */
  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDimensions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  /* ---------- undo / redo ---------- */
  const pushUndo = useCallback(() => {
    setUndoStack(prev => [...prev.slice(-50), [...elements]]);
    setRedoStack([]);
  }, [elements]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    setRedoStack(r => [...r, [...elements]]);
    setUndoStack(u => u.slice(0, -1));
    setElements(undoStack[undoStack.length - 1]);
  }, [undoStack, elements]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    setUndoStack(u => [...u, [...elements]]);
    setRedoStack(r => r.slice(0, -1));
    setElements(redoStack[redoStack.length - 1]);
  }, [redoStack, elements]);

  /* ---------- canvas coordinate helpers ---------- */
  const getCanvasCoords = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left - offset.x) / zoom,
      y: (e.clientY - rect.top - offset.y) / zoom,
    };
  };

  /* ---------- mouse handlers (canvas mode) ---------- */
  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      setIsPanning(true);
      setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
      return;
    }

    if (tool === 'select') {
      const clicked = [...elements].reverse().find(el => {
        if (el.type === 'freehand' && el.points) {
          return el.points.some(p => Math.abs(p.x - x) < 10 && Math.abs(p.y - y) < 10);
        }
        const w = el.width || 100;
        const h = el.height || 50;
        return x >= el.x && x <= el.x + w && y >= el.y && y <= el.y + h;
      });
      setSelectedElement(clicked || null);
      if (clicked) {
        setIsDrawing(true);
        setCurrentElement({ ...clicked, x: x - clicked.x, y: y - clicked.y } as unknown as Element);
      }
      return;
    }

    if (tool === 'text') { setTextPosition({ x, y }); return; }
    if (tool === 'dtu') { setShowDtuPicker(true); setTextPosition({ x, y }); return; }
    if (tool === 'audio') { setShowAudioDialog(true); setTextPosition({ x, y }); return; }
    if (tool === 'image') { setShowImageDialog(true); setTextPosition({ x, y }); return; }
    if (tool === 'notecard') { setShowNoteDialog(true); setTextPosition({ x, y }); return; }
    if (tool === 'section') { setShowSectionDialog(true); setTextPosition({ x, y }); return; }

    pushUndo();
    setIsDrawing(true);
    const newEl: Element = {
      id: uid(),
      type: tool === 'draw' ? 'freehand' : tool as Element['type'],
      x, y,
      width: 0, height: 0,
      points: tool === 'draw' ? [{ x, y }] : undefined,
      stroke: strokeColor,
      fill: fillColor,
      strokeWidth,
    };
    setCurrentElement(newEl);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    if (!isDrawing || !currentElement) return;
    const { x, y } = getCanvasCoords(e);

    if (tool === 'select' && selectedElement) {
      setElements(prev => prev.map(el =>
        el.id === selectedElement.id
          ? { ...el, x: x - (currentElement as unknown as Record<string, number>).x, y: y - (currentElement as unknown as Record<string, number>).y }
          : el
      ));
      return;
    }

    if (currentElement.type === 'freehand' && currentElement.points) {
      setCurrentElement({ ...currentElement, points: [...currentElement.points, { x, y }] });
    } else {
      setCurrentElement({ ...currentElement, width: x - currentElement.x, height: y - currentElement.y });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (!isDrawing) return;
    setIsDrawing(false);
    if (tool === 'select') { pushUndo(); return; }
    if (currentElement && (
      (currentElement.width && Math.abs(currentElement.width) > 5) ||
      (currentElement.height && Math.abs(currentElement.height) > 5) ||
      (currentElement.points && currentElement.points.length > 2)
    )) {
      const n = { ...currentElement };
      if (n.width && n.width < 0) { n.x += n.width; n.width = Math.abs(n.width); }
      if (n.height && n.height < 0) { n.y += n.height; n.height = Math.abs(n.height); }
      setElements(prev => [...prev, n]);
    }
    setCurrentElement(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);
    const clicked = [...elements].reverse().find(el => {
      const w = el.width || 100;
      const h = el.height || 50;
      return x >= el.x && x <= el.x + w && y >= el.y && y <= el.y + h;
    });
    if (clicked?.type === 'dtu' && clicked.dtuId) {
      setViewingDtuId(clicked.dtuId);
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => clamp(z * d, 0.25, 4));
  };

  /* ---------- add helpers ---------- */
  const addText = () => {
    if (!textPosition || !textInput.trim()) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'text', x: textPosition.x, y: textPosition.y,
      text: textInput, stroke: strokeColor, fill: strokeColor, strokeWidth: 1,
      width: textInput.length * 12, height: 24,
    }]);
    setTextInput(''); setTextPosition(null);
  };

  const addDtu = (dtu: Record<string, unknown>) => {
    if (!textPosition) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'dtu', x: textPosition.x, y: textPosition.y,
      dtuId: dtu.id as string,
      dtuTitle: ((dtu.title as string) || (dtu.content as string)?.slice(0, 30)) as string,
      stroke: '#a855f7', fill: 'rgba(168, 85, 247, 0.1)', strokeWidth: 2, width: 200, height: 80,
    }]);
    setShowDtuPicker(false); setTextPosition(null);
  };

  const addAudioPin = () => {
    if (!textPosition || !audioClipName.trim()) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'audio', x: textPosition.x, y: textPosition.y,
      clipName: audioClipName, duration: audioClipDur, playing: false,
      stroke: '#00d4ff', fill: 'rgba(0, 212, 255, 0.08)', strokeWidth: 2, width: 220, height: 72,
    }]);
    setAudioClipName(''); setAudioClipDur(30); setShowAudioDialog(false); setTextPosition(null);
  };

  const addImagePin = () => {
    if (!textPosition || !imageLabel.trim()) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'image', x: textPosition.x, y: textPosition.y,
      imageLabel, imageUrl: '', stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.08)',
      strokeWidth: 2, width: 160, height: 160,
    }]);
    setImageLabel(''); setShowImageDialog(false); setTextPosition(null);
  };

  const addNoteCard = () => {
    if (!textPosition || !noteText.trim()) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'notecard', x: textPosition.x, y: textPosition.y,
      text: noteText, cardColor: noteColor, stroke: noteColor, fill: noteColor + '22',
      strokeWidth: 2, width: 180, height: 100,
    }]);
    setNoteText(''); setShowNoteDialog(false); setTextPosition(null);
  };

  const addSectionMarker = () => {
    if (!textPosition) return;
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'section', x: textPosition.x, y: textPosition.y,
      sectionType: sectionChoice.type, text: sectionChoice.label, bars: sectionChoice.bars,
      stroke: sectionChoice.color, fill: sectionChoice.color + '18',
      strokeWidth: 2, width: sectionChoice.bars * 24, height: 56,
    }]);
    setShowSectionDialog(false); setTextPosition(null);
  };

  const toggleAudioPlay = (id: string) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, playing: !el.playing } : el));
  };

  const deleteSelected = useCallback(() => {
    if (!selectedElement) return;
    pushUndo();
    setElements(prev => prev.filter(el => el.id !== selectedElement.id));
    setSelectedElement(null);
  }, [selectedElement, pushUndo]);

  const exportCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  /* ---------- canvas render ---------- */
  useEffect(() => {
    if (boardMode !== 'canvas') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = dimensions.width * 2;
    canvas.height = dimensions.height * 2;
    ctx.scale(2, 2);

    ctx.fillStyle = '#0f0f1a';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    if (showGrid) {
      ctx.strokeStyle = 'rgba(100, 100, 150, 0.1)';
      ctx.lineWidth = 1;
      const gs = 20 * zoom;
      for (let gx = (offset.x % gs); gx < dimensions.width; gx += gs) {
        ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, dimensions.height); ctx.stroke();
      }
      for (let gy = (offset.y % gs); gy < dimensions.height; gy += gs) {
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(dimensions.width, gy); ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(offset.x, offset.y);
    ctx.scale(zoom, zoom);

    const drawEl = (el: Element, preview = false) => {
      ctx.strokeStyle = el.stroke;
      ctx.fillStyle = el.fill || 'transparent';
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const isSel = selectedElement?.id === el.id;
      if (isSel && !preview) { ctx.shadowColor = el.stroke; ctx.shadowBlur = 10; }

      switch (el.type) {
        case 'rectangle':
          if (el.fill && el.fill !== 'transparent') ctx.fillRect(el.x, el.y, el.width || 0, el.height || 0);
          ctx.strokeRect(el.x, el.y, el.width || 0, el.height || 0);
          break;

        case 'ellipse':
          ctx.beginPath();
          ctx.ellipse(el.x + (el.width || 0) / 2, el.y + (el.height || 0) / 2, Math.abs((el.width || 0) / 2), Math.abs((el.height || 0) / 2), 0, 0, 2 * Math.PI);
          if (el.fill && el.fill !== 'transparent') ctx.fill();
          ctx.stroke();
          break;

        case 'line':
        case 'arrow':
          ctx.beginPath();
          ctx.moveTo(el.x, el.y);
          ctx.lineTo(el.x + (el.width || 0), el.y + (el.height || 0));
          ctx.stroke();
          if (el.type === 'arrow') {
            const angle = Math.atan2(el.height || 0, el.width || 0);
            const ex = el.x + (el.width || 0), ey = el.y + (el.height || 0), as2 = 12;
            ctx.beginPath();
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - as2 * Math.cos(angle - Math.PI / 6), ey - as2 * Math.sin(angle - Math.PI / 6));
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - as2 * Math.cos(angle + Math.PI / 6), ey - as2 * Math.sin(angle + Math.PI / 6));
            ctx.stroke();
          }
          break;

        case 'freehand':
          if (el.points && el.points.length > 1) {
            ctx.beginPath();
            ctx.moveTo(el.points[0].x, el.points[0].y);
            for (let i = 1; i < el.points.length; i++) ctx.lineTo(el.points[i].x, el.points[i].y);
            ctx.stroke();
          }
          break;

        case 'text':
          ctx.font = '16px Inter, sans-serif';
          ctx.fillStyle = el.stroke;
          ctx.fillText(el.text || '', el.x, el.y + 16);
          break;

        case 'dtu': {
          const g = ctx.createLinearGradient(el.x, el.y, el.x + (el.width || 200), el.y + (el.height || 80));
          g.addColorStop(0, 'rgba(168, 85, 247, 0.15)');
          g.addColorStop(1, 'rgba(0, 212, 255, 0.15)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.roundRect(el.x, el.y, el.width || 200, el.height || 80, 8); ctx.fill();
          ctx.strokeStyle = '#a855f7'; ctx.stroke();
          ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Inter, sans-serif';
          ctx.fillText(el.dtuTitle || 'DTU', el.x + 12, el.y + 28);
          ctx.fillStyle = '#9ca3af'; ctx.font = '12px Inter, sans-serif';
          ctx.fillText(`ID: ${el.dtuId?.slice(0, 12)}...`, el.x + 12, el.y + 50);
          ctx.fillStyle = '#a855f7'; ctx.fillText('Click to view', el.x + 12, el.y + 68);
          break;
        }

        case 'audio': {
          const w = el.width || 220, h = el.height || 72;
          ctx.fillStyle = el.fill || 'rgba(0,212,255,0.08)';
          ctx.beginPath(); ctx.roundRect(el.x, el.y, w, h, 10); ctx.fill();
          ctx.strokeStyle = el.stroke; ctx.lineWidth = 1.5; ctx.stroke();
          /* play circle */
          ctx.beginPath(); ctx.arc(el.x + 26, el.y + h / 2, 14, 0, 2 * Math.PI);
          ctx.fillStyle = el.playing ? '#ef4444' : '#00d4ff'; ctx.fill();
          ctx.fillStyle = '#0f0f1a';
          if (el.playing) {
            ctx.fillRect(el.x + 21, el.y + h / 2 - 6, 4, 12);
            ctx.fillRect(el.x + 27, el.y + h / 2 - 6, 4, 12);
          } else {
            ctx.beginPath(); ctx.moveTo(el.x + 23, el.y + h / 2 - 7);
            ctx.lineTo(el.x + 23, el.y + h / 2 + 7);
            ctx.lineTo(el.x + 33, el.y + h / 2); ctx.fill();
          }
          /* waveform bars */
          const barHeights = [0.3, 0.6, 1, 0.5, 0.8, 0.4, 0.9, 0.6, 0.3, 0.7, 0.5, 0.8, 0.4, 0.6];
          const bx = el.x + 50;
          barHeights.forEach((bh, i) => {
            const bht = bh * 22;
            ctx.fillStyle = el.playing ? '#00d4ff' : 'rgba(0,212,255,0.5)';
            ctx.fillRect(bx + i * 10, el.y + h / 2 - bht / 2, 5, bht);
          });
          /* clip name + duration */
          ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px Inter, sans-serif';
          ctx.fillText(el.clipName || 'Untitled Clip', el.x + 50, el.y + 16);
          ctx.fillStyle = '#9ca3af'; ctx.font = '10px Inter, sans-serif';
          ctx.fillText(fmtDur(el.duration || 0), el.x + w - 40, el.y + 16);
          break;
        }

        case 'image': {
          const w = el.width || 160, h = el.height || 160;
          ctx.fillStyle = el.fill || 'rgba(245,158,11,0.08)';
          ctx.beginPath(); ctx.roundRect(el.x, el.y, w, h, 10); ctx.fill();
          ctx.strokeStyle = el.stroke; ctx.lineWidth = 1.5; ctx.stroke();
          /* placeholder icon area */
          ctx.fillStyle = 'rgba(245,158,11,0.15)';
          ctx.fillRect(el.x + 12, el.y + 12, w - 24, h - 44);
          ctx.fillStyle = '#f59e0b'; ctx.font = '24px sans-serif';
          ctx.fillText('\u{1F5BC}', el.x + w / 2 - 12, el.y + h / 2 - 10);
          ctx.fillStyle = '#ffffff'; ctx.font = '11px Inter, sans-serif';
          ctx.fillText(el.imageLabel || 'Image', el.x + 12, el.y + h - 12);
          break;
        }

        case 'notecard': {
          const w = el.width || 180, h = el.height || 100;
          ctx.fillStyle = (el.cardColor || '#fbbf24') + '30';
          ctx.beginPath(); ctx.roundRect(el.x, el.y, w, h, 6); ctx.fill();
          ctx.strokeStyle = el.cardColor || '#fbbf24'; ctx.lineWidth = 2; ctx.stroke();
          /* fold */
          ctx.fillStyle = (el.cardColor || '#fbbf24') + '50';
          ctx.beginPath(); ctx.moveTo(el.x + w - 20, el.y); ctx.lineTo(el.x + w, el.y + 20); ctx.lineTo(el.x + w, el.y); ctx.fill();
          /* text */
          ctx.fillStyle = '#ffffff'; ctx.font = '12px Inter, sans-serif';
          const words = (el.text || '').split(' ');
          let line = '', ly = el.y + 24;
          words.forEach(word => {
            const test = line + word + ' ';
            if (ctx.measureText(test).width > w - 24) { ctx.fillText(line, el.x + 12, ly); ly += 16; line = word + ' '; }
            else line = test;
          });
          ctx.fillText(line, el.x + 12, ly);
          break;
        }

        case 'section': {
          const w = el.width || 120, h = el.height || 56;
          ctx.fillStyle = el.fill || (el.stroke + '18');
          ctx.beginPath(); ctx.roundRect(el.x, el.y, w, h, 8); ctx.fill();
          ctx.strokeStyle = el.stroke; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = '#ffffff'; ctx.font = 'bold 13px Inter, sans-serif';
          ctx.fillText(el.text || '', el.x + 10, el.y + 22);
          ctx.fillStyle = '#9ca3af'; ctx.font = '11px Inter, sans-serif';
          ctx.fillText(`${el.bars || 0} bars`, el.x + 10, el.y + 42);
          break;
        }
      }

      ctx.shadowBlur = 0;

      if (isSel && !preview) {
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        const p = 8;
        ctx.strokeRect(el.x - p, el.y - p, (el.width || 100) + p * 2, (el.height || 50) + p * 2);
        ctx.setLineDash([]);
      }
    };

    elements.forEach(el => drawEl(el));
    if (currentElement && tool !== 'select') {
      ctx.globalAlpha = 0.7; drawEl(currentElement, true); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }, [elements, currentElement, selectedElement, dimensions, zoom, offset, showGrid, tool, boardMode]);

  /* ---------- keyboard shortcuts ---------- */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key === 'y' && (e.ctrlKey || e.metaKey)) || (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); redo(); }
      if (e.key === 'v') setTool('select');
      if (e.key === 'p') setTool('draw');
      if (e.key === 'r') setTool('rectangle');
      if (e.key === 'o') setTool('ellipse');
      if (e.key === 'l') setTool('line');
      if (e.key === 'a') setTool('arrow');
      if (e.key === 't') setTool('text');
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [deleteSelected, undo, redo]);

  /* ---------- tools array ---------- */
  const tools: { id: Tool; icon: React.ElementType; label: string; key: string }[] = [
    { id: 'select', icon: MousePointer, label: 'Select', key: 'V' },
    { id: 'draw', icon: Pencil, label: 'Draw', key: 'P' },
    { id: 'rectangle', icon: Square, label: 'Rectangle', key: 'R' },
    { id: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
    { id: 'line', icon: Move, label: 'Line', key: 'L' },
    { id: 'arrow', icon: ArrowRight, label: 'Arrow', key: 'A' },
    { id: 'text', icon: Type, label: 'Text', key: 'T' },
    { id: 'dtu', icon: Link2, label: 'Link DTU', key: 'D' },
    { id: 'audio', icon: PenTool, label: 'Audio Pin', key: '' },
    { id: 'image', icon: ImageIcon, label: 'Image Pin', key: '' },
    { id: 'notecard', icon: StickyNote, label: 'Note Card', key: '' },
    { id: 'section', icon: Bookmark, label: 'Section Marker', key: '' },
  ];

  /* ---------- arrangement helpers ---------- */
  const totalBars = arrangement.reduce((s, sec) => s + sec.bars, 0);
  const addSection = (preset: typeof SECTION_PRESETS[0]) => {
    setArrangement(prev => [...prev, { ...preset, id: `arr_${Date.now()}`, label: preset.label }]);
  };
  const removeSection = (id: string) => setArrangement(prev => prev.filter(s => s.id !== id));
  const updateSectionBars = (id: string, bars: number) => {
    setArrangement(prev => prev.map(s => s.id === id ? { ...s, bars: clamp(bars, 1, 32) } : s));
  };
  const handleArrDragStart = (idx: number) => setDragIdx(idx);
  const handleArrDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const updated = [...arrangement];
    const [moved] = updated.splice(dragIdx, 1);
    updated.splice(idx, 0, moved);
    setArrangement(updated);
    setDragIdx(idx);
  };
  const handleArrDragEnd = () => setDragIdx(null);

  /* ---------- mood helpers ---------- */
  const addMoodItem = () => {
    if (!moodTarget || !moodInput.trim()) return;
    setMoodZones(prev => prev.map(z =>
      z.id === moodTarget
        ? { ...z, items: [...z.items, { kind: moodKind, value: moodInput.trim() }] }
        : z
    ));
    setMoodInput(''); setMoodTarget(null);
  };
  const removeMoodItem = (zoneId: string, idx: number) => {
    setMoodZones(prev => prev.map(z => z.id === zoneId ? { ...z, items: z.items.filter((_, i) => i !== idx) } : z));
  };

  const modeLabels: Record<BoardMode, string> = {
    canvas: 'Freeform Canvas',
    moodboard: 'Moodboard',
    arrangement: 'Arrangement Sketch',
  };

  /* ================================================================== */
  /*                             RENDER                                  */
  /* ================================================================== */

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (isError || isError2 || isError3 || isError4) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <ErrorState error={error?.message || error2?.message || error3?.message || error4?.message} onRetry={() => { refetch(); refetch2(); refetch3(); refetch4(); }} />
      </div>
    );
  }
  return (
    <div className="h-full flex bg-lattice-bg">
      {/* ===== Sidebar ===== */}
      <aside className="w-64 border-r border-lattice-border bg-lattice-surface p-4 flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <PenTool className="w-6 h-6 text-neon-pink" />
          <h1 className="text-base font-bold leading-tight">Creative Canvas<br />&amp; Moodboard</h1>
        </div>

      {/* Real-time Enhancement Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
        <DTUExportButton domain="whiteboard" data={realtimeData || {}} compact />
        {realtimeAlerts.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
            {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

        {/* Board mode selector */}
        <div className="relative mb-4">
          <button onClick={() => setShowModeMenu(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-lattice-bg border border-lattice-border text-sm">
            <span>{modeLabels[boardMode]}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>
          <AnimatePresence>
            {showModeMenu && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute left-0 right-0 top-full mt-1 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden z-30 shadow-xl">
                {(Object.keys(modeLabels) as BoardMode[]).map(m => (
                  <button key={m} onClick={() => { setBoardMode(m); setShowModeMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-lattice-elevated ${boardMode === m ? 'text-neon-cyan' : 'text-gray-300'}`}>
                    {modeLabels[m]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={() => setShowCreate(true)} className="w-full py-2 bg-neon-pink text-black font-medium rounded-lg hover:bg-neon-pink/90 mb-4 flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />New Board
        </button>

        <div className="flex-1 overflow-y-auto space-y-2">
          <p className="text-xs text-gray-400 mb-2">Whiteboards ({whiteboards?.count || 0})</p>
          {isLoading ? (
            <div className="text-gray-500 text-sm">Loading...</div>
          ) : (
            (whiteboards?.whiteboards && whiteboards.whiteboards.length > 0 ? whiteboards.whiteboards : boardArtifacts.map(a => ({ id: a.id, title: a.title, elementCount: 0 }))).map((wb: Record<string, unknown>) => (
              <button key={wb.id as string} onClick={() => setSelectedWbId(wb.id as string)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedWbId === wb.id ? 'border-neon-pink bg-lattice-elevated' : 'border-lattice-border hover:border-neon-pink/50'}`}>
                <p className="font-medium truncate">{wb.title as string}</p>
                <p className="text-xs text-gray-400 mt-1">{(wb.elementCount as number) || 0} elements</p>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* ===== Main area ===== */}
      <div className="flex-1 flex flex-col">
        {selectedWbId ? (
          <>
            {/* ===== Toolbar (canvas mode) ===== */}
            {boardMode === 'canvas' && (
              <div className="border-b border-lattice-border bg-lattice-surface/50 backdrop-blur p-2 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 bg-lattice-bg rounded-lg p-1">
                  {tools.map(t => (
                    <button key={t.id} onClick={() => setTool(t.id)} title={`${t.label}${t.key ? ` (${t.key})` : ''}`}
                      className={`p-2 rounded-md transition-colors ${tool === t.id ? 'bg-neon-pink/20 text-neon-pink' : 'text-gray-400 hover:text-white'}`}>
                      <t.icon className="w-5 h-5" />
                    </button>
                  ))}
                </div>

                <div className="w-px h-8 bg-lattice-border mx-1" />

                <button onClick={() => setShowColorPicker(!showColorPicker)} className="p-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated relative">
                  <Palette className="w-5 h-5" style={{ color: strokeColor }} />
                </button>

                <div className="flex items-center gap-1 bg-lattice-bg rounded-lg p-1">
                  {STROKE_WIDTHS.map(w => (
                    <button key={w} onClick={() => setStrokeWidth(w)}
                      className={`w-8 h-8 rounded flex items-center justify-center ${strokeWidth === w ? 'bg-lattice-elevated' : 'hover:bg-lattice-elevated'}`}>
                      <div className="rounded-full bg-current" style={{ width: w * 2, height: w * 2 }} />
                    </button>
                  ))}
                </div>

                <div className="w-px h-8 bg-lattice-border mx-1" />

                <button onClick={undo} disabled={undoStack.length === 0} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30" title="Undo (Ctrl+Z)"><Undo2 className="w-5 h-5" /></button>
                <button onClick={redo} disabled={redoStack.length === 0} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30" title="Redo (Ctrl+Y)"><Redo2 className="w-5 h-5" /></button>
                <button onClick={deleteSelected} disabled={!selectedElement} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30 text-red-400" title="Delete"><Trash2 className="w-5 h-5" /></button>

                <div className="w-px h-8 bg-lattice-border mx-1" />

                <button onClick={() => setShowGrid(!showGrid)} className={`p-2 rounded-lg ${showGrid ? 'bg-lattice-elevated text-neon-cyan' : 'hover:bg-lattice-elevated text-gray-400'}`}><Grid3X3 className="w-5 h-5" /></button>
                <button onClick={() => setZoom(z => clamp(z * 1.2, 0.25, 4))} className="p-2 rounded-lg hover:bg-lattice-elevated"><ZoomIn className="w-5 h-5" /></button>
                <span className="text-sm text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => setZoom(z => clamp(z / 1.2, 0.25, 4))} className="p-2 rounded-lg hover:bg-lattice-elevated"><ZoomOut className="w-5 h-5" /></button>
                <button onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} className="p-2 rounded-lg hover:bg-lattice-elevated"><RotateCcw className="w-5 h-5" /></button>

                <div className="flex-1" />

                <button onClick={() => saveMutation.mutate({ elements })} disabled={saveMutation.isPending}
                  className="px-4 py-2 bg-lattice-elevated rounded-lg hover:bg-lattice-bg flex items-center gap-2 text-sm">
                  <Save className="w-4 h-4" />{saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <button onClick={exportCanvas} className="px-4 py-2 bg-lattice-elevated rounded-lg hover:bg-lattice-bg flex items-center gap-2 text-sm">
                  <Download className="w-4 h-4" />Export
                </button>
              </div>
            )}

            {/* ===== Arrangement toolbar ===== */}
            {boardMode === 'arrangement' && (
              <div className="border-b border-lattice-border bg-lattice-surface/50 backdrop-blur px-4 py-2 flex items-center gap-4">
                <Clock className="w-5 h-5 text-neon-cyan" />
                <span className="text-sm font-semibold">Arrangement Sketch</span>
                <div className="w-px h-6 bg-lattice-border" />
                <label className="text-xs text-gray-400">Pace</label>
                <input type="number" value={pace} onChange={e => setPace(clamp(+e.target.value, 20, 300))}
                  className="w-16 px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-center" />
                <label className="text-xs text-gray-400">Theme</label>
                <input type="text" value={theme} onChange={e => setTheme(e.target.value)}
                  className="w-24 px-2 py-1 bg-lattice-bg border border-lattice-border rounded text-sm text-center" />
                <div className="w-px h-6 bg-lattice-border" />
                <span className="text-xs text-gray-400">Total: <strong className="text-white">{totalBars} bars</strong></span>
                <div className="flex-1" />
                <span className="text-xs text-gray-400">Drag to rearrange sections</span>
              </div>
            )}

            {/* ===== Moodboard toolbar ===== */}
            {boardMode === 'moodboard' && (
              <div className="border-b border-lattice-border bg-lattice-surface/50 backdrop-blur px-4 py-2 flex items-center gap-4">
                <LayoutGrid className="w-5 h-5 text-neon-pink" />
                <span className="text-sm font-semibold">Moodboard</span>
                <div className="w-px h-6 bg-lattice-border" />
                <span className="text-xs text-gray-400">Click a zone to add inspiration items</span>
              </div>
            )}

            {/* ===== Canvas view ===== */}
            {boardMode === 'canvas' && (
              <div ref={containerRef} className="flex-1 relative overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full cursor-crosshair"
                  style={{ width: dimensions.width, height: dimensions.height }}
                  onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp} onWheel={handleWheel} onDoubleClick={handleDoubleClick} />

                {/* Audio play overlay buttons (canvas-space) */}
                {elements.filter(el => el.type === 'audio').map(el => (
                  <button key={`play_${el.id}`}
                    onClick={() => toggleAudioPlay(el.id)}
                    className="absolute w-7 h-7 rounded-full opacity-0 hover:opacity-30"
                    style={{
                      left: el.x * zoom + offset.x + 12,
                      top: el.y * zoom + offset.y + (el.height || 72) / 2 * zoom - 14,
                    }} />
                ))}

                {/* Color Picker */}
                <AnimatePresence>
                  {showColorPicker && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      className="absolute top-16 left-48 bg-lattice-surface border border-lattice-border rounded-lg p-4 shadow-xl z-10">
                      <p className="text-xs text-gray-400 mb-2">Stroke</p>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {COLORS.map(c => (
                          <button key={c} onClick={() => setStrokeColor(c)}
                            className={`w-8 h-8 rounded-lg border-2 ${strokeColor === c ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">Fill</p>
                      <div className="grid grid-cols-4 gap-2">
                        <button onClick={() => setFillColor('transparent')}
                          className={`w-8 h-8 rounded-lg border-2 ${fillColor === 'transparent' ? 'border-white' : 'border-transparent'} bg-transparent`}>
                          <X className="w-4 h-4 mx-auto text-gray-500" />
                        </button>
                        {COLORS.slice(0, 7).map(c => (
                          <button key={c} onClick={() => setFillColor(c + '40')}
                            className={`w-8 h-8 rounded-lg border-2 ${fillColor === c + '40' ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c + '40' }} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Text Input */}
                <AnimatePresence>
                  {textPosition && tool === 'text' && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute bg-lattice-surface border border-lattice-border rounded-lg p-3 shadow-xl z-10"
                      style={{ left: textPosition.x * zoom + offset.x, top: textPosition.y * zoom + offset.y }}>
                      <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)} autoFocus placeholder="Enter text..."
                        onKeyDown={e => e.key === 'Enter' && addText()} className="px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm w-48" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={addText} className="flex-1 py-1 bg-neon-cyan text-black rounded text-sm">Add</button>
                        <button onClick={() => setTextPosition(null)} className="flex-1 py-1 bg-lattice-bg rounded text-sm">Cancel</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Audio Pin Dialog */}
                <AnimatePresence>
                  {showAudioDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><PenTool className="w-4 h-4 text-neon-cyan" />Pin Audio Clip</h3>
                          <button onClick={() => { setShowAudioDialog(false); setTextPosition(null); }}><X className="w-5 h-5" /></button>
                        </div>
                        <input type="text" placeholder="Clip name (e.g. Verse Vocal Take 3)" value={audioClipName}
                          onChange={e => setAudioClipName(e.target.value)} autoFocus
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3" />
                        <label className="text-xs text-gray-400">Duration (seconds)</label>
                        <input type="number" value={audioClipDur} onChange={e => setAudioClipDur(clamp(+e.target.value, 1, 3600))}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        <div className="flex gap-2">
                          <button onClick={addAudioPin} disabled={!audioClipName.trim()} className="flex-1 py-2 bg-neon-cyan text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Pin</button>
                          <button onClick={() => { setShowAudioDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Image Pin Dialog */}
                <AnimatePresence>
                  {showImageDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><ImageIcon className="w-4 h-4 text-amber-400" />Pin Image Reference</h3>
                          <button onClick={() => { setShowImageDialog(false); setTextPosition(null); }}><X className="w-5 h-5" /></button>
                        </div>
                        <input type="text" placeholder="Label (e.g. Album Cover Ref)" value={imageLabel}
                          onChange={e => setImageLabel(e.target.value)} autoFocus
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        <div className="flex gap-2">
                          <button onClick={addImagePin} disabled={!imageLabel.trim()} className="flex-1 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Pin</button>
                          <button onClick={() => { setShowImageDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Note Card Dialog */}
                <AnimatePresence>
                  {showNoteDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><StickyNote className="w-4 h-4 text-yellow-400" />Note Card</h3>
                          <button onClick={() => { setShowNoteDialog(false); setTextPosition(null); }}><X className="w-5 h-5" /></button>
                        </div>
                        <textarea placeholder="Note text..." value={noteText}
                          onChange={e => setNoteText(e.target.value)} autoFocus rows={3}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3 resize-none" />
                        <p className="text-xs text-gray-400 mb-2">Card color</p>
                        <div className="flex gap-2 mb-4">
                          {CARD_COLORS.map(c => (
                            <button key={c} onClick={() => setNoteColor(c)}
                              className={`w-8 h-8 rounded-lg border-2 ${noteColor === c ? 'border-white' : 'border-transparent'}`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={addNoteCard} disabled={!noteText.trim()} className="flex-1 py-2 bg-yellow-500 text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Card</button>
                          <button onClick={() => { setShowNoteDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Section Marker Dialog */}
                <AnimatePresence>
                  {showSectionDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><Bookmark className="w-4 h-4 text-purple-400" />Section Marker</h3>
                          <button onClick={() => { setShowSectionDialog(false); setTextPosition(null); }}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-2 mb-4">
                          {SECTION_PRESETS.map(s => (
                            <button key={s.type} onClick={() => setSectionChoice(s)}
                              className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-colors ${sectionChoice.type === s.type ? 'border-white bg-lattice-elevated' : 'border-lattice-border hover:border-gray-500'}`}>
                              <div className="w-4 h-4 rounded" style={{ backgroundColor: s.color }} />
                              <span className="text-sm">{s.label}</span>
                              <span className="text-xs text-gray-400 ml-auto">{s.bars} bars</span>
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button onClick={addSectionMarker} className="flex-1 py-2 bg-purple-500 text-black rounded-lg text-sm font-medium">Place Marker</button>
                          <button onClick={() => { setShowSectionDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* DTU Picker */}
                <AnimatePresence>
                  {showDtuPicker && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-4 w-96 max-h-96 overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold">Link DTU</h3>
                          <button onClick={() => setShowDtuPicker(false)}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-2">
                          {dtus?.dtus?.slice(0, 20).map((dtu: Record<string, unknown>) => (
                            <button key={dtu.id as string} onClick={() => addDtu(dtu)}
                              className="w-full text-left p-3 rounded-lg border border-lattice-border hover:border-neon-purple transition-colors">
                              <p className="font-medium truncate">{(dtu.title as string) || (dtu.content as string)?.slice(0, 40)}</p>
                              <p className="text-xs text-gray-400 mt-1">{dtu.tier as string} · {(dtu.tags as string[])?.slice(0, 3).join(', ')}</p>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* ===== Arrangement Sketch view ===== */}
            {boardMode === 'arrangement' && (
              <div className="flex-1 overflow-auto p-6">
                {/* Speed/Theme badge */}
                <div className="absolute top-20 right-6 flex items-center gap-3 bg-lattice-surface border border-lattice-border rounded-lg px-4 py-2 z-10">
                  <span className="text-xs text-gray-400">Speed</span>
                  <span className="text-lg font-bold text-neon-cyan">{pace}</span>
                  <div className="w-px h-6 bg-lattice-border" />
                  <span className="text-xs text-gray-400">Theme</span>
                  <span className="text-lg font-bold text-neon-pink">{theme}</span>
                </div>

                {/* Timeline */}
                <div className="mt-4">
                  <div className="flex items-end gap-3 mb-6 flex-wrap pb-4">
                    {arrangement.map((sec, idx) => (
                      <motion.div key={sec.id} layout draggable
                        onDragStart={() => handleArrDragStart(idx)}
                        onDragOver={e => handleArrDragOver(e, idx)}
                        onDragEnd={handleArrDragEnd}
                        className={`flex-shrink-0 rounded-xl border-2 cursor-grab active:cursor-grabbing transition-shadow ${dragIdx === idx ? 'shadow-lg shadow-white/10' : ''}`}
                        style={{ borderColor: sec.color, width: Math.max(sec.bars * 20, 80), minHeight: 120, backgroundColor: sec.color + '15' }}>
                        <div className="p-3 flex flex-col h-full">
                          <div className="flex items-center gap-1 mb-2">
                            <GripVertical className="w-3 h-3 text-gray-500" />
                            <span className="text-xs font-bold" style={{ color: sec.color }}>{sec.label}</span>
                          </div>
                          <div className="flex-1 flex items-center justify-center">
                            <span className="text-2xl font-bold text-white/80">{sec.bars}</span>
                            <span className="text-xs text-gray-400 ml-1 mt-1">bars</span>
                          </div>
                          <div className="flex items-center gap-1 mt-2">
                            <button onClick={() => updateSectionBars(sec.id, sec.bars - 1)}
                              className="w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center text-xs">-</button>
                            <button onClick={() => updateSectionBars(sec.id, sec.bars + 1)}
                              className="w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center text-xs">+</button>
                            <div className="flex-1" />
                            <button onClick={() => removeSection(sec.id)}
                              className="w-6 h-6 rounded bg-lattice-bg text-red-400 hover:text-red-300 flex items-center justify-center"><Trash2 className="w-3 h-3" /></button>
                          </div>
                        </div>
                      </motion.div>
                    ))}

                    {/* Add section button */}
                    <div className="flex-shrink-0 w-20">
                      <div className="border-2 border-dashed border-lattice-border rounded-xl flex items-center justify-center min-h-[120px] hover:border-gray-500 transition-colors group relative">
                        <Plus className="w-6 h-6 text-gray-600 group-hover:text-gray-400" />
                        <div className="absolute top-full mt-2 left-0 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-20 w-40">
                          {SECTION_PRESETS.map(s => (
                            <button key={s.type} onClick={() => addSection(s)}
                              className="w-full text-left px-3 py-2 text-xs hover:bg-lattice-elevated flex items-center gap-2">
                              <div className="w-3 h-3 rounded" style={{ backgroundColor: s.color }} />
                              {s.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Bar ruler */}
                  <div className="flex items-center gap-0 flex-wrap">
                    {arrangement.map(sec => (
                      <div key={`ruler_${sec.id}`} className="flex-shrink-0 flex" style={{ width: Math.max(sec.bars * 20, 80) + 12 }}>
                        {Array.from({ length: sec.bars }, (_, i) => (
                          <div key={i} className="flex-1 h-4 border-l border-gray-700 flex items-end">
                            <span className="text-[9px] text-gray-600 pl-0.5">{i + 1}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== Moodboard view ===== */}
            {boardMode === 'moodboard' && (
              <div ref={containerRef} className="flex-1 overflow-auto p-6">
                <div className="grid grid-cols-3 gap-4 max-w-6xl mx-auto">
                  {moodZones.map(zone => (
                    <div key={zone.id}
                      className="bg-lattice-surface border border-lattice-border rounded-xl p-4 min-h-[200px] flex flex-col">
                      <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                        {zone.label}
                        <button onClick={() => { setMoodTarget(zone.id); setMoodKind('text'); }}
                          className="ml-auto w-6 h-6 rounded bg-lattice-bg text-gray-400 hover:text-white flex items-center justify-center">
                          <Plus className="w-3 h-3" />
                        </button>
                      </h3>

                      <div className="flex-1 flex flex-wrap gap-2 content-start">
                        {zone.items.map((item, idx) => (
                          <div key={idx} className="group relative">
                            {item.kind === 'color' ? (
                              <div className="w-10 h-10 rounded-lg border border-white/10" style={{ backgroundColor: item.value }} />
                            ) : item.kind === 'audio' ? (
                              <div className="flex items-center gap-2 bg-neon-cyan/10 border border-neon-cyan/30 rounded-lg px-3 py-1.5">
                                <PenTool className="w-3 h-3 text-neon-cyan" />
                                <span className="text-xs text-neon-cyan">{item.value}</span>
                              </div>
                            ) : item.kind === 'image' ? (
                              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5">
                                <ImageIcon className="w-3 h-3 text-amber-400" />
                                <span className="text-xs text-amber-400">{item.value}</span>
                              </div>
                            ) : (
                              <div className="bg-lattice-elevated border border-lattice-border rounded-lg px-3 py-1.5">
                                <span className="text-xs text-gray-300">{item.value}</span>
                              </div>
                            )}
                            <button onClick={() => removeMoodItem(zone.id, idx)}
                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white items-center justify-center text-[9px] hidden group-hover:flex">
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))}
                        {zone.items.length === 0 && (
                          <p className="text-xs text-gray-600 italic">Drop or add items here...</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Color palette section */}
                <div className="mt-6 max-w-6xl mx-auto">
                  <h3 className="text-sm font-semibold text-gray-400 mb-3">Quick Mood Colors</h3>
                  <div className="flex gap-3 flex-wrap">
                    {['#1a1a2e', '#16213e', '#0f3460', '#533483', '#e94560', '#f5c518', '#06d6a0', '#118ab2', '#073b4c', '#ef476f', '#ffd166', '#6c5ce7'].map(c => (
                      <button key={c}
                        onClick={() => {
                          const colorZone = moodZones.find(z => z.label === 'Color Palette');
                          if (colorZone) {
                            setMoodZones(prev => prev.map(z => z.id === colorZone.id
                              ? { ...z, items: [...z.items, { kind: 'color', value: c }] } : z));
                          }
                        }}
                        className="w-10 h-10 rounded-lg border border-white/10 hover:scale-110 transition-transform"
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>

                {/* Mood item input modal */}
                <AnimatePresence>
                  {moodTarget && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold text-sm">Add to {moodZones.find(z => z.id === moodTarget)?.label}</h3>
                          <button onClick={() => setMoodTarget(null)}><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex gap-2 mb-3">
                          {(['text', 'audio', 'image', 'color'] as const).map(k => (
                            <button key={k} onClick={() => setMoodKind(k)}
                              className={`px-3 py-1 rounded-lg text-xs capitalize ${moodKind === k ? 'bg-neon-pink/20 text-neon-pink' : 'bg-lattice-bg text-gray-400'}`}>
                              {k}
                            </button>
                          ))}
                        </div>
                        {moodKind === 'color' ? (
                          <div className="grid grid-cols-6 gap-2 mb-4">
                            {COLORS.concat(['#1a1a2e', '#0f3460', '#e94560', '#06d6a0']).map(c => (
                              <button key={c} onClick={() => { setMoodInput(c); }}
                                className={`w-8 h-8 rounded-lg border-2 ${moodInput === c ? 'border-white' : 'border-transparent'}`}
                                style={{ backgroundColor: c }} />
                            ))}
                          </div>
                        ) : (
                          <input type="text" value={moodInput} onChange={e => setMoodInput(e.target.value)} autoFocus
                            placeholder={moodKind === 'audio' ? 'Audio note...' : moodKind === 'image' ? 'Image description...' : 'Mood description...'}
                            onKeyDown={e => e.key === 'Enter' && addMoodItem()}
                            className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        )}
                        <div className="flex gap-2">
                          <button onClick={addMoodItem} disabled={!moodInput.trim()} className="flex-1 py-2 bg-neon-pink text-black rounded-lg text-sm font-medium disabled:opacity-40">Add</button>
                          <button onClick={() => setMoodTarget(null)} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <PenTool className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2">Creative Canvas &amp; Moodboard</p>
              <p className="text-sm">Select or create a whiteboard to start</p>
            </div>
          </div>
        )}
      </div>

      {/* ===== Create Modal ===== */}
      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md">
              <h2 className="text-lg font-bold mb-4">Create Whiteboard</h2>
              <CreateForm onClose={() => setShowCreate(false)} onCreate={(data) => createMutation.mutate(data)} creating={createMutation.isPending} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real-time Data Panel */}
      {realtimeData && (
        <>
          <UniversalActions domain="whiteboard" artifactId={null} compact />
          <RealtimeDataPanel
            domain="whiteboard"
            data={realtimeData}
            isLive={isLive}
            lastUpdated={lastUpdated}
            insights={realtimeInsights}
            compact
          />
        </>
      )}

      {/* Whiteboard Actions Panel */}
      <div className="p-4 border-t border-lattice-border bg-lattice-surface/30">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-neon-pink" />
            Whiteboard Actions
          </h3>
          {wbActionResult && (
            <button onClick={() => setWbActionResult(null)} className="p-1 rounded hover:bg-lattice-elevated text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['shapeDetect', 'layoutOptimize', 'clusterGroup', 'exportPrep'] as const).map((action) => (
            <button
              key={action}
              onClick={() => handleWbAction(action)}
              disabled={!boardArtifacts[0]?.id || wbActiveAction !== null}
              className="px-3 py-1.5 text-sm rounded-lg bg-neon-pink/10 text-neon-pink border border-neon-pink/30 hover:bg-neon-pink/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {wbActiveAction === action ? (
                <div className="w-3 h-3 border border-neon-pink border-t-transparent rounded-full animate-spin" />
              ) : null}
              {action === 'shapeDetect' ? 'Shape Detect' : action === 'layoutOptimize' ? 'Optimize Layout' : action === 'clusterGroup' ? 'Cluster Group' : 'Export Prep'}
            </button>
          ))}
        </div>
        {wbActionResult && (
          <div className="panel p-3 space-y-2 text-sm">
            {wbActionResult.action === 'shapeDetect' && (() => {
              const r = wbActionResult.result;
              const shapes = r.shapes as Record<string, unknown> | undefined;
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Total Elements: <span className="text-white font-medium">{String(r.totalElements ?? 0)}</span></div>
                  {shapes && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {Object.entries(shapes).map(([shape, count]) => (
                        <span key={shape} className="bg-neon-pink/10 text-neon-pink px-2 py-0.5 rounded-full capitalize">
                          {shape}: {String(count)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}
            {wbActionResult.action === 'layoutOptimize' && (() => {
              const r = wbActionResult.result;
              const suggestions = Array.isArray(r.suggestions) ? r.suggestions as string[] : [];
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Score Before: <span className="text-white">{String(r.scoreBefore ?? 0)}</span></span>
                    <span className="text-gray-400">Score After: <span className="text-neon-green">{String(r.scoreAfter ?? 0)}</span></span>
                    <span className="text-gray-400">Overlaps Fixed: <span className="text-white">{String(r.overlapsFixed ?? 0)}</span></span>
                  </div>
                  {suggestions.length > 0 && (
                    <div className="text-xs space-y-0.5">{suggestions.slice(0, 3).map((s, i) => <div key={i} className="text-gray-300">• {s}</div>)}</div>
                  )}
                </div>
              );
            })()}
            {wbActionResult.action === 'clusterGroup' && (() => {
              const r = wbActionResult.result;
              const clusters = Array.isArray(r.clusters) ? r.clusters as Array<Record<string, unknown>> : [];
              return (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Clusters Found: <span className="text-white font-medium">{String(r.clusterCount ?? clusters.length)}</span></div>
                  <div className="space-y-1">
                    {clusters.slice(0, 4).map((c, i) => (
                      <div key={i} className="flex items-center justify-between text-xs bg-lattice-elevated px-2 py-1 rounded">
                        <span className="text-gray-300">Cluster {i + 1}</span>
                        <span className="text-gray-400">{String(c.elementCount ?? c.size ?? 0)} elements</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            {wbActionResult.action === 'exportPrep' && (() => {
              const r = wbActionResult.result;
              const formats = Array.isArray(r.supportedFormats) ? r.supportedFormats as string[] : [];
              return (
                <div className="space-y-2">
                  <div className="flex gap-4 text-xs">
                    <span className="text-gray-400">Elements: <span className="text-white">{String(r.elementCount ?? 0)}</span></span>
                    <span className="text-gray-400">Canvas: <span className="text-white">{String(r.canvasWidth ?? 0)}×{String(r.canvasHeight ?? 0)}</span></span>
                    <span className="text-gray-400">Est. Size: <span className="text-white">{String(r.estimatedSizeKb ?? 0)} KB</span></span>
                  </div>
                  {formats.length > 0 && (
                    <div className="flex gap-1 text-xs">
                      {formats.map((f, i) => <span key={i} className="bg-lattice-elevated text-gray-300 px-2 py-0.5 rounded">{f}</span>)}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* DTU Detail View modal (opened by double-clicking a DTU element on canvas) */}
      {viewingDtuId && (
        <DTUDetailView
          dtuId={viewingDtuId}
          onClose={() => setViewingDtuId(null)}
          onNavigate={(id) => setViewingDtuId(id)}
        />
      )}
    </div>
  );
}

/* ===== Create Form sub-component ===== */
function CreateForm({ onClose, onCreate, creating }: { onClose: () => void; onCreate: (data: { title: string; linkedDtus: string[] }) => void; creating: boolean }) {
  const [title, setTitle] = useState('');
  return (
    <>
      <input type="text" placeholder="Whiteboard Title" value={title} onChange={(e) => setTitle(e.target.value)}
        className="w-full px-3 py-2 bg-lattice-surface border border-lattice-border rounded mb-4" />
      <div data-lens-theme="whiteboard" className="flex gap-3 justify-end">
        <button onClick={onClose} className="px-4 py-2 bg-lattice-surface rounded-lg">Cancel</button>
        <button onClick={() => onCreate({ title, linkedDtus: [] })} disabled={creating || !title}
          className="px-4 py-2 bg-neon-pink text-black rounded-lg disabled:opacity-50">{creating ? 'Creating...' : 'Create'}</button>
      </div>
    </>
  );
}
