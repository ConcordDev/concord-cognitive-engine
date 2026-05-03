'use client';

import React, { useCallback } from 'react';
import { InputMode } from '@/lib/concordia/modes';
import { useIsTouchDevice } from '@/hooks/useIsTouchDevice';
import { VirtualJoystick } from './VirtualJoystick';
import { SteeringWheel } from './SteeringWheel';

// ── Action button ────────────────────────────────────────────────────

interface ActionButtonProps {
  icon: string;
  label?: string;
  onTap?: () => void;
  onHold?: () => void;
  onRelease?: () => void;
  position: React.CSSProperties;
  size?: number;
  color?: string;
}

function ActionButton({ icon, label, onTap, onHold, onRelease, position, size = 56, color = 'rgba(255,255,255,0.15)' }: ActionButtonProps) {
  return (
    <button
      className="absolute rounded-full border border-white/20 flex flex-col items-center justify-center touch-none select-none active:scale-95 transition-transform"
      style={{ ...position, width: size, height: size, backgroundColor: color }}
      onTouchStart={() => onHold?.()}
      onTouchEnd={() => { onTap?.(); onRelease?.(); }}
    >
      <span className="text-xl">{icon}</span>
      {label && <span className="text-[9px] text-white/50 font-mono mt-0.5">{label}</span>}
    </button>
  );
}

// ── Adaptive quality ─────────────────────────────────────────────────

type DeviceTier = 'high' | 'medium' | 'low';

function detectDeviceTier(): DeviceTier {
  if (typeof window === 'undefined') return 'medium';
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores >= 8 && mem >= 6) return 'high';
  if (cores >= 4 && mem >= 3) return 'medium';
  return 'low';
}

export function adaptQualityToDevice(world: {
  setLOD: (q: string) => void;
  setNPCDensity: (d: number) => void;
  setShadowQuality: (q: string) => void;
}) {
  const tier = detectDeviceTier();
  switch (tier) {
    case 'high':
      world.setLOD('high');
      world.setNPCDensity(1.0);
      world.setShadowQuality('high');
      break;
    case 'medium':
      world.setLOD('medium');
      world.setNPCDensity(0.7);
      world.setShadowQuality('medium');
      break;
    case 'low':
      world.setLOD('low');
      world.setNPCDensity(0.4);
      world.setShadowQuality('off');
      break;
  }
}

// ── Overlay ──────────────────────────────────────────────────────────

interface MobileControlsOverlayProps {
  mode: InputMode;
  onMovement:  (x: number, y: number) => void;
  onCamera:    (x: number, y: number) => void;
  onJump:      () => void;
  onInteract:  () => void;
  onAttack:    () => void;
  onDodge:     () => void;
  onBlock:     (held: boolean) => void;
  onThrottle:  (v: number) => void;
  onBrake:     (v: number) => void;
  onSteer:     (v: number) => void;
  onExitVehicle: () => void;
  hotbarCount?: number;
  onHotbar:    (slot: number) => void;
}

export function MobileControlsOverlay(props: MobileControlsOverlayProps) {
  const isTouch = useIsTouchDevice();

  const { mode, onMovement, onCamera, onJump, onInteract, onAttack, onDodge, onBlock, onThrottle, onBrake, onSteer, onExitVehicle, onHotbar, hotbarCount = 4 } = props;

  // Hooks must be called unconditionally — early-return pattern moved below.
  const handleMove = useCallback((v: { x: number; y: number }) => onMovement(v.x, v.y), [onMovement]);
  const handleCam  = useCallback((v: { x: number; y: number }) => onCamera(v.x, v.y), [onCamera]);

  if (!isTouch) return null;

  if (mode === 'exploration') {
    return (
      <>
        <VirtualJoystick side="left" onMove={handleMove} />
        <VirtualJoystick side="right" onMove={handleCam} />
        <ActionButton icon="⬆" label="Jump"     position={{ bottom: 80, right: 90 }} onTap={onJump} />
        <ActionButton icon="⚙" label="Interact" position={{ bottom: 80, right: 20 }} onTap={onInteract} color="rgba(59,130,246,0.3)" />
      </>
    );
  }

  if (mode === 'combat') {
    return (
      <>
        <VirtualJoystick side="left" onMove={handleMove} />
        <VirtualJoystick side="right" onMove={handleCam} />
        <ActionButton icon="⚔" label="Attack"  position={{ bottom: 80, right: 20 }}  onTap={onAttack} size={64} color="rgba(239,68,68,0.3)" />
        <ActionButton icon="🌀" label="Dodge"   position={{ bottom: 150, right: 80 }} onTap={onDodge} />
        <ActionButton icon="🛡" label="Block"   position={{ bottom: 80, right: 100 }} onHold={() => onBlock(true)} onRelease={() => onBlock(false)} />
        {/* Compact hotbar */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1">
          {Array.from({ length: hotbarCount }, (_, i) => (
            <ActionButton
              key={i}
              icon={String(i + 1)}
              position={{ position: 'relative' as const }}
              onTap={() => onHotbar(i)}
              size={44}
            />
          ))}
        </div>
      </>
    );
  }

  if (mode === 'driving') {
    return (
      <>
        {/* Throttle: right-side vertical slider */}
        <div
          className="absolute right-4 top-1/3 bottom-24 flex flex-col items-center justify-center touch-none"
          style={{ width: 48 }}
          onTouchStart={() => onThrottle(1)}
          onTouchEnd={() => { onThrottle(0); onBrake(0); }}
        >
          <div className="w-2 flex-1 bg-white/10 rounded-full relative">
            <div className="absolute inset-0 bg-green-500/40 rounded-full" />
          </div>
          <span className="text-[10px] text-white/30 font-mono mt-1">GAS</span>
        </div>
        {/* Brake: left-side */}
        <div
          className="absolute left-4 top-1/3 bottom-24 flex flex-col items-center justify-center touch-none"
          style={{ width: 48 }}
          onTouchStart={() => onBrake(1)}
          onTouchEnd={() => onBrake(0)}
        >
          <div className="w-2 flex-1 bg-white/10 rounded-full relative">
            <div className="absolute inset-0 bg-red-500/40 rounded-full" />
          </div>
          <span className="text-[10px] text-white/30 font-mono mt-1">BRAKE</span>
        </div>
        <SteeringWheel onChange={onSteer} />
        <ActionButton icon="🚪" label="Exit" position={{ top: 12, right: 12 }} onTap={onExitVehicle} size={44} />
      </>
    );
  }

  // conversation, creation, lens_work, spectator: their own UIs handle touch
  return null;
}
