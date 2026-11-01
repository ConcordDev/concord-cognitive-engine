'use client';

import { DraftedTextarea } from '@/components/lens/DraftedTextarea';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiHelpers, lensRun } from '@/lib/api/client';
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
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  X,
  Move,
  Image as ImageIcon,
  StickyNote,
  Bookmark,
  MoreHorizontal,
  ChevronUp,
  ChevronDown,
  RotateCw,
} from 'lucide-react';
import { ErrorState } from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui';

import { DTUDetailView } from '@/components/dtu/DTUDetailView';
import WhiteboardWorkbench from '@/components/whiteboard/WhiteboardWorkbench';
import { WhiteboardInspector } from './WhiteboardInspector';
import { WhiteboardMoodboardPanel } from './WhiteboardMoodboardPanel';
import { WhiteboardArrangementPanel } from './WhiteboardArrangementPanel';
import { WhiteboardCreateForm } from './WhiteboardCreateForm';
import { WhiteboardKeepMenu } from './WhiteboardKeepMenu';
import { BoardOwnerMenu } from './BoardOwnerMenu';
import { commitDeletedBoard } from './boardOwner';
import { axiosStatus } from './boardOwner';
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
  selectAllIds,
  duplicateSelection,
} from './whiteboard-model';

const LAST_BOARD_KEY = 'concord:whiteboard:last';

/** Boards are stored as "Whiteboard: <name>" DTUs; show just the name. */
const boardName = (t: unknown) => String(t ?? 'Board').replace(/^Whiteboard:\s*/, '') || 'Board';

/* D5: export receipts — provenance (board DTU, element count, export
 * time) rides inside the exported file. CRC32 + a PNG tEXt chunk
 * carry it in PNGs; SVG exports use a <metadata> element instead. */
