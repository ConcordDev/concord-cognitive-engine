'use client';

import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers } from '@/lib/api/client';
import { useLensData } from '@/lib/hooks/use-lens-data';
import { useState, useRef, useEffect, useCallback, type ComponentType } from 'react';
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
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui';
import { useRealtimeLens } from '@/hooks/useRealtimeLens';
import { LiveIndicator } from '@/components/lens/LiveIndicator';
import { DTUExportButton } from '@/components/lens/DTUExportButton';
import { RealtimeDataPanel } from '@/components/lens/RealtimeDataPanel';
import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import WhiteboardWorkbench from '@/components/whiteboard/WhiteboardWorkbench';
import { WhiteboardInspector } from './WhiteboardInspector';
import { WhiteboardMoodboardPanel } from './WhiteboardMoodboardPanel';
import { WhiteboardArrangementPanel } from './WhiteboardArrangementPanel';
import { WhiteboardCreateForm } from './WhiteboardCreateForm';
import {
  type BoardMode,
  type SketchTool as Tool,
  type SketchElement as Element,
  COLORS,
  STROKE_WIDTHS,
  CARD_COLORS,
  SECTION_PRESETS,
  MODE_LABELS,
  uid,
  clamp,
  fmtDur,
} from './whiteboard-model';

