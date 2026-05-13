'use client';

import { useState, useRef, useCallback, useEffect, ReactNode } from 'react';
import { motion } from 'framer-motion';
import { GripVertical, GripHorizontal, X, Maximize2, Minimize2, Columns, Rows } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SplitPaneProps {
  left: ReactNode;
  right: ReactNode;
  defaultSplit?: number; // percentage (0-100)
  minSize?: number; // minimum size in pixels
  direction?: 'horizontal' | 'vertical';
  className?: string;
  onSplitChange?: (split: number) => void;
  leftTitle?: string;
  rightTitle?: string;
  collapsible?: boolean;
}

export function SplitPane({
  left,
  right,
  defaultSplit = 50,
  minSize = 200,
  direction = 'horizontal',
  className,
  onSplitChange,
  leftTitle,
  rightTitle,
  collapsible = true
}: SplitPaneProps) {
  const [split, setSplit] = useState(defaultSplit);
  const [isDragging, setIsDragging] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const rect = containerRef.current.getBoundingClientRect();
      let newSplit: number;

      if (direction === 'horizontal') {
        newSplit = ((e.clientX - rect.left) / rect.width) * 100;
      } else {
        newSplit = ((e.clientY - rect.top) / rect.height) * 100;
      }

      // Clamp to minSize
      const containerSize = direction === 'horizontal' ? rect.width : rect.height;
      const minPercent = (minSize / containerSize) * 100;
      newSplit = Math.max(minPercent, Math.min(100 - minPercent, newSplit));

      setSplit(newSplit);
      onSplitChange?.(newSplit);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, direction, minSize, onSplitChange]);

  const getLeftSize = () => {
    if (leftCollapsed) return '0%';
    if (rightCollapsed) return '100%';
    return `${split}%`;
  };

  const getRightSize = () => {
    if (rightCollapsed) return '0%';
    if (leftCollapsed) return '100%';
    return `${100 - split}%`;
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex h-full w-full overflow-hidden',
        direction === 'horizontal' ? 'flex-row' : 'flex-col',
        className
      )}
    >
      {/* Left/Top Pane */}
      <motion.div
        animate={{
          [direction === 'horizontal' ? 'width' : 'height']: getLeftSize()
        }}
        transition={{ duration: leftCollapsed || rightCollapsed ? 0.2 : 0 }}
        className={cn(
          'relative overflow-hidden',
          leftCollapsed && 'hidden'
        )}
      >
        {leftTitle && (
          <PaneHeader
            title={leftTitle}
            onCollapse={collapsible ? () => setLeftCollapsed(true) : undefined}
            onMaximize={() => setRightCollapsed(!rightCollapsed)}
            isMaximized={rightCollapsed}
          />
        )}
        <div className={cn('h-full overflow-auto', leftTitle && 'pt-10')}>
          {left}
        </div>
      </motion.div>

      {/* Divider */}
      {!leftCollapsed && !rightCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'group flex items-center justify-center bg-lattice-border hover:bg-neon-cyan/30 transition-colors',
            direction === 'horizontal'
              ? 'w-1 cursor-col-resize'
              : 'h-1 cursor-row-resize',
            isDragging && 'bg-neon-cyan/50'
          )}
        >
          {direction === 'horizontal' ? (
            <GripVertical className="w-3 h-3 text-gray-500 group-hover:text-neon-cyan" />
          ) : (
            <GripHorizontal className="w-3 h-3 text-gray-500 group-hover:text-neon-cyan" />
          )}
        </div>
      )}

      {/* Right/Bottom Pane */}
      <motion.div
        animate={{
          [direction === 'horizontal' ? 'width' : 'height']: getRightSize()
        }}
        transition={{ duration: leftCollapsed || rightCollapsed ? 0.2 : 0 }}
        className={cn(
          'relative overflow-hidden',
          rightCollapsed && 'hidden'
        )}
      >
        {rightTitle && (
          <PaneHeader
            title={rightTitle}
            onCollapse={collapsible ? () => setRightCollapsed(true) : undefined}
            onMaximize={() => setLeftCollapsed(!leftCollapsed)}
            isMaximized={leftCollapsed}
          />
        )}
        <div className={cn('h-full overflow-auto', rightTitle && 'pt-10')}>
          {right}
        </div>
      </motion.div>

      {/* Collapsed indicators */}
      {leftCollapsed && (
        <button
          onClick={() => setLeftCollapsed(false)}
          className="absolute left-0 top-1/2 -translate-y-1/2 p-2 bg-lattice-surface border border-lattice-border rounded-r-lg hover:bg-lattice-border transition-colors"
        aria-label="Maximize">
          <Maximize2 className="w-4 h-4 text-gray-400" />
        </button>
      )}
      {rightCollapsed && (
        <button
          onClick={() => setRightCollapsed(false)}
          className="absolute right-0 top-1/2 -translate-y-1/2 p-2 bg-lattice-surface border border-lattice-border rounded-l-lg hover:bg-lattice-border transition-colors"
        aria-label="Maximize">
          <Maximize2 className="w-4 h-4 text-gray-400" />
        </button>
      )}
    </div>
  );
}

