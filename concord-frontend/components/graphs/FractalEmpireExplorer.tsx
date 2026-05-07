'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface FractalNode {
  id: string;
  children?: FractalNode[];
  value?: number;
  depth?: number;
  type?: string;
}

interface FractalEmpireExplorerProps {
  data?: FractalNode[];
  zoom: number;
  onNodeSelect?: (id: string) => void;
  selectedNode?: string | null;
}

export function FractalEmpireExplorer({
  data = [],
  zoom,
  onNodeSelect,
  selectedNode,
}: FractalEmpireExplorerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  // Draw fractal visualization
  const drawFractal = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      node: FractalNode,
      x: number,
      y: number,
      size: number,
      depth: number
    ) => {
      if (size < 2 || depth > 6) return;

      const isSelected = node.id === selectedNode;
      const hue = (depth * 60) % 360;
      const saturation = 70 + depth * 5;
      const lightness = 50 - depth * 5;

      // Draw node
      ctx.beginPath();
      ctx.arc(x, y, size, 0, 2 * Math.PI);

      if (isSelected) {
        // Highlight selected node
        ctx.strokeStyle = '#00fff7';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.8)`;
      } else {
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${lightness}%, 0.6)`;
      }
      ctx.fill();

      // Draw children recursively
      if (node.children && node.children.length > 0) {
        const childCount = node.children.length;
        const angleStep = (2 * Math.PI) / childCount;
        const childSize = size * 0.5;
        const childDistance = size * 2;

        node.children.forEach((child, i) => {
          const angle = angleStep * i - Math.PI / 2;
          const childX = x + Math.cos(angle) * childDistance;
          const childY = y + Math.sin(angle) * childDistance;

          // Draw connection line
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(childX, childY);
          ctx.strokeStyle = `hsla(${hue}, 50%, 40%, 0.3)`;
          ctx.lineWidth = 1;
          ctx.stroke();

          // Recursively draw child
          drawFractal(ctx, child, childX, childY, childSize, depth + 1);
        });
      }
    },
    [selectedNode]
  );

  // Render canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size (2x for retina)
    canvas.width = dimensions.width * 2;
    canvas.height = dimensions.height * 2;
    ctx.scale(2, 2);

    // Clear canvas
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Apply transformations
    ctx.save();
    ctx.translate(dimensions.width / 2 + offset.x, dimensions.height / 2 + offset.y);
    ctx.scale(zoom, zoom);

    // Draw fractal tree from root nodes
    const rootSize = 30;
    const spacing = 200;

    if (data.length === 0) {
      // Draw placeholder fractal pattern
      const placeholderNode: FractalNode = {
        id: 'root',
        children: Array.from({ length: 5 }, (_, i) => ({
          id: `child-${i}`,
          children: Array.from({ length: 3 }, (_, j) => ({
            id: `grandchild-${i}-${j}`,
            children: Array.from({ length: 2 }, (_, k) => ({
              id: `great-${i}-${j}-${k}`,
            })),
          })),
        })),
      };
      drawFractal(ctx, placeholderNode, 0, 0, rootSize, 0);
    } else {
      data.forEach((node, i) => {
        const x = (i - (data.length - 1) / 2) * spacing;
        drawFractal(ctx, node, x, 0, rootSize, 0);
      });
    }

    ctx.restore();

    // Draw zoom indicator
    ctx.fillStyle = '#9ca3af';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`Zoom: ${(zoom * 100).toFixed(0)}%`, 10, dimensions.height - 10);
  }, [data, zoom, offset, dimensions, drawFractal]);

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setOffset({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (onNodeSelect && !isDragging) {
      // Simple click detection - would need hit testing for actual node selection
      // For now, just demonstrate the interaction
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - dimensions.width / 2 - offset.x) / zoom;
      const y = (e.clientY - rect.top - dimensions.height / 2 - offset.y) / zoom;

      // Hit-test against root nodes to find which was clicked
      const spacing = 200;
      const rootSize = 30;
      for (let i = 0; i < data.length; i++) {
        const nodeX = (i - (data.length - 1) / 2) * spacing;
        const nodeY = 0;
        const dist = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
        if (dist <= rootSize) {
          onNodeSelect(data[i].id);
          return;
        }
      }
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ width: '100%', height: '100%' }}
        className="cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />

      {/* Instructions */}
      <div className="absolute top-4 left-4 text-xs text-gray-500">
        Drag to pan • Use controls to zoom
      </div>
    </div>
  );
}