/* ================================================================== */
export function WhiteboardStudio({
  workbenchOpen,
  onWorkbenchOpen,
  onWorkbenchClose,
}: {
  workbenchOpen: boolean;
  onWorkbenchOpen: () => void;
  onWorkbenchClose: () => void;
}) {
  const { latestData: realtimeData, alerts: realtimeAlerts, insights: realtimeInsights, isLive, lastUpdated } = useRealtimeLens('whiteboard');
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isError: isError, error: error, refetch: refetch, items: boardArtifacts, create: createBoardArtifact } = useLensData('whiteboard', 'board', { noSeed: true });

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

  // Sidebar board list: prefer the real whiteboard.list() result; fall back to
  // the lens-artifact record only when the server list is genuinely empty.
  const boardListItems: Record<string, unknown>[] = (whiteboards?.whiteboards && whiteboards.whiteboards.length > 0)
    ? whiteboards.whiteboards
    : boardArtifacts.map(a => ({ id: a.id, title: a.title, elementCount: 0 }));

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

  /* Hydrate canvas from the selected board payload (render-time adjust, not an effect). */
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  if (selectedWbId !== hydratedId) {
    if (!selectedWbId) {
      setHydratedId(null);
      setElements([]);
    } else if (selectedWb) {
      setHydratedId(selectedWbId);
      setElements(selectedWb.whiteboard?.elements ?? []);
    } else if (hydratedId !== null) {
      setHydratedId(null);
      setElements([]);
    }
  }

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

  // Vector export — produces an SVG of the current board.  Vector form
  // scales without aliasing, opens in Figma / Illustrator / Inkscape, and
  // is the gold-standard "I want my drawing again later" format that
  // vector editors. Rasters (PNG) lose information; SVG keeps the
  // primitives addressable.  Renders rectangles, ellipses, lines,
  // arrows, freehand strokes, text, and labelled cards/sections; image
  // pins reference their source URL via `<image href>` so the SVG
  // round-trips with images embedded by reference.
  const exportSVG = useCallback(() => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const w = dimensions.width;
    const h = dimensions.height;
    const parts: string[] = [];
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
    parts.push(`<rect width="${w}" height="${h}" fill="#0f0f1a"/>`);
    // Arrowhead marker
    parts.push(`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`);
    for (const el of elements) {
      const stroke = esc(el.stroke);
      const fill = el.fill === 'transparent' ? 'none' : esc(el.fill);
      const sw = el.strokeWidth;
      const ex = el.x;
      const ey = el.y;
      if (el.type === 'rectangle') {
        parts.push(`<rect x="${ex}" y="${ey}" width="${el.width || 0}" height="${el.height || 0}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`);
      } else if (el.type === 'ellipse') {
        const rx = (el.width || 0) / 2; const ry = (el.height || 0) / 2;
        parts.push(`<ellipse cx="${ex + rx}" cy="${ey + ry}" rx="${Math.abs(rx)}" ry="${Math.abs(ry)}" stroke="${stroke}" fill="${fill}" stroke-width="${sw}"/>`);
      } else if (el.type === 'line' || el.type === 'arrow') {
        const x2 = ex + (el.width || 0); const y2 = ey + (el.height || 0);
        const arrowAttr = el.type === 'arrow' ? ` marker-end="url(#arrow)" color="${stroke}"` : '';
        parts.push(`<line x1="${ex}" y1="${ey}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${arrowAttr}/>`);
      } else if (el.type === 'freehand' && el.points && el.points.length) {
        const d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
        parts.push(`<path d="${d}" stroke="${stroke}" fill="none" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`);
      } else if (el.type === 'text') {
        parts.push(`<text x="${ex}" y="${ey + 16}" fill="${stroke}" font-family="ui-sans-serif, system-ui" font-size="14">${esc(el.text || '')}</text>`);
      } else if (el.type === 'image' && el.imageUrl) {
        parts.push(`<image href="${esc(el.imageUrl)}" x="${ex}" y="${ey}" width="${el.width || 200}" height="${el.height || 150}"/>`);
        if (el.imageLabel) parts.push(`<text x="${ex + 4}" y="${ey + (el.height || 150) + 14}" fill="#9ca3af" font-size="11">${esc(el.imageLabel)}</text>`);
      } else if (el.type === 'notecard') {
        const cw = el.width || 160; const ch = el.height || 100;
        parts.push(`<rect x="${ex}" y="${ey}" width="${cw}" height="${ch}" rx="6" fill="${esc(el.cardColor || '#fbbf24')}" opacity="0.9"/>`);
        if (el.text) parts.push(`<text x="${ex + 8}" y="${ey + 18}" fill="#1f2937" font-size="12">${esc(el.text)}</text>`);
      } else if (el.type === 'section') {
        const cw = el.width || 200; const ch = el.height || 60;
        parts.push(`<rect x="${ex}" y="${ey}" width="${cw}" height="${ch}" rx="4" stroke="${stroke}" fill="${fill}" stroke-width="${sw}" opacity="0.7"/>`);
        const label = `${el.text || ''}${el.bars ? ` (${el.bars} bars)` : ''}`;
        if (label) parts.push(`<text x="${ex + 8}" y="${ey + 18}" fill="${stroke}" font-size="12" font-weight="bold">${esc(label)}</text>`);
      } else if (el.type === 'dtu') {
        const cw = el.width || 180; const ch = el.height || 80;
        parts.push(`<rect x="${ex}" y="${ey}" width="${cw}" height="${ch}" rx="6" stroke="${stroke}" fill="#1a1a2e" stroke-width="${sw}"/>`);
        if (el.dtuTitle) parts.push(`<text x="${ex + 8}" y="${ey + 18}" fill="#a855f7" font-size="11" font-weight="bold">${esc(el.dtuTitle.slice(0, 28))}</text>`);
        if (el.dtuId) parts.push(`<text x="${ex + 8}" y="${ey + 36}" fill="#6b7280" font-size="9" font-family="monospace">${esc(el.dtuId.slice(0, 24))}</text>`);
      } else if (el.type === 'audio') {
        const cw = el.width || 140; const ch = el.height || 50;
        parts.push(`<rect x="${ex}" y="${ey}" width="${cw}" height="${ch}" rx="6" stroke="${stroke}" fill="#0a1f2a" stroke-width="${sw}"/>`);
        parts.push(`<text x="${ex + 8}" y="${ey + 20}" fill="${stroke}" font-size="11" font-weight="bold">♪ ${esc(el.clipName || 'audio')}</text>`);
        if (el.duration !== undefined) parts.push(`<text x="${ex + 8}" y="${ey + 36}" fill="#6b7280" font-size="10">${fmtDur(el.duration)}</text>`);
      }
    }
    parts.push(`</svg>`);
    const svg = parts.join('\n');
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [elements, dimensions]);

  // Copy a JSON snapshot to clipboard — handy for sharing a board
  // template with another user / paste-to-import.
  const exportClipboardJSON = useCallback(async () => {
    const snapshot = { elements, dimensions, exportedAt: new Date().toISOString() };
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    } catch {
      console.warn('[Whiteboard] clipboard write failed');
    }
  }, [elements, dimensions]);

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

  /* ---------- duplicate selected ---------- */
  const duplicateSelected = useCallback(() => {
    if (!selectedElement) return;
    pushUndo();
    const copy: Element = {
      ...selectedElement,
      id: `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      x: (selectedElement.x ?? 0) + 16,
      y: (selectedElement.y ?? 0) + 16,
    };
    setElements((prev) => [...prev, copy]);
    setSelectedElement(copy);
  }, [selectedElement, pushUndo]);

  /* ---------- keyboard shortcuts (canvas idiom) ---------- */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const mod = e.ctrlKey || e.metaKey;

      // Mod-key combos (don't double-trigger tool letters).
      if (mod) {
        if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
        if ((e.key.toLowerCase() === 'y') || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return; }
        if (e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
        if (e.key === '=' || e.key === '+') { e.preventDefault(); setZoom((z) => clamp(z * 1.2, 0.25, 4)); return; }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom((z) => clamp(z / 1.2, 0.25, 4)); return; }
        if (e.key === '0') { e.preventDefault(); setZoom(1); setOffset({ x: 0, y: 0 }); return; }
        // ⌘A intentionally not implemented yet — single-element selection
        // model would need to extend to multi-select first. Skipping until
        // that lands rather than silently mis-binding.
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
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
  }, [deleteSelected, undo, redo, duplicateSelected]);

  /* ---------- tools array ---------- */
  const tools: { id: Tool; icon: ComponentType<{ className?: string; size?: number | string }>; label: string; key: string }[] = [
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


  /* ================================================================== */
  /*                             RENDER                                  */
  /* ================================================================== */

  if (isLoading) {
    return (
      <div className="h-full flex bg-lattice-bg p-4 gap-4">
        <div className="w-64 space-y-3">
          <Skeleton variant="block" height={40} />
          <Skeleton variant="block" height={36} />
          <Skeleton variant="line" lines={5} />
        </div>
        <div className="flex-1 space-y-3">
          <Skeleton variant="block" height={44} />
          <Skeleton variant="block" height="70vh" />
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
    <div className="h-[calc(100vh-5rem)] min-h-[640px] flex bg-lattice-bg overflow-hidden" data-lens-theme="whiteboard">
      <aside className="w-56 border-r border-lattice-border bg-lattice-surface p-3 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <PenTool className="w-5 h-5 text-cyan-300" />
          <h1 className="text-sm font-bold leading-tight">Board</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <LiveIndicator isLive={isLive} lastUpdated={lastUpdated} compact />
          <DTUExportButton domain="whiteboard" data={realtimeData || {}} compact />
          {realtimeAlerts.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">
              {realtimeAlerts.length} alert{realtimeAlerts.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        <div className="relative mb-3">
          <button type="button" onClick={() => setShowModeMenu(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-lattice-bg border border-lattice-border text-sm">
            <span>{MODE_LABELS[boardMode]}</span>
            <span className="text-gray-400 text-xs">{showModeMenu ? '▴' : '▾'}</span>
          </button>
          <AnimatePresence>
            {showModeMenu && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute left-0 right-0 top-full mt-1 bg-lattice-surface border border-lattice-border rounded-lg overflow-hidden z-30 shadow-xl">
                {(Object.keys(MODE_LABELS) as BoardMode[]).map(m => (
                  <button key={m} type="button" onClick={() => { setBoardMode(m); setShowModeMenu(false); }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-lattice-elevated ${boardMode === m ? 'text-neon-cyan' : 'text-gray-300'}`}>
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button type="button" onClick={() => setShowCreate(true)} className="w-full py-2 bg-cyan-400 text-black font-medium rounded-lg hover:bg-cyan-300 mb-3 flex items-center justify-center gap-2 text-sm">
          <Plus className="w-4 h-4" />New Board
        </button>

        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          <p className="text-xs text-gray-400 mb-2">Whiteboards (<span className="tabular-nums">{whiteboards?.count || 0}</span>)</p>
          {boardListItems.length === 0 ? (
            <p className="text-xs text-gray-400 italic py-4 text-center">No whiteboards yet — create one to get started.</p>
          ) : (
            boardListItems.map((wb: Record<string, unknown>) => (
              <button key={wb.id as string} type="button" onClick={() => setSelectedWbId(wb.id as string)}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors ${selectedWbId === wb.id ? 'border-cyan-400 bg-lattice-elevated' : 'border-lattice-border hover:border-cyan-400/50'}`}>
                <p className="font-medium truncate text-sm">{wb.title as string}</p>
                <p className="text-xs text-gray-400 mt-1"><span className="tabular-nums">{(wb.elementCount as number) || 0}</span> elements</p>
              </button>
            ))
          )}
        </div>
        {realtimeData && (
          <div className="mt-2 border-t border-lattice-border pt-2">
            <RealtimeDataPanel
              domain="whiteboard"
              data={realtimeData}
              isLive={isLive}
              lastUpdated={lastUpdated}
              insights={realtimeInsights}
              compact
            />
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {selectedWbId ? (
          <>
            {boardMode === 'canvas' && (
              <div className="border-b border-lattice-border bg-lattice-surface/50 backdrop-blur p-2 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1 bg-lattice-bg rounded-lg p-1">
                  {tools.map(t => (
                    <button key={t.id} type="button" onClick={() => setTool(t.id)} title={`${t.label}${t.key ? ` (${t.key})` : ''}`}
                      className={`p-2 rounded-md transition-colors ${tool === t.id ? 'bg-cyan-400/20 text-cyan-300' : 'text-gray-400 hover:text-white'}`}>
                      <t.icon className="w-5 h-5" />
                    </button>
                  ))}
                </div>
                <div className="w-px h-8 bg-lattice-border mx-1" />
                <button type="button" onClick={() => setShowColorPicker(!showColorPicker)} className="p-2 rounded-lg border border-lattice-border hover:bg-lattice-elevated relative" aria-label="Palette">
                  <Palette className="w-5 h-5" style={{ color: strokeColor }} />
                </button>
                <div className="flex items-center gap-1 bg-lattice-bg rounded-lg p-1">
                  {STROKE_WIDTHS.map(w => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setStrokeWidth(w)}
                      aria-label={`Stroke width ${w}`}
                      aria-pressed={strokeWidth === w}
                      className={`w-8 h-8 rounded flex items-center justify-center ${strokeWidth === w ? 'bg-lattice-elevated' : 'hover:bg-lattice-elevated'}`}
                    >
                      <div className="rounded-full bg-current" style={{ width: w * 2, height: w * 2 }} />
                    </button>
                  ))}
                </div>
                <div className="w-px h-8 bg-lattice-border mx-1" />
                <button type="button" onClick={undo} disabled={undoStack.length === 0} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-amber-500" title="Undo (Ctrl+Z)"><Undo2 className="w-5 h-5" /></button>
                <button type="button" onClick={redo} disabled={redoStack.length === 0} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30" title="Redo (Ctrl+Y)"><Redo2 className="w-5 h-5" /></button>
                <button type="button" onClick={deleteSelected} disabled={!selectedElement} className="p-2 rounded-lg hover:bg-lattice-elevated disabled:opacity-30 text-red-400" title="Delete"><Trash2 className="w-5 h-5" /></button>
                <div className="w-px h-8 bg-lattice-border mx-1" />
                <button type="button" onClick={() => setShowGrid(!showGrid)} className={`p-2 rounded-lg ${showGrid ? 'bg-lattice-elevated text-neon-cyan' : 'hover:bg-lattice-elevated text-gray-400'}`} aria-label="Grid3 x3"><Grid3X3 className="w-5 h-5" /></button>
                <button type="button" onClick={() => setZoom(z => clamp(z * 1.2, 0.25, 4))} className="p-2 rounded-lg hover:bg-lattice-elevated" aria-label="Zoom in"><ZoomIn className="w-5 h-5" /></button>
                <span className="text-sm text-gray-400 w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
                <button type="button" onClick={() => setZoom(z => clamp(z / 1.2, 0.25, 4))} className="p-2 rounded-lg hover:bg-lattice-elevated" aria-label="Zoom out"><ZoomOut className="w-5 h-5" /></button>
                <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} className="p-2 rounded-lg hover:bg-lattice-elevated" aria-label="Rotate ccw"><RotateCcw className="w-5 h-5" /></button>
                <div className="flex-1" />
                <button type="button" onClick={() => saveMutation.mutate({ elements })} disabled={saveMutation.isPending}
                  className="px-4 py-2 bg-lattice-elevated rounded-lg hover:bg-lattice-bg flex items-center gap-2 text-sm">
                  <Save className="w-4 h-4" />{saveMutation.isPending ? 'Saving...' : 'Save'}
                </button>
                <div className="relative group">
                  <button
                    type="button"
                    onClick={() => { window.dispatchEvent(new CustomEvent('whiteboard:toggle-export-menu')); }}
                    className="px-4 py-2 bg-lattice-elevated rounded-lg hover:bg-lattice-bg flex items-center gap-2 text-sm"
                  >
                    <Download className="w-4 h-4" />Export
                  </button>
                  <div className="absolute right-0 top-full mt-1 w-48 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-30 overflow-hidden">
                    <button type="button" onClick={exportCanvas} className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-lattice-elevated flex items-center justify-between" title="Raster — best for sharing">
                      <span>PNG image</span>
                      <code className="text-[9px] text-gray-400">.png</code>
                    </button>
                    <button type="button" onClick={exportSVG} disabled={elements.length === 0} className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-lattice-elevated flex items-center justify-between disabled:opacity-40" title="Vector — opens in Figma / Illustrator / Inkscape">
                      <span>SVG vector</span>
                      <code className="text-[9px] text-gray-400">.svg</code>
                    </button>
                    <button type="button" onClick={exportClipboardJSON} disabled={elements.length === 0} className="w-full px-3 py-2 text-left text-xs text-gray-200 hover:bg-lattice-elevated border-t border-lattice-border disabled:opacity-40" title="Copy a JSON snapshot to clipboard">
                      Copy JSON to clipboard
                    </button>
                  </div>
                </div>
              </div>
            )}

            {boardMode === 'canvas' && (
              <div ref={containerRef} className="flex-1 relative overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full cursor-crosshair"
                  style={{ width: dimensions.width, height: dimensions.height }}
                  onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp} onWheel={handleWheel} onDoubleClick={handleDoubleClick} />

                {elements.filter(el => el.type === 'audio').map(el => (
                  <button key={`play_${el.id}`} type="button"
                    onClick={() => toggleAudioPlay(el.id)}
                    className="absolute w-7 h-7 rounded-full opacity-0 hover:opacity-30"
                    style={{
                      left: el.x * zoom + offset.x + 12,
                      top: el.y * zoom + offset.y + (el.height || 72) / 2 * zoom - 14,
                    }} />
                ))}

                <AnimatePresence>
                  {showColorPicker && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                      className="absolute top-16 left-48 bg-lattice-surface border border-lattice-border rounded-lg p-4 shadow-xl z-10">
                      <p className="text-xs text-gray-400 mb-2">Stroke</p>
                      <div className="grid grid-cols-4 gap-2 mb-4">
                        {COLORS.map(c => (
                          <button key={c} type="button" onClick={() => setStrokeColor(c)}
                            className={`w-8 h-8 rounded-lg border-2 ${strokeColor === c ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">Fill</p>
                      <div className="grid grid-cols-4 gap-2">
                        <button type="button" onClick={() => setFillColor('transparent')}
                          className={`w-8 h-8 rounded-lg border-2 ${fillColor === 'transparent' ? 'border-white' : 'border-transparent'} bg-transparent`} aria-label="Close">
                          <X className="w-4 h-4 mx-auto text-gray-400" />
                        </button>
                        {COLORS.slice(0, 7).map(c => (
                          <button key={c} type="button" onClick={() => setFillColor(c + '40')}
                            className={`w-8 h-8 rounded-lg border-2 ${fillColor === c + '40' ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c + '40' }} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {textPosition && tool === 'text' && (
                    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      className="absolute bg-lattice-surface border border-lattice-border rounded-lg p-3 shadow-xl z-10"
                      style={{ left: textPosition.x * zoom + offset.x, top: textPosition.y * zoom + offset.y }}>
                      <input type="text" value={textInput} onChange={e => setTextInput(e.target.value)} autoFocus placeholder="Enter text..."
                        onKeyDown={e => e.key === 'Enter' && addText()} className="px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm w-48" />
                      <div className="flex gap-2 mt-2">
                        <button type="button" onClick={addText} className="flex-1 py-1 bg-neon-cyan text-black rounded text-sm">Add</button>
                        <button type="button" onClick={() => setTextPosition(null)} className="flex-1 py-1 bg-lattice-bg rounded text-sm">Cancel</button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showAudioDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><PenTool className="w-4 h-4 text-neon-cyan" />Pin Audio Clip</h3>
                          <button type="button" onClick={() => { setShowAudioDialog(false); setTextPosition(null); }} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <input type="text" placeholder="Clip name (e.g. Verse Vocal Take 3)" value={audioClipName}
                          onChange={e => setAudioClipName(e.target.value)} autoFocus
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3" />
                        <label className="text-xs text-gray-400">Duration (seconds)</label>
                        <input type="number" value={audioClipDur} onChange={e => setAudioClipDur(clamp(+e.target.value, 1, 3600))}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        <div className="flex gap-2">
                          <button type="button" onClick={addAudioPin} disabled={!audioClipName.trim()} className="flex-1 py-2 bg-neon-cyan text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Pin</button>
                          <button type="button" onClick={() => { setShowAudioDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showImageDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><ImageIcon className="w-4 h-4 text-amber-400" />Pin Image Reference</h3>
                          <button type="button" onClick={() => { setShowImageDialog(false); setTextPosition(null); }} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <input type="text" placeholder="Label (e.g. Album Cover Ref)" value={imageLabel}
                          onChange={e => setImageLabel(e.target.value)} autoFocus
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        <div className="flex gap-2">
                          <button type="button" onClick={addImagePin} disabled={!imageLabel.trim()} className="flex-1 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Pin</button>
                          <button type="button" onClick={() => { setShowImageDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showNoteDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><StickyNote className="w-4 h-4 text-yellow-400" />Note Card</h3>
                          <button type="button" onClick={() => { setShowNoteDialog(false); setTextPosition(null); }} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <DraftedTextarea lensId="whiteboard" draftKey="note-card-text" placeholder="Note text..." initial={noteText}
                          onValueChange={setNoteText} autoFocus rows={3}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3 resize-none" />
                        <p className="text-xs text-gray-400 mb-2">Card color</p>
                        <div className="flex gap-2 mb-4">
                          {CARD_COLORS.map(c => (
                            <button key={c} type="button" onClick={() => setNoteColor(c)}
                              className={`w-8 h-8 rounded-lg border-2 ${noteColor === c ? 'border-white' : 'border-transparent'}`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={addNoteCard} disabled={!noteText.trim()} className="flex-1 py-2 bg-yellow-500 text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Card</button>
                          <button type="button" onClick={() => { setShowNoteDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showSectionDialog && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-5 w-80">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold flex items-center gap-2"><Bookmark className="w-4 h-4 text-purple-400" />Section Marker</h3>
                          <button type="button" onClick={() => { setShowSectionDialog(false); setTextPosition(null); }} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-2 mb-4">
                          {SECTION_PRESETS.map(s => (
                            <button key={s.type} type="button" onClick={() => setSectionChoice(s)}
                              className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-colors ${sectionChoice.type === s.type ? 'border-white bg-lattice-elevated' : 'border-lattice-border hover:border-white/20'}`}>
                              <div className="w-4 h-4 rounded" style={{ backgroundColor: s.color }} />
                              <span className="text-sm">{s.label}</span>
                              <span className="text-xs text-gray-400 ml-auto">{s.bars} bars</span>
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={addSectionMarker} className="flex-1 py-2 bg-purple-500 text-black rounded-lg text-sm font-medium">Place Marker</button>
                          <button type="button" onClick={() => { setShowSectionDialog(false); setTextPosition(null); }} className="flex-1 py-2 bg-lattice-bg rounded-lg text-sm">Cancel</button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {showDtuPicker && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="absolute inset-0 bg-black/50 flex items-center justify-center z-20">
                      <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
                        className="bg-lattice-surface border border-lattice-border rounded-lg p-4 w-96 max-h-96 overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="font-semibold">Link DTU</h3>
                          <button type="button" onClick={() => setShowDtuPicker(false)} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="space-y-2">
                          {dtus?.dtus?.slice(0, 20).map((dtu: Record<string, unknown>) => (
                            <button key={dtu.id as string} type="button" onClick={() => addDtu(dtu)}
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

            {boardMode === 'arrangement' && <WhiteboardArrangementPanel />}
            {boardMode === 'moodboard' && <WhiteboardMoodboardPanel />}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <PenTool className="w-16 h-16 mx-auto mb-4 opacity-30" />
              <p className="text-lg mb-2">Infinite canvas</p>
              <p className="text-sm">Select or create a board to start sketching</p>
            </div>
          </div>
        )}
      </div>

      <WhiteboardInspector boardId={boardArtifacts[0]?.id ?? selectedWbId ?? undefined} />

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="bg-lattice-bg border border-lattice-border rounded-lg p-6 w-full max-w-md">
              <h2 className="text-lg font-bold mb-4">Create Whiteboard</h2>
              <WhiteboardCreateForm onClose={() => setShowCreate(false)} onCreate={(data) => createMutation.mutate(data)} creating={createMutation.isPending} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {viewingDtuId && (
        <DTUDetailView
          dtuId={viewingDtuId}
          onClose={() => setViewingDtuId(null)}
          onNavigate={(id) => setViewingDtuId(id)}
        />
      )}

      <button
        type="button"
        onClick={onWorkbenchOpen}
        className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-sky-500 hover:bg-sky-400 text-sky-50 shadow-2xl text-sm font-medium"
        title="Whiteboard Workbench — boards, 6 templates (SWOT/retro/journey/mindmap/crazy8s/brainstorm), voting"
      >
        Whiteboard Workbench
      </button>
      <WhiteboardWorkbench open={workbenchOpen} onClose={onWorkbenchClose} />
    </div>
  );
}

export default WhiteboardStudio;