interface PaneHeaderProps {
  title: string;
  onClose?: () => void;
  onCollapse?: () => void;
  onMaximize?: () => void;
  isMaximized?: boolean;
}

function PaneHeader({ title, onClose, onCollapse, onMaximize, isMaximized }: PaneHeaderProps) {
  return (
    <div className="absolute top-0 left-0 right-0 h-10 flex items-center justify-between px-3 bg-lattice-surface border-b border-lattice-border z-10">
      <span className="text-sm font-medium text-gray-300 truncate">{title}</span>
      <div className="flex items-center gap-1">
        {onMaximize && (
          <button
            onClick={onMaximize}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="p-1 text-gray-400 hover:text-white transition-colors"
            title="Collapse"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-red-400 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// Multi-pane layout
interface MultiPaneLayoutProps {
  panes: {
    id: string;
    content: ReactNode;
    title?: string;
    defaultSize?: number;
    minSize?: number;
  }[];
  direction?: 'horizontal' | 'vertical';
  className?: string;
}

export function MultiPaneLayout({ panes, direction = 'horizontal', className }: MultiPaneLayoutProps) {
  const [sizes, _setSizes] = useState<number[]>(
    panes.map(p => p.defaultSize ?? 100 / panes.length)
  );

  if (panes.length === 0) return null;
  if (panes.length === 1) {
    return <div className={className}>{panes[0].content}</div>;
  }

  // Recursively build nested split panes
  const buildSplitPanes = (startIndex: number): ReactNode => {
    if (startIndex >= panes.length - 1) {
      return panes[startIndex]?.content;
    }

    return (
      <SplitPane
        left={panes[startIndex].content}
        right={buildSplitPanes(startIndex + 1)}
        leftTitle={panes[startIndex].title}
        rightTitle={startIndex === panes.length - 2 ? panes[startIndex + 1].title : undefined}
        defaultSplit={sizes[startIndex]}
        minSize={panes[startIndex].minSize}
        direction={direction}
      />
    );
  };

  return (
    <div className={cn('h-full w-full', className)}>
      {buildSplitPanes(0)}
    </div>
  );
}

// Tabs + Split view manager
interface WorkspacePane {
  id: string;
  type: string;
  title: string;
  content: ReactNode;
  closable?: boolean;
}

interface WorkspaceLayoutProps {
  panes: WorkspacePane[];
  onClosePane?: (id: string) => void;
  onSplitPane?: (id: string, direction: 'horizontal' | 'vertical') => void;
  className?: string;
}

export function WorkspaceLayout({ panes, onClosePane, onSplitPane, className }: WorkspaceLayoutProps) {
  const [activePaneId, setActivePaneId] = useState(panes[0]?.id);
  const [_layout, _setLayout] = useState<'single' | 'split-h' | 'split-v'>('single');

  const activePane = panes.find(p => p.id === activePaneId);

  if (panes.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-full text-gray-500', className)}>
        No panes open
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-lattice-surface border-b border-lattice-border overflow-x-auto">
        {panes.map(pane => (
          <button
            key={pane.id}
            onClick={() => setActivePaneId(pane.id)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-colors group',
              pane.id === activePaneId
                ? 'bg-lattice-bg text-white'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <span className="truncate max-w-[120px]">{pane.title}</span>
            {onSplitPane && pane.id === activePaneId && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSplitPane(pane.id, 'horizontal');
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-lattice-border rounded transition-all"
                  title="Split horizontally"
                >
                  <Columns className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSplitPane(pane.id, 'vertical');
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-lattice-border rounded transition-all"
                  title="Split vertically"
                >
                  <Rows className="w-3 h-3" />
                </button>
              </>
            )}
            {pane.closable !== false && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePane?.(pane.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-lattice-border rounded transition-all"
              aria-label="Close">
                <X className="w-3 h-3" />
              </button>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activePane?.content}
      </div>
    </div>
  );
}