const WB_CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
const wbCrc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = WB_CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const wbPngWithReceipt = (png: Uint8Array, receiptJson: string): Uint8Array => {
  // Not a PNG we can splice into (shorter than signature + IHDR): hand it back untouched rather than throw.
  if (png.length < 33) return png;
  const enc = new TextEncoder();
  const keyword = enc.encode('concord-whiteboard');
  const chunkData = new Uint8Array(keyword.length + 1 + enc.encode(receiptJson).length);
  chunkData.set(keyword, 0);
  chunkData[keyword.length] = 0;
  chunkData.set(enc.encode(receiptJson), keyword.length + 1);
  const chunk = new Uint8Array(12 + chunkData.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, chunkData.length);
  chunk.set(enc.encode('tEXt'), 4);
  chunk.set(chunkData, 8);
  dv.setUint32(8 + chunkData.length, wbCrc32(chunk.subarray(4, 8 + chunkData.length)));
  // IHDR is the first chunk: 8-byte signature + 25 bytes.
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, 33), 0);
  out.set(chunk, 33);
  out.set(png.subarray(33), 33 + chunk.length);
  return out;
};

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
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { isError: isError, error: error, refetch: refetch, items: boardArtifacts } = useLensData('whiteboard', 'board', { noSeed: true });

  const [showCreate, setShowCreate] = useState(false);
  const [selectedWbId, setSelectedWbId] = useState<string | null>(null);
  const [boardMode, setBoardMode] = useState<BoardMode>('canvas');
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [copyNote, setCopyNote] = useState<{ text: string; ok: boolean } | null>(null);
  // D1/D2/D3/D4/E-WB-1: strip linkage, save flash, settle, ceremony, egg.
  const [stripInfo, setStripInfo] = useState<{ keptVersion?: number; keptAt?: string } | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveFlash, setSaveFlash] = useState(false);
  const [settle, setSettle] = useState<{ id: string; t0: number } | null>(null);
  const [, setSettleTick] = useState(0);
  const [presentIdx, setPresentIdx] = useState<number | null>(null);
  const [ceremonyBusy, setCeremonyBusy] = useState(false);
  const [eggLine, setEggLine] = useState<{ text: string; x: number; y: number } | null>(null);
  const copyNoteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [moreTools, setMoreTools] = useState(false);

  /* canvas state */
  const [tool, setTool] = useState<Tool>('select');
  const [elements, setElements] = useState<Element[]>([]);
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [editingElement, setEditingElement] = useState<{ id: string; draft: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const groupDragRef = useRef<{ startX: number; startY: number; origins: Map<string, { x: number; y: number }> } | null>(null);
  const resizeRef = useRef<{ id: string; corner: string; startX: number; startY: number; orig: { x: number; y: number; width: number; height: number } } | null>(null);
  const [viewingDtuId, setViewingDtuId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentElement, setCurrentElement] = useState<Element | null>(null);
  // Latest in-progress element. Mouse events can arrive faster than renders, so
  // reading currentElement from the render closure dropped freehand points.
  const drawingRef = useRef<Element | null>(null);
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
  const [showGrid, setShowGrid] = useState(() => {
    try { return window.localStorage.getItem('wb-show-grid') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { window.localStorage.setItem('wb-show-grid', showGrid ? '1' : '0'); } catch { /* storage unavailable */ }
  }, [showGrid]);
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
  const [imageUrlInput, setImageUrlInput] = useState('');
  const [imageData, setImageData] = useState('');
  const [imageName, setImageName] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [imageTick, setImageTick] = useState(0);
  const imageCacheRef = useRef(new Map<string, HTMLImageElement>());
  const [noteText, setNoteText] = useState('');
  const [noteColor, setNoteColor] = useState(CARD_COLORS[0]);
  const [sectionChoice, setSectionChoice] = useState(SECTION_PRESETS[0]);

  /* ---------- queries / mutations ---------- */
  const { data: whiteboards, isLoading, isError: isError2, error: error2, refetch: refetch2,} = useQuery({
    queryKey: ['whiteboards'],
    queryFn: () => apiHelpers.whiteboard.list().then(r => r.data),
  });

  // S2: trashed board ids (domain store) — the Studio's REST list hides
  // a board the moment it is deleted, before the DTU commit lands.
  const { data: trashData } = useQuery({
    queryKey: ['whiteboard-trash'],
    queryFn: async () => {
      const r = await lensRun({ domain: 'whiteboard', action: 'boards-trash-list', input: {} });
      return r.data;
    },
  });
  const trashedBoardIds = new Set<string>(
    (((trashData?.result?.boards as Array<{ id: string }> | undefined) ?? []).map((b) => b.id)),
  );

  const { data: selectedWb, isError: isError3, error: error3, refetch: refetch3,} = useQuery({
    queryKey: ['whiteboard', selectedWbId],
    queryFn: async () => {
      try {
        const r = await apiHelpers.whiteboard.get(selectedWbId!);
        return r.data;
      } catch (err) {
        // A missing or not-owned board is a real 404. Keep the studio up;
        // the canvas simply has no payload to draw.
        if (axiosStatus(err) === 404) return { ok: false, error: 'Whiteboard not found', status: 404 };
        throw err;
      }
    },
    enabled: !!selectedWbId,
  });

  // Sidebar board list: prefer the real whiteboard.list() result; fall back to
  // the lens-artifact record only when the server list is genuinely empty.
  const boardListItems: Record<string, unknown>[] = ((whiteboards?.whiteboards && whiteboards.whiteboards.length > 0)
    ? whiteboards.whiteboards
    : boardArtifacts.map(a => ({ id: a.id, title: a.title, elementCount: Array.isArray((a as { data?: { elements?: unknown[] } }).data?.elements) ? ((a as { data?: { elements?: unknown[] } }).data!.elements as unknown[]).length : 0 })))
    .filter((b: Record<string, unknown>) => !trashedBoardIds.has(String(b.id)));

  // North star: the canvas is the page, so open the most recent board instead
  // of an empty "select a board" screen (render-time adjust, once).
  const [autoPicked, setAutoPicked] = useState(false);
  if (!autoPicked && !selectedWbId && !isLoading && boardListItems.length > 0) {
    setAutoPicked(true);
    let last: string | null = null;
    try { last = window.localStorage.getItem(LAST_BOARD_KEY); } catch { /* storage unavailable */ }
    const remembered = last && boardListItems.find((b) => b.id === last);
    setSelectedWbId(String(remembered ? remembered.id : boardListItems[0].id));
  }
  useEffect(() => {
    if (!selectedWbId) return;
    try { window.localStorage.setItem(LAST_BOARD_KEY, selectedWbId); } catch { /* storage unavailable */ }
  }, [selectedWbId]);

  // D1: the strip reads the domain mirror record for the kept-DTU
  // linkage (version + kept time) the S3 save model maintains.
  useEffect(() => {
    setStripInfo(null);
    setLastSavedAt(null);
    setPresentIdx(null);
    if (!selectedWbId) return;
    let cancelled = false;
    void lensRun({ domain: 'whiteboard', action: 'board-load', input: { id: selectedWbId } })
      .then((r) => {
        if (cancelled) return;
        const rec = (r.data as { result?: { board?: { keptVersion?: number; keptAt?: string } } }).result?.board;
        setStripInfo(rec ? { keptVersion: rec.keptVersion, keptAt: rec.keptAt } : null);
      })
      .catch(() => { /* mirror is best-effort; the strip still shows canvas truth */ });
    return () => { cancelled = true; };
  }, [selectedWbId]);

  // D2: the M7 flash is a single beat, then gone.
  useEffect(() => {
    if (!saveFlash) return;
    const tm = setTimeout(() => setSaveFlash(false), 260);
    return () => clearTimeout(tm);
  }, [saveFlash]);

  // D3: rAF-drive the 140ms settle, then release it.
  useEffect(() => {
    if (!settle) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setSettle(null); return; }
    let raf = 0;
    const step = () => {
      if (performance.now() - settle.t0 >= 150) { setSettle(null); return; }
      setSettleTick((v) => v + 1);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [settle]);

  // E-WB-1: the typeset line fades after a few seconds.
  useEffect(() => {
    if (!eggLine) return;
    const tm = setTimeout(() => setEggLine(null), 3200);
    return () => clearTimeout(tm);
  }, [eggLine]);

  // D4: Present walks the board's section frames as slides — each
  // step centres the frame and the workspace beneath it.
  const sectionFrames = elements.filter((el) => el.type === 'section');
  useEffect(() => {
    if (presentIdx === null) return;
    const sec = sectionFrames[presentIdx];
    if (!sec) return;
    const targetZoom = Math.min(1.5, Math.max(0.4, (dimensions.width - 80) / (sec.width || 336)));
    setZoom(targetZoom);
    setOffset({
      x: dimensions.width / 2 - (sec.x + (sec.width || 336) / 2) * targetZoom,
      y: 60 - sec.y * targetZoom,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentIdx]);

  const { data: dtus, isError: isError4, error: error4, refetch: refetch4,} = useQuery({
    queryKey: ['dtus-whiteboard'],
    queryFn: () => apiHelpers.dtus.paginated({ limit: 100 }).then(r => r.data),
  });

  const createMutation = useMutation({
    mutationFn: async (data: { title: string; linkedDtus: string[] }) => {
      // One write. The server mirrors a linked lens artifact (type board)
      // and keeps that shadow in step on rename and delete.
      return apiHelpers.whiteboard.create(data);
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
      queryClient.invalidateQueries({ queryKey: ['lens', 'whiteboard'] });
      setSelectedWbId(res.data.dtuId);
      setShowCreate(false);
    },
    onError: (err) => {
      console.error('Failed to create whiteboard:', err instanceof Error ? err.message : err);
    },
  });

  const saveMutation = useMutation({
    mutationFn: (data: { elements: Element[] }) => apiHelpers.whiteboard.update(selectedWbId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whiteboard', selectedWbId] });
      setLastSavedAt(new Date().toISOString());
      setSaveFlash(true);
    },
    onError: (err) => {
      console.error('Failed to save whiteboard:', err instanceof Error ? err.message : err);
    },
  });

  /* Hydrate canvas from the selected board payload (render-time adjust, not an effect). */
  const [hydratedId, setHydratedId] = useState<string | null>(null);
  const [pendingBoardDelete, setPendingBoardDelete] = useState<{ id: string; title: string } | null>(null);
  const boardDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!selectedWbId || hydratedId !== selectedWbId) return;
    // Skip the initial load (when elements were just set from server data)
    if (selectedWb?.whiteboard?.elements && JSON.stringify(selectedWb.whiteboard.elements) === JSON.stringify(elements)) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveMutation.mutate({ elements });
    }, 2000);
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedWbId]);
  /* S1 (one board store): mirror the open canvas board into the domain
     board store under its DTU id, so the Workbench list, the Collab
     list, Analyze and the workspace summary all read the same board
     the canvas is showing. Debounced like the autosave; fires for an
     emptied board too (element counts must be able to reach zero). */
  const mirrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMirroredRef = useRef<string>('');
  useEffect(() => {
    if (!selectedWbId || hydratedId !== selectedWbId) return;
    const title = boardName(boardListItems.find((b) => b.id === selectedWbId)?.title ?? selectedWb?.whiteboard?.title);
    const payload = JSON.stringify({ id: selectedWbId, title, elements });
    if (payload === lastMirroredRef.current) return;
    if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current);
    mirrorTimerRef.current = setTimeout(() => {
      lastMirroredRef.current = payload;
      void lensRun({ domain: 'whiteboard', action: 'board-save', input: {
        id: selectedWbId, title, origin: 'canvas', dtuId: selectedWbId,
        scene: { elements, appState: { grid: showGrid }, model: 'sketch' },
      } }).catch(() => { /* best-effort mirror; the DTU save is the record */ });
    }, 1500);
    return () => { if (mirrorTimerRef.current) clearTimeout(mirrorTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, selectedWbId, hydratedId, showGrid]);

  /* S2: deleting the open board is a window, not an instant. The board
     record soft-deletes immediately (every list hides the board); the
     DTU delete commits only when the Undo window lapses. */
  const handleBoardDeleted = async () => {
    const id = selectedWbId;
    if (!id) return;
    const title = boardName(boardListItems.find((b) => b.id === id)?.title ?? selectedWb?.whiteboard?.title);
    setShowModeMenu(false);
    setSelectedWbId(null);
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-delete', input: { id } });
    } catch { /* a never-mirrored board has no record to trash; the DTU commit still runs */ }
    queryClient.invalidateQueries({ queryKey: ['whiteboard-trash'] });
    queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
    if (boardDeleteTimerRef.current) clearTimeout(boardDeleteTimerRef.current);
    setPendingBoardDelete({ id, title });
    boardDeleteTimerRef.current = setTimeout(() => {
      setPendingBoardDelete(null);
      void commitDeletedBoard(id, true).then(() => {
        queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
        queryClient.invalidateQueries({ queryKey: ['whiteboard-trash'] });
      });
    }, 12000);
  };

  const undoBoardDelete = async () => {
    if (boardDeleteTimerRef.current) clearTimeout(boardDeleteTimerRef.current);
    const pending = pendingBoardDelete;
    setPendingBoardDelete(null);
    if (!pending) return;
    try {
      await lensRun({ domain: 'whiteboard', action: 'board-restore', input: { id: pending.id } });
    } catch { /* nothing to restore */ }
    queryClient.invalidateQueries({ queryKey: ['whiteboard-trash'] });
    queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
    setSelectedWbId(pending.id);
  };


  /* resize — the canvas container mounts only once a board is open, so observe
     it whenever it (re)mounts instead of measuring once at first render. */
  const canvasVisible = !!selectedWbId && boardMode === 'canvas';
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setDimensions({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasVisible]);

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

  /* ---------- S6: real images for reference pins ---------- */
  // Cache + async-load aware accessor: the draw effect re-runs when
  // setImageTick bumps after an image finishes loading.
  const loadImage = (url: string): HTMLImageElement => {
    const cache = imageCacheRef.current;
    let img = cache.get(url);
    if (!img) {
      img = new Image();
      img.src = url;
      img.onload = () => setImageTick((n) => n + 1);
      cache.set(url, img);
    }
    return img;
  };

  // Embed a picked/dropped file into the board itself (downscaled
  // to <=1024px JPEG) so the image persists with the scene — no
  // external hosting, no dead link later.
  const fileToEmbeddedImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cctx = c.getContext('2d');
      URL.revokeObjectURL(url);
      if (!cctx) { reject(new Error('Could not process that image.')); return; }
      cctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file could not be read as an image.')); };
    img.src = url;
  });

  const handleImageFile = async (file: File | null | undefined) => {
    if (!file) return;
    setDialogError(null);
    try {
      const data = await fileToEmbeddedImage(file);
      setImageData(data);
      setImageName(file.name);
      if (!imageLabel.trim()) setImageLabel(file.name.replace(/\.[^.]+$/, ''));
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'That file could not be read as an image.');
    }
  };

  const handleCanvasDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const data = await fileToEmbeddedImage(file);
      const pos = getCanvasCoords(e as unknown as React.MouseEvent);
      pushUndo();
      setElements((prev) => [...prev, {
        id: uid(), type: 'image', x: pos.x - 80, y: pos.y - 60,
        imageLabel: file.name.replace(/\.[^.]+$/, ''), imageUrl: data, stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.08)',
        strokeWidth: 2, width: 200, height: 150,
      }]);
    } catch { /* unreadable file — the dialog path reports errors properly */ }
  };

  /* ---------- S5 geometry helpers ---------- */
  const elementBBox = (el: Element) => {
    if (el.type === 'freehand' && el.points && el.points.length > 0) {
      const xs = el.points.map((p) => p.x);
      const ys = el.points.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return { x: el.x, y: el.y, width: el.width || 100, height: el.height || 50 };
  };

  // Hit test honouring rotation: un-rotate the point around the centre.
  const pointInElement = (el: Element, x: number, y: number) => {
    const b = elementBBox(el);
    let px = x;
    let py = y;
    if (el.rotation) {
      const cx = b.x + b.width / 2;
      const cy = b.y + b.height / 2;
      const rad = -(el.rotation * Math.PI) / 180;
      const dx = x - cx;
      const dy = y - cy;
      px = cx + dx * Math.cos(rad) - dy * Math.sin(rad);
      py = cy + dx * Math.sin(rad) + dy * Math.cos(rad);
    }
    if (el.type === 'freehand' && el.points) {
      return el.points.some((p) => Math.abs(p.x - px) < 10 && Math.abs(p.y - py) < 10);
    }
    return px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height;
  };

  const resizeCornerAt = (el: Element, x: number, y: number): string | null => {
    if (el.type === 'freehand') return null;
    const b = elementBBox(el);
    const tol = 10 / zoom;
    const corners: Record<string, { cx: number; cy: number }> = {
      nw: { cx: b.x, cy: b.y }, ne: { cx: b.x + b.width, cy: b.y },
      sw: { cx: b.x, cy: b.y + b.height }, se: { cx: b.x + b.width, cy: b.y + b.height },
    };
    for (const [name, c] of Object.entries(corners)) {
      if (Math.abs(x - c.cx) <= tol && Math.abs(y - c.cy) <= tol) return name;
    }
    return null;
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
      // S5: a resize handle on the single selection takes the click first.
      if (selectedElement && selectedIds.length <= 1) {
        const corner = resizeCornerAt(selectedElement, x, y);
        if (corner) {
          resizeRef.current = { id: selectedElement.id, corner, startX: x, startY: y, orig: elementBBox(selectedElement) };
          setIsDrawing(true);
          return;
        }
      }
      const clicked = [...elements].reverse().find((el) => pointInElement(el, x, y));
      if (clicked && e.shiftKey) {
        setSelectedIds((prev) => (prev.includes(clicked.id) ? prev.filter((id) => id !== clicked.id) : [...prev, clicked.id]));
        setSelectedElement(clicked);
        return;
      }
      if (clicked) {
        const group = selectedIds.includes(clicked.id) && selectedIds.length > 1 ? selectedIds : [clicked.id];
        setSelectedIds(group);
        setSelectedElement(clicked);
        setIsDrawing(true);
        if (group.length > 1) {
          const origins = new Map<string, { x: number; y: number }>();
          elements.forEach((el) => { if (group.includes(el.id)) origins.set(el.id, { x: el.x, y: el.y }); });
          groupDragRef.current = { startX: x, startY: y, origins };
        } else {
          setCurrentElement({ ...clicked, x: x - clicked.x, y: y - clicked.y } as unknown as Element);
        }
        return;
      }
      // Empty canvas: clear the selection and start a marquee.
      setSelectedElement(null);
      setSelectedIds([]);
      setIsDrawing(true);
      setMarquee({ x0: x, y0: y, x1: x, y1: y });
      return;
    }

    if (tool === 'text') { setTextInput(''); setTextPosition({ x, y }); return; }
    if (tool === 'dtu') { setShowDtuPicker(true); setTextPosition({ x, y }); return; }
    if (tool === 'audio') { setAudioClipName(''); setAudioClipDur(30); setDialogError(null); setShowAudioDialog(true); setTextPosition({ x, y }); return; }
    if (tool === 'image') { setImageLabel(''); setImageUrlInput(''); setImageData(''); setImageName(''); setDialogError(null); setShowImageDialog(true); setTextPosition({ x, y }); return; }
    if (tool === 'notecard') { setNoteText(''); setDialogError(null); setShowNoteDialog(true); setTextPosition({ x, y }); return; }
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
    drawingRef.current = newEl;
    setCurrentElement(newEl);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
      return;
    }
    const { x, y } = getCanvasCoords(e);

    if (tool === 'select' && marquee) {
      setMarquee((m) => (m ? { ...m, x1: x, y1: y } : m));
      return;
    }

    if (tool === 'select' && resizeRef.current) {
      const rz = resizeRef.current;
      const dx = x - rz.startX;
      const dy = y - rz.startY;
      const o = rz.orig;
      let nx = o.x;
      let ny = o.y;
      let nw = o.width;
      let nh = o.height;
      if (rz.corner.includes('e')) nw = o.width + dx;
      if (rz.corner.includes('s')) nh = o.height + dy;
      if (rz.corner.includes('w')) { nw = o.width - dx; nx = o.x + dx; }
      if (rz.corner.includes('n')) { nh = o.height - dy; ny = o.y + dy; }
      if (nw < 20) { nw = 20; if (rz.corner.includes('w')) nx = o.x + o.width - 20; }
      if (nh < 14) { nh = 14; if (rz.corner.includes('n')) ny = o.y + o.height - 14; }
      setElements((prev) => prev.map((el) => (el.id === rz.id ? { ...el, x: nx, y: ny, width: nw, height: nh } : el)));
      return;
    }

    if (tool === 'select' && groupDragRef.current) {
      const gd = groupDragRef.current;
      let dx = x - gd.startX;
      let dy = y - gd.startY;
      if (showGrid) { dx = Math.round(dx / 20) * 20; dy = Math.round(dy / 20) * 20; }
      setElements((prev) => prev.map((el) => {
        const origin = gd.origins.get(el.id);
        return origin ? { ...el, x: origin.x + dx, y: origin.y + dy } : el;
      }));
      return;
    }

    const cur = drawingRef.current ?? currentElement;
    if (!isDrawing || !cur) return;

    if (tool === 'select' && selectedElement) {
      const snap = (v: number) => (showGrid ? Math.round(v / 20) * 20 : v);
      setElements(prev => prev.map(el =>
        el.id === selectedElement.id
          ? { ...el, x: snap(x - (currentElement as unknown as Record<string, number>).x), y: snap(y - (currentElement as unknown as Record<string, number>).y) }
          : el
      ));
      return;
    }

    const next = cur.type === 'freehand' && cur.points
      ? { ...cur, points: [...cur.points, { x, y }] }
      : { ...cur, width: x - cur.x, height: y - cur.y };
    drawingRef.current = next;
    setCurrentElement(next);
  };

  const handleMouseUp = () => {
    setIsPanning(false);
    if (marquee) {
      const m = marquee;
      setMarquee(null);
      setIsDrawing(false);
      const x0 = Math.min(m.x0, m.x1);
      const x1 = Math.max(m.x0, m.x1);
      const y0 = Math.min(m.y0, m.y1);
      const y1 = Math.max(m.y0, m.y1);
      if (x1 - x0 > 4 || y1 - y0 > 4) {
        const hits = elements.filter((el) => {
          const b = elementBBox(el);
          return b.x < x1 && b.x + b.width > x0 && b.y < y1 && b.y + b.height > y0;
        }).map((el) => el.id);
        setSelectedIds(hits);
        setSelectedElement(elements.find((el) => el.id === hits[hits.length - 1]) || null);
      }
      return;
    }
    if (resizeRef.current) {
      resizeRef.current = null;
      setIsDrawing(false);
      pushUndo();
      return;
    }
    if (groupDragRef.current) groupDragRef.current = null;
    if (!isDrawing) return;
    setIsDrawing(false);
    const done = drawingRef.current ?? currentElement;
    drawingRef.current = null;
    if (tool === 'select') { pushUndo(); return; }
    if (done && (
      (done.width && Math.abs(done.width) > 5) ||
      (done.height && Math.abs(done.height) > 5) ||
      (done.points && done.points.length > 2)
    )) {
      const n = { ...done };
      if (n.width && n.width < 0) { n.x += n.width; n.width = Math.abs(n.width); }
      if (n.height && n.height < 0) { n.y += n.height; n.height = Math.abs(n.height); }
      setElements(prev => [...prev, n]);
      setSettle({ id: n.id, t0: performance.now() });
      // E-WB-1 The Long Line: a freehand stroke spanning the visible
      // canvas edge-to-edge typesets its really-measured length.
      if (n.type === 'freehand' && n.points && n.points.length > 2) {
        let len = 0;
        let minX = Infinity;
        let maxX = -Infinity;
        for (let i = 0; i < n.points.length; i++) {
          const pt = n.points[i];
          if (pt.x < minX) minX = pt.x;
          if (pt.x > maxX) maxX = pt.x;
          if (i > 0) {
            const prev = n.points[i - 1];
            len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
          }
        }
        const visibleW = dimensions.width / zoom;
        if (maxX - minX >= 0.9 * visibleW) {
          const last = n.points[n.points.length - 1];
          setEggLine({
            text: Math.round(len).toLocaleString('en-US') + ' px of line. Committed.',
            x: last.x * zoom + offset.x,
            y: last.y * zoom + offset.y,
          });
        }
      }
    }
    setCurrentElement(null);
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);
    const clicked = [...elements].reverse().find((el) => pointInElement(el, x, y));
    if (clicked?.type === 'dtu' && clicked.dtuId) {
      setViewingDtuId(clicked.dtuId);
      return;
    }
    // S4: text-bearing elements edit in place — double-click opens an
    // editor over the element instead of sending the user to a dialog.
    if (clicked && (clicked.type === 'text' || clicked.type === 'notecard')) {
      setSelectedElement(clicked);
      setEditingElement({ id: clicked.id, draft: clicked.text || '' });
    }
  };

  const commitInlineEdit = () => {
    if (!editingElement) return;
    const { id, draft } = editingElement;
    setEditingElement(null);
    const target = elements.find((el) => el.id === id);
    // An emptied draft is a cancel, never a silent erase.
    if (!target || !draft.trim() || draft === (target.text || '')) return;
    pushUndo();
    setElements((prev) => prev.map((el) => (el.id === id
      ? { ...el, text: draft, width: el.type === 'text' ? Math.max(60, draft.length * 12) : el.width }
      : el)));
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const d = e.deltaY > 0 ? 1 / 1.1 : 1.1;
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
    setTextInput(''); setTextPosition(null); setTool('select');
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
    setShowDtuPicker(false); setTextPosition(null); setTool('select');
  };

  const addAudioPin = () => {
    if (!textPosition) return;
    if (!audioClipName.trim()) { setDialogError('Give the clip a name first.'); return; }
    if (!Number.isFinite(audioClipDur) || audioClipDur < 1 || audioClipDur > 3600) { setDialogError('Duration needs to be between 1 and 3600 seconds.'); return; }
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'audio', x: textPosition.x, y: textPosition.y,
      clipName: audioClipName, duration: Math.round(audioClipDur), playing: false,
      stroke: '#00d4ff', fill: 'rgba(0, 212, 255, 0.08)', strokeWidth: 2, width: 220, height: 72,
    }]);
    setAudioClipName(''); setAudioClipDur(30); setDialogError(null); setShowAudioDialog(false); setTextPosition(null); setTool('select');
  };

  const addImagePin = () => {
    const url = imageData || imageUrlInput.trim();
    if (!textPosition) return;
    if (!url && !imageLabel.trim()) { setDialogError('Add an image (upload or link) or at least a label first.'); return; }
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'image', x: textPosition.x, y: textPosition.y,
      imageLabel: imageLabel.trim() || imageName.replace(/\.[^.]+$/, '') || 'Image', imageUrl: url, stroke: '#f59e0b', fill: 'rgba(245, 158, 11, 0.08)',
      strokeWidth: 2, width: 200, height: 150,
    }]);
    setImageLabel(''); setImageUrlInput(''); setImageData(''); setImageName(''); setDialogError(null); setShowImageDialog(false); setTextPosition(null); setTool('select');
  };

  const addNoteCard = () => {
    if (!textPosition) return;
    if (!noteText.trim()) { setDialogError('Write the note first.'); return; }
    pushUndo();
    setElements(prev => [...prev, {
      id: uid(), type: 'notecard', x: textPosition.x, y: textPosition.y,
      text: noteText, cardColor: noteColor, stroke: noteColor, fill: noteColor + '22',
      strokeWidth: 2, width: 180, height: 100,
    }]);
    setNoteText(''); setDialogError(null); setShowNoteDialog(false); setTextPosition(null); setTool('select');
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
    setShowSectionDialog(false); setTextPosition(null); setTool('select');
  };

  const toggleAudioPlay = (id: string) => {
    setElements(prev => prev.map(el => el.id === id ? { ...el, playing: !el.playing } : el));
  };

  const deleteSelected = useCallback(() => {
    if (!selectedElement) return;
    pushUndo();
    if (selectedIds.length > 1) {
      setElements(prev => prev.filter(el => !selectedIds.includes(el.id)));
      setSelectedIds([]);
    } else {
      setElements(prev => prev.filter(el => el.id !== selectedElement.id));
    }
    setSelectedElement(null);
  }, [selectedElement, selectedIds, pushUndo]);

  const reorderSelected = (dir: 1 | -1) => {
    if (!selectedElement) return;
    pushUndo();
    setElements(prev => {
      const i = prev.findIndex(el => el.id === selectedElement.id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[i];
      next[i] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const rotateSelected = () => {
    if (!selectedElement) return;
    pushUndo();
    const turn = (el: Element) => ({ ...el, rotation: ((el.rotation || 0) + 15) % 360 });
    setElements(prev => prev.map(el => (el.id === selectedElement.id ? turn(el) : el)));
    setSelectedElement(prev => (prev ? turn(prev as Element) : prev));
  };

  // D4: a ceremony starts a new board whose main canvas carries named
  // section frames with the session's date. Present walks them.
  const CEREMONIES: Record<string, { label: string; frames: string[] }> = {
    retro: { label: 'Retro', frames: ['Went well', 'To improve', 'Actions'] },
    planning: { label: 'Planning', frames: ['Today', 'This week', 'Later', 'Risks'] },
    brainstorm: { label: 'Brainstorm', frames: ['Ideas', 'Wild cards', 'Questions'] },
  };
  const startCeremony = async (kind: string) => {
    const c = CEREMONIES[kind];
    if (!c || ceremonyBusy) return;
    setCeremonyBusy(true);
    try {
      const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      const res = await apiHelpers.whiteboard.create({ title: c.label + ' - ' + dateLabel, linkedDtus: [] });
      const id = (res.data as { dtuId?: string }).dtuId;
      if (!id) return;
      const frames: Element[] = c.frames.map((label, i) => {
        const preset = SECTION_PRESETS[i % SECTION_PRESETS.length];
        return {
          id: uid(), type: 'section', x: 60 + i * 400, y: 80,
          sectionType: preset.type, text: label, bars: 14,
          stroke: preset.color, fill: preset.color + '18', strokeWidth: 2,
          width: 336, height: 56,
        } as Element;
      });
      await apiHelpers.whiteboard.update(id, { elements: frames });
      queryClient.invalidateQueries({ queryKey: ['whiteboards'] });
      queryClient.invalidateQueries({ queryKey: ['lens', 'whiteboard'] });
      setSelectedWbId(id);
      setBoardMode('canvas');
    } catch (err) {
      console.error('Failed to start ceremony:', err instanceof Error ? err.message : err);
    } finally {
      setCeremonyBusy(false);
      setShowModeMenu(false);
    }
  };

  // D5: every export carries its provenance receipt.
  const exportReceipt = () => JSON.stringify({
    format: 'concord-whiteboard/receipt', board: selectedWbId,
    elements: elements.length, exportedAt: new Date().toISOString(),
  });

  const exportCanvas = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const res = await fetch(canvas.toDataURL('image/png'));
    const raw = new Uint8Array(await res.arrayBuffer());
    const stamped = wbPngWithReceipt(raw, exportReceipt());
    const url = URL.createObjectURL(new Blob([stamped.buffer as ArrayBuffer], { type: 'image/png' }));
    const link = document.createElement('a');
    link.download = `whiteboard-${new Date().toISOString().slice(0, 10)}.png`;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
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
    parts.push(`<metadata>${esc(exportReceipt())}</metadata>`);
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
    // S16: a copy the user can't verify is a dead end — confirm it
    // (and report failure instead of swallowing it).
    if (copyNoteTimerRef.current) clearTimeout(copyNoteTimerRef.current);
    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
      setCopyNote({ text: 'Copied — board JSON is on your clipboard.', ok: true });
    } catch {
      setCopyNote({ text: 'Copy failed — the browser blocked clipboard access.', ok: false });
    }
    copyNoteTimerRef.current = setTimeout(() => setCopyNote(null), 2600);
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

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

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
      const inGroup = selectedIds.length > 1 && selectedIds.includes(el.id);
      if (isSel && !preview) { ctx.shadowColor = el.stroke; ctx.shadowBlur = 10; }

      ctx.save();
      if (el.rotation) {
        const bb = elementBBox(el);
        const cx = bb.x + bb.width / 2;
        const cy = bb.y + bb.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }

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
          const img = el.imageUrl ? loadImage(el.imageUrl) : null;
          if (img && img.complete && img.naturalWidth > 0) {
            // S6: draw the real image, cover-fit inside the frame,
            // with a label strip along the bottom.
            ctx.save();
            ctx.beginPath(); ctx.roundRect(el.x, el.y, w, h, 10); ctx.clip();
            const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
            const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
            ctx.drawImage(img, el.x + (w - dw) / 2, el.y + (h - dh) / 2, dw, dh);
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(el.x, el.y + h - 22, w, 22);
            ctx.fillStyle = '#ffffff'; ctx.font = '11px Inter, sans-serif';
            ctx.fillText(el.imageLabel || 'Image', el.x + 8, el.y + h - 7);
            ctx.restore();
          } else {
            /* placeholder icon area (no image yet, or still loading) */
            ctx.fillStyle = 'rgba(245,158,11,0.15)';
            ctx.fillRect(el.x + 12, el.y + 12, w - 24, h - 44);
            ctx.fillStyle = '#f59e0b'; ctx.font = '24px sans-serif';
            ctx.fillText('\u{1F5BC}', el.x + w / 2 - 12, el.y + h / 2 - 10);
            ctx.fillStyle = '#ffffff'; ctx.font = '11px Inter, sans-serif';
            ctx.fillText(el.imageLabel || 'Image', el.x + 12, el.y + h - 12);
          }
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

      if ((isSel || inGroup) && !preview) {
        ctx.strokeStyle = '#00d4ff'; ctx.lineWidth = 1; ctx.setLineDash([5, 5]);
        const p = 8;
        ctx.strokeRect(el.x - p, el.y - p, (el.width || 100) + p * 2, (el.height || 50) + p * 2);
        ctx.setLineDash([]);
      }

      if (isSel && !preview && selectedIds.length <= 1 && el.type !== 'freehand') {
        const b = elementBBox(el);
        const hs = 5 / zoom + 3;
        ctx.fillStyle = '#00d4ff';
        [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].forEach(([hx, hy]) => {
          ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
        });
      }
      ctx.restore();
    };

    elements.forEach(el => {
      // D3 (M3 The Settle): a just-committed element lands with a
      // 140ms ease — a breath of overscale decaying to rest.
      if (settle && el.id === settle.id) {
        const p = Math.min(1, (performance.now() - settle.t0) / 140);
        const s = 1 + 0.05 * (1 - p) * (1 - p);
        const b = elementBBox(el);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(s, s);
        ctx.translate(-cx, -cy);
        drawEl(el);
        ctx.restore();
      } else {
        drawEl(el);
      }
    });
    if (currentElement && tool !== 'select') {
      ctx.globalAlpha = 0.7; drawEl(currentElement, true); ctx.globalAlpha = 1;
    }
    if (marquee) {
      const mx = Math.min(marquee.x0, marquee.x1);
      const my = Math.min(marquee.y0, marquee.y1);
      const mw = Math.abs(marquee.x1 - marquee.x0);
      const mh = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = 'rgba(0, 212, 255, 0.08)';
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.7)';
      ctx.lineWidth = 1 / zoom;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
    }
    ctx.restore();
  }, [elements, currentElement, selectedElement, selectedIds, marquee, dimensions, zoom, offset, showGrid, tool, boardMode, imageTick, settle]);

  /* ---------- duplicate selected ---------- */
  const duplicateSelected = useCallback(() => {
    // Multi-selection duplicates the whole group (Q57, #1883's pure helper); a lone selection is the
    // one-member case. Copies are offset +16,+16 and become the new selection.
    const ids = selectedIds.length > 0 ? selectedIds : (selectedElement ? [selectedElement.id] : []);
    if (ids.length === 0) return;
    const copies = duplicateSelection(elements as never, new Set(ids), uid) as unknown as Element[];
    if (copies.length === 0) return;
    pushUndo();
    setElements((prev) => [...prev, ...copies]);
    setSelectedIds(copies.map((c) => c.id));
    setSelectedElement(copies[copies.length - 1]);
  }, [selectedElement, selectedIds, elements, pushUndo]);

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
        if (e.key.toLowerCase() === 'a') {
          e.preventDefault();
          const all = [...selectAllIds(elements as never)];
          setSelectedIds(all);
          setSelectedElement(elements.find((el) => el.id === all[all.length - 1]) || null);
          return;
        }
        return;
      }

      if (e.key === 'Escape') { setSelectedIds([]); setSelectedElement(null); }
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
  }, [deleteSelected, undo, redo, duplicateSelected, elements]);

  /* ---------- tools array ---------- */
  const PRIMARY_TOOLS: Tool[] = ['select', 'draw', 'rectangle', 'ellipse', 'line', 'arrow', 'text', 'notecard'];
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
    { id: 'image', icon: ImageIcon, label: 'Reference Pin', key: '' },
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
    <div className="relative flex h-[calc(100vh-3rem)] min-h-[600px] overflow-hidden bg-[radial-gradient(ellipse_at_80%_10%,rgba(91,33,182,0.10),transparent_55%),radial-gradient(ellipse_at_15%_90%,rgba(20,184,166,0.07),transparent_50%)]" data-lens-theme="whiteboard">
      {/* Greeting + board switcher, over the canvas (north star 14) */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-10 flex items-start justify-between px-8 pt-4">
        <div className="pointer-events-auto">
          <h1 className="font-vault text-[2.75rem] leading-tight text-zinc-100">Whiteboard</h1>
        </div>
        <div className="pointer-events-auto relative flex items-center gap-4 pt-1 text-[13px]">
          {saveMutation.isPending && <span className="text-zinc-600">Saving…</span>}
          {copyNote && <span className={copyNote.ok ? 'text-teal-300' : 'text-rose-300'} role="status">{copyNote.text}</span>}
          <button type="button" onClick={() => setShowModeMenu((v) => !v)} className="text-zinc-500 transition-colors hover:text-zinc-200" aria-haspopup="menu" aria-expanded={showModeMenu}>
            {selectedWbId ? boardName(boardListItems.find((b) => b.id === selectedWbId)?.title ?? selectedWb?.whiteboard?.title) : 'Boards'}
            {boardMode !== 'canvas' && ` · ${MODE_LABELS[boardMode]}`} ▾
          </button>
          <AnimatePresence>
            {showModeMenu && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} role="menu"
                className="absolute right-0 top-full z-40 mt-2 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
                <p className="px-2.5 pb-1 pt-2 text-[11px] uppercase tracking-wider text-zinc-600">Boards</p>
                {boardListItems.length === 0 && <p className="px-2.5 py-1.5 text-[13px] text-zinc-500">No boards yet.</p>}
                {boardListItems.map((wb: Record<string, unknown>) => (
                  <button key={wb.id as string} type="button" role="menuitem" onClick={() => { setSelectedWbId(wb.id as string); setShowModeMenu(false); }}
                    className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.06] ${selectedWbId === wb.id ? 'text-zinc-50' : 'text-zinc-300'}`}>
                    <span className="flex-1 truncate">{boardName(wb.title)}</span>
                    <span className="text-[11px] tabular-nums text-zinc-600">{(wb.elementCount as number) || 0}</span>
                  </button>
                ))}
                <div className="my-1 border-t border-white/[0.06]" />
                <p className="px-2.5 pb-1 pt-1 text-[11px] uppercase tracking-wider text-zinc-600">View</p>
                {(Object.keys(MODE_LABELS) as BoardMode[]).map(m => (
                  <button key={m} type="button" role="menuitem" onClick={() => { setBoardMode(m); setShowModeMenu(false); }}
                    className={`flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.06] ${boardMode === m ? 'text-zinc-50' : 'text-zinc-300'}`}>
                    {MODE_LABELS[m]}
                  </button>
                ))}
                <div className="my-1 border-t border-white/[0.06]" />
                <button type="button" role="menuitem" onClick={() => { setShowModeMenu(false); onWorkbenchOpen(); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">Templates &amp; voting</button>
                <button type="button" role="menuitem" onClick={() => { setShowModeMenu(false); setShowInspector((v) => !v); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">{showInspector ? 'Hide' : 'Show'} analyze &amp; collab</button>
                <button type="button" role="menuitem" onClick={() => setShowGrid((g) => !g)} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">{showGrid ? 'Hide' : 'Show'} grid</button>
                <div className="my-1 border-t border-white/[0.06]" />
                <p className="px-2.5 pb-1 pt-1 text-[11px] uppercase tracking-wider text-zinc-600">Start a ceremony</p>
                {Object.entries(CEREMONIES).map(([kind, c]) => (
                  <button key={kind} type="button" role="menuitem" disabled={ceremonyBusy} onClick={() => { void startCeremony(kind); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] disabled:opacity-40">{c.label}</button>
                ))}
                {selectedWbId && (
                  <>
                    <div className="my-1 border-t border-white/[0.06]" />
                    <button type="button" role="menuitem" onClick={() => { setShowModeMenu(false); exportCanvas(); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06]">Export PNG</button>
                    <button type="button" role="menuitem" disabled={elements.length === 0} onClick={() => { setShowModeMenu(false); exportSVG(); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] disabled:opacity-40">Export SVG</button>
                    <button type="button" role="menuitem" disabled={elements.length === 0} onClick={() => { setShowModeMenu(false); exportClipboardJSON(); }} className="flex w-full rounded-md px-2.5 py-1.5 text-left text-[13px] text-zinc-300 hover:bg-white/[0.06] disabled:opacity-40">Copy JSON</button>
                    <BoardOwnerMenu
                      boardId={selectedWbId}
                      title={boardName(boardListItems.find((b) => b.id === selectedWbId)?.title ?? selectedWb?.whiteboard?.title)}
                      onRenamed={() => { queryClient.invalidateQueries({ queryKey: ['whiteboards'] }); queryClient.invalidateQueries({ queryKey: ['whiteboard', selectedWbId] }); queryClient.invalidateQueries({ queryKey: ['lens', 'whiteboard'] }); }}
                      onDeleted={() => { void handleBoardDeleted(); }}
                    />
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selectedWbId && boardMode === 'canvas' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-white/[0.06] px-4 py-1.5 text-[11px] text-zinc-400">
            <span className="text-[12px] font-medium text-zinc-200">{boardName(boardListItems.find((b) => String(b.id) === selectedWbId)?.title)}</span>
            <span className="tabular-nums">{elements.length} element{elements.length === 1 ? '' : 's'}</span>
            {stripInfo?.keptVersion ? (
              <span>Kept as DTU - v{stripInfo.keptVersion}{stripInfo.keptAt ? ' - ' + new Date(stripInfo.keptAt).toLocaleString() : ''}</span>
            ) : (
              <span>Not kept as a DTU yet</span>
            )}
            <span>{lastSavedAt ? 'Saved ' + new Date(lastSavedAt).toLocaleTimeString() : 'Not saved yet this session'}</span>
            {elements.length >= 200 && (
              <span className="text-amber-300/90">Large board: {elements.length} elements. Rendering stays live; the count is here so growth is visible, not a surprise.</span>
            )}
            {sectionFrames.length > 0 && (
              <span className="ml-auto flex items-center gap-1">
                {presentIdx === null ? (
                  <button type="button" onClick={() => setPresentIdx(0)} className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/[0.06]">Present</button>
                ) : (
                  <>
                    <button type="button" disabled={presentIdx <= 0} onClick={() => setPresentIdx((v) => (v === null ? v : v - 1))} className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/[0.06] disabled:opacity-40">Prev</button>
                    <span className="tabular-nums">Frame {presentIdx + 1} of {sectionFrames.length}</span>
                    <button type="button" disabled={presentIdx >= sectionFrames.length - 1} onClick={() => setPresentIdx((v) => (v === null ? v : v + 1))} className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/[0.06] disabled:opacity-40">Next</button>
                    <button type="button" onClick={() => setPresentIdx(null)} className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/[0.06]">Exit</button>
                  </>
                )}
              </span>
            )}
          </div>
        )}
        {selectedWbId ? (
          <>
            {boardMode === 'canvas' && (
              <div ref={containerRef} className={'flex-1 relative overflow-hidden transition-[box-shadow] duration-200 ' + (saveFlash ? 'ring-2 ring-inset ring-teal-400/70' : '')}>
                <canvas ref={canvasRef} className={`h-full w-full ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
                  style={{ width: dimensions.width, height: dimensions.height }}
                  onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp} onWheel={handleWheel} onDoubleClick={handleDoubleClick}
                  onDragOver={e => e.preventDefault()} onDrop={handleCanvasDrop} />

                {selectedIds.length > 1 && (
                  <div className="absolute bottom-4 left-4 z-10 rounded-full border border-white/10 bg-[#121212]/90 px-2.5 py-1 text-[11px] tabular-nums text-zinc-200">{selectedIds.length} selected</div>
                )}
                {eggLine && (
                  <div className="pointer-events-none absolute z-20 font-serif text-[15px] italic text-zinc-100 transition-opacity duration-700 motion-reduce:transition-none" style={{ left: eggLine.x + 10, top: eggLine.y - 28 }}>{eggLine.text}</div>
                )}

                {/* Floating tool rail */}
                <div className="absolute left-6 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-white/[0.08] bg-[#121212]/90 p-1.5 backdrop-blur">
                  {tools.filter((t) => PRIMARY_TOOLS.includes(t.id)).map(t => (
                    <button key={t.id} type="button" onClick={() => setTool(t.id)} title={`${t.label}${t.key ? ` (${t.key})` : ''}`} aria-label={t.label} aria-pressed={tool === t.id}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${tool === t.id ? 'bg-teal-400/15 text-teal-300' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'}`}>
                      <t.icon className="h-4 w-4" />
                    </button>
                  ))}
                  <div className="relative">
                    <button type="button" onClick={() => setMoreTools((v) => !v)} title="More tools" aria-label="More tools" aria-expanded={moreTools}
                      className={`flex h-9 w-9 items-center justify-center rounded-xl transition-colors ${!PRIMARY_TOOLS.includes(tool) ? 'bg-teal-400/15 text-teal-300' : 'text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100'}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                    {moreTools && (
                      <div className="absolute left-full top-0 ml-2 w-44 rounded-xl border border-white/10 bg-[#141414] p-1 shadow-2xl">
                        {tools.filter((t) => !PRIMARY_TOOLS.includes(t.id)).map(t => (
                          <button key={t.id} type="button" onClick={() => { setTool(t.id); setMoreTools(false); }}
                            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-white/[0.06] ${tool === t.id ? 'text-teal-300' : 'text-zinc-300'}`}>
                            <t.icon className="h-4 w-4" />{t.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="my-1 h-px w-6 bg-white/[0.08]" />
                  <button type="button" onClick={() => setShowColorPicker(!showColorPicker)} title="Color" aria-label="Color"
                    className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/[0.06]">
                    <span className="h-4 w-4 rounded-full border border-white/20" style={{ backgroundColor: strokeColor }} />
                  </button>
                  <button type="button" onClick={undo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo" className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
                  <button type="button" onClick={redo} disabled={redoStack.length === 0} title="Redo (Ctrl+Y)" aria-label="Redo" className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100 disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
                  {selectedElement && (
                    <button type="button" onClick={deleteSelected} title="Delete selected" aria-label="Delete selected" className="flex h-9 w-9 items-center justify-center rounded-xl text-rose-300 hover:bg-white/[0.06]"><Trash2 className="h-4 w-4" /></button>
                  )}
                  {selectedElement && (
                    <button type="button" onClick={() => reorderSelected(1)} title="Bring forward" aria-label="Bring forward" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/[0.06] text-zinc-300">
                      <ChevronUp className="w-4 h-4" />
                    </button>
                  )}
                  {selectedElement && (
                    <button type="button" onClick={() => reorderSelected(-1)} title="Send backward" aria-label="Send backward" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/[0.06] text-zinc-300">
                      <ChevronDown className="w-4 h-4" />
                    </button>
                  )}
                  {selectedElement && (
                    <button type="button" onClick={rotateSelected} title="Rotate 15 degrees" aria-label="Rotate 15 degrees" className="flex h-9 w-9 items-center justify-center rounded-xl hover:bg-white/[0.06] text-zinc-300">
                      <RotateCw className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Zoom */}
                <div className="absolute bottom-6 left-6 z-10 flex items-center gap-1 rounded-full border border-white/[0.08] bg-[#121212]/90 px-1.5 py-1 text-[12px] text-zinc-400 backdrop-blur">
                  <button type="button" onClick={() => setZoom(z => clamp(z / 1.2, 0.25, 4))} className="rounded-full p-1 hover:bg-white/[0.06] hover:text-zinc-100" aria-label="Zoom out"><ZoomOut className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }); }} className="w-11 text-center tabular-nums hover:text-zinc-100" title="Reset view">{Math.round(zoom * 100)}%</button>
                  <button type="button" onClick={() => setZoom(z => clamp(z * 1.2, 0.25, 4))} className="rounded-full p-1 hover:bg-white/[0.06] hover:text-zinc-100" aria-label="Zoom in"><ZoomIn className="h-3.5 w-3.5" /></button>
                </div>

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
                      className="absolute left-20 top-1/2 z-20 -translate-y-1/2 rounded-xl border border-white/10 bg-[#141414] p-4 shadow-2xl">
                      <p className="mb-2 text-xs text-zinc-500">Width</p>
                      <div className="mb-4 flex items-center gap-1">
                        {STROKE_WIDTHS.map(w => (
                          <button key={w} type="button" onClick={() => setStrokeWidth(w)} aria-label={`Stroke width ${w}`} aria-pressed={strokeWidth === w}
                            className={`flex h-8 w-8 items-center justify-center rounded ${strokeWidth === w ? 'bg-white/10' : 'hover:bg-white/[0.06]'}`}>
                            <div className="rounded-full bg-zinc-200" style={{ width: w * 2, height: w * 2 }} />
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">Stroke</p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2 mb-4">
                        {COLORS.map(c => (
                          <button key={c} type="button" onClick={() => setStrokeColor(c)}
                            className={`w-8 h-8 rounded-lg border-2 ${strokeColor === c ? 'border-white' : 'border-transparent'}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <p className="text-xs text-gray-400 mb-2">Fill</p>
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
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

                {editingElement && (() => {
                  const el = elements.find((e) => e.id === editingElement.id);
                  if (!el) return null;
                  return (
                    <textarea
                      autoFocus
                      aria-label="Edit element text"
                      value={editingElement.draft}
                      onChange={(e) => setEditingElement({ id: el.id, draft: e.target.value })}
                      onBlur={commitInlineEdit}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') setEditingElement(null);
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitInlineEdit();
                      }}
                      className="absolute z-30 resize-none rounded-lg border border-cyan-400/60 bg-zinc-900/95 p-2 text-[13px] leading-snug text-zinc-100 shadow-2xl outline-none"
                      style={{
                        left: el.x * zoom + offset.x,
                        top: el.y * zoom + offset.y,
                        width: Math.max(150, (el.width || 180) * zoom),
                        minHeight: Math.max(44, (el.height || 60) * zoom),
                      }}
                    />
                  );
                })()}

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
                        <input type="number" value={audioClipDur} onChange={e => setAudioClipDur(+e.target.value)} min={1} max={3600}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-4" />
                        {dialogError && <p className="text-[11px] text-rose-300 mb-3" role="status">{dialogError}</p>}
                        <div className="flex gap-2">
                          <button type="button" onClick={addAudioPin} className="flex-1 py-2 bg-neon-cyan text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Pin</button>
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
                          <h3 className="font-semibold flex items-center gap-2"><ImageIcon className="w-4 h-4 text-amber-400" />Pin Reference</h3>
                          <button type="button" onClick={() => { setShowImageDialog(false); setTextPosition(null); }} aria-label="Close"><X className="w-5 h-5" /></button>
                        </div>
                        <input type="text" placeholder="Label (e.g. Album Cover Ref)" value={imageLabel}
                          onChange={e => setImageLabel(e.target.value)} autoFocus
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3" />
                        <label className="flex items-center justify-center gap-2 w-full px-3 py-2 mb-3 rounded border border-dashed border-amber-500/40 text-amber-300 text-sm cursor-pointer hover:bg-amber-500/10">
                          <ImageIcon className="w-4 h-4" />{imageName ? `Image: ${imageName}` : 'Upload an image'}
                          <input type="file" accept="image/*" className="hidden" onChange={e => { void handleImageFile(e.target.files?.[0]); e.target.value = ''; }} />
                        </label>
                        <input type="text" placeholder="…or paste an image link (https://…)" value={imageUrlInput}
                          onChange={e => setImageUrlInput(e.target.value)}
                          className="w-full px-3 py-2 bg-lattice-bg border border-lattice-border rounded text-sm mb-3" />
                        {(imageData || imageUrlInput.trim()) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageData || imageUrlInput.trim()} alt="Reference preview" className="w-full h-28 object-cover rounded border border-lattice-border mb-3" />
                        )}
                        {dialogError && <p className="text-[11px] text-rose-300 mb-3" role="status">{dialogError}</p>}
                        <p className="text-[11px] text-gray-500 mb-4">Uploaded images are embedded in the board (max 1024px) so they travel with it. You can also drop an image file straight onto the canvas.</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={addImagePin} className="flex-1 py-2 bg-amber-500 text-black rounded-lg text-sm font-medium">Place Pin</button>
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
                        {dialogError && <p className="text-[11px] text-rose-300 mb-3" role="status">{dialogError}</p>}
                        <div className="flex gap-2">
                          <button type="button" onClick={addNoteCard} className="flex-1 py-2 bg-yellow-500 text-black rounded-lg text-sm font-medium disabled:opacity-40">Place Card</button>
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
          <div className="flex flex-1 items-center justify-center">
            <p className="text-[14px] text-zinc-500">Start a board and sketch. Boards save as you draw.</p>
          </div>
        )}
      </div>

      {showInspector && <WhiteboardInspector boardId={selectedWbId ?? undefined} />}

      {pendingBoardDelete && (
        <div className="pointer-events-auto absolute bottom-8 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-white/10 bg-[#1c1c1c] px-3 py-2 shadow-2xl" role="status">
          <span className="text-[12px] text-zinc-300">Board “{pendingBoardDelete.title}” deleted.</span>
          <button type="button" onClick={() => { void undoBoardDelete(); }} className="text-[12px] font-medium text-teal-300 hover:text-teal-200">Undo</button>
        </div>
      )}

      {selectedWbId && boardMode === 'canvas' && (
        <div className="pointer-events-auto absolute bottom-8 left-1/2 z-20 -translate-x-1/2">
          <WhiteboardKeepMenu
            board={{
              id: selectedWbId,
              title: boardName(boardListItems.find((b) => b.id === selectedWbId)?.title ?? selectedWb?.whiteboard?.title),
              elements,
              createdAt: String(selectedWb?.whiteboard?.createdAt ?? ''),
              updatedAt: String(selectedWb?.whiteboard?.updatedAt ?? ''),
            }}
          />
        </div>
      )}

      <AnimatePresence>
        {showCreate && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#141414] p-6">
              <h2 className="mb-4 font-vault text-[1.6rem] text-zinc-100">New board</h2>
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
        onClick={() => setShowCreate(true)}
        className="fixed bottom-8 right-8 z-30 inline-flex items-center gap-2 rounded-full bg-teal-400 px-6 py-3.5 text-[15px] font-medium text-black shadow-[0_8px_32px_rgba(45,212,191,0.25)] transition-colors hover:bg-teal-300"
      >
        <Plus className="h-4 w-4" />
        New board
      </button>
      <WhiteboardWorkbench open={workbenchOpen} onClose={onWorkbenchClose} />
    </div>
  );
}

export default WhiteboardStudio;
