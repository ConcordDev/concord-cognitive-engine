'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Map, Bell, Menu, Settings, Package, Scroll, TrendingUp,
  Cloud, Sun, CloudRain, CloudSnow, Wind, Users, Coins,
  Award, Star, MessageSquare, ChevronUp, X,
} from 'lucide-react';

const panel = 'bg-black/80 backdrop-blur-sm border border-white/10 rounded-lg';

// ── Types ──────────────────────────────────────────────────────────

export type HUDMode = 'explore' | 'build' | 'inspect' | 'combat' | 'social' | 'driving' | 'spectator' | 'lens_work';

export type WeatherIcon = 'clear' | 'cloudy' | 'rain' | 'snow' | 'wind';

export interface CurrencyInfo {
  concordCoin: number;
  pendingRoyalties: number;
}

export interface ToolSlot {
  id: string;
  name: string;
  icon: string;
  keybind: number; // 1-8
  active: boolean;
}

export interface HUDNotification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: number;
}

export type MenuItem = 'settings' | 'inventory' | 'quests' | 'progression' | 'map';

interface HUDOverlayProps {
  mode: HUDMode;
  district: string;
  timeOfDay: string;
  weather: WeatherIcon;
  playerCount: number;
  currency: CurrencyInfo;
  professionBadge: string;
  reputationLevel: number;
  notifications: HUDNotification[];
  unreadCount: number;
  tools: ToolSlot[];
  contextPrompt?: string;
  onToolSelect: (toolId: string) => void;
  onMenuOpen: (menu: MenuItem) => void;
  onChatToggle?: () => void;
  children?: React.ReactNode;
}

// ── Weather Icon Map ──────────────────────────────────────────────

function WeatherDisplay({ weather }: { weather: WeatherIcon }) {
  const iconMap: Record<WeatherIcon, React.ReactNode> = {
    clear: <Sun className="w-3.5 h-3.5 text-yellow-400" />,
    cloudy: <Cloud className="w-3.5 h-3.5 text-gray-400" />,
    rain: <CloudRain className="w-3.5 h-3.5 text-blue-400" />,
    snow: <CloudSnow className="w-3.5 h-3.5 text-blue-200" />,
    wind: <Wind className="w-3.5 h-3.5 text-gray-300" />,
  };
  return <>{iconMap[weather]}</>;
}

// ── Tool icon placeholder ─────────────────────────────────────────

function ToolIcon({ icon }: { icon: string }) {
  return (
    <span className="text-sm" role="img" aria-label={icon}>
      {icon}
    </span>
  );
}

// ── Notification Toast ────────────────────────────────────────────

function NotificationToast({
  notification,
  onDismiss,
}: {
  notification: HUDNotification;
  onDismiss: (id: string) => void;
}) {
  const colors: Record<string, string> = {
    info: 'border-cyan-500/40 text-cyan-300',
    success: 'border-green-500/40 text-green-300',
    warning: 'border-yellow-500/40 text-yellow-300',
    error: 'border-red-500/40 text-red-300',
  };

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(notification.id), 5000);
    return () => clearTimeout(timer);
  }, [notification.id, onDismiss]);

  return (
    <div
      className={`${panel} px-3 py-2 text-xs flex items-center gap-2 animate-slide-in-right border ${
        colors[notification.type] || colors.info
      }`}
    >
      <span className="flex-1">{notification.message}</span>
      <button
        onClick={() => onDismiss(notification.id)}
        className="text-gray-500 hover:text-white transition-colors"
      aria-label="Close">
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────

export default function HUDOverlay({
  mode,
  district,
  timeOfDay,
  weather,
  playerCount,
  currency,
  professionBadge,
  reputationLevel,
  notifications,
  unreadCount,
  tools,
  contextPrompt,
  onToolSelect,
  onMenuOpen,
  onChatToggle,
  children,
}: HUDOverlayProps) {
  const [visibleToasts, setVisibleToasts] = useState<HUDNotification[]>([]);
  const [showMenu, setShowMenu] = useState(false);

  // Show up to 3 toasts from the latest notifications
  useEffect(() => {
    if (notifications.length > 0) {
      setVisibleToasts((prev) => {
        const latest = notifications[notifications.length - 1];
        if (prev.find((t) => t.id === latest.id)) return prev;
        return [...prev, latest].slice(-3);
      });
    }
  }, [notifications]);

  const dismissToast = useCallback((id: string) => {
    setVisibleToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const menuItems: { key: MenuItem; label: string; icon: React.ReactNode }[] = [
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" /> },
    { key: 'inventory', label: 'Inventory', icon: <Package className="w-4 h-4" /> },
    { key: 'quests', label: 'Quests', icon: <Scroll className="w-4 h-4" /> },
    { key: 'progression', label: 'Progression', icon: <TrendingUp className="w-4 h-4" /> },
    { key: 'map', label: 'Map', icon: <Map className="w-4 h-4" /> },
  ];

  const modeLabels: Record<HUDMode, string> = {
    explore: 'Explore',
    build: 'Build',
    inspect: 'Inspect',
    combat: 'Combat',
    social: 'Social',
    driving: 'Driving',
    spectator: 'Spectator',
    lens_work: 'Lens Work',
  };

  return (
    <div className="relative w-full h-full">
      {/* Game viewport children */}
      {children}

      {/* ─── Top Bar ──────────────────────────────────────── */}
      <div className="absolute top-0 left-0 right-0 z-40">
        <div className={`${panel} mx-2 mt-2 px-4 py-2 flex items-center justify-between`}>
          {/* Left: district + mode */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-cyan-400">{district}</span>
            <span className="text-[10px] text-gray-600">|</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">
              {modeLabels[mode]}
            </span>
          </div>

          {/* Center: time + weather + players */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-300">{timeOfDay}</span>
            <WeatherDisplay weather={weather} />
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <Users className="w-3 h-3" />
              {playerCount}
            </span>
          </div>

          {/* Right: notification bell + menu */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => { window.dispatchEvent(new CustomEvent('hud:open-notifications')); }}
              aria-label="Notifications"
              className="relative p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
            >
              <Bell className="w-4 h-4 text-gray-400" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[9px] text-white flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {/* Chat toggle */}
            {onChatToggle && (
              <button
                onClick={onChatToggle}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
              aria-label="Message">
                <MessageSquare className="w-4 h-4 text-gray-400" />
              </button>
            )}

            {/* Menu button */}
            <div className="relative">
              <button
                onClick={() => setShowMenu((s) => !s)}
                className="p-1.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
              aria-label="Menu">
                <Menu className="w-4 h-4 text-gray-400" />
              </button>
              {showMenu && (
                <div className={`${panel} absolute top-full right-0 mt-1 w-44 p-1 z-50`}>
                  {menuItems.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        onMenuOpen(item.key);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Left Side: Quick Toolbar ─────────────────────── */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2 z-40">
        <div className={`${panel} p-1.5 flex flex-col gap-1`}>
          {tools.slice(0, 8).map((tool) => (
            <button
              key={tool.id}
              onClick={() => onToolSelect(tool.id)}
              className={`relative w-10 h-10 rounded flex items-center justify-center transition-colors ${
                tool.active
                  ? 'bg-cyan-500/20 border border-cyan-500/40'
                  : 'bg-white/5 hover:bg-white/10 border border-transparent'
              }`}
              title={tool.name}
            >
              <ToolIcon icon={tool.icon} />
              <span className="absolute top-0.5 right-0.5 text-[8px] text-gray-600">
                {tool.keybind}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ─── Right Side: Minimap placeholder + notifications ── */}
      <div className="absolute right-2 top-16 z-40 flex flex-col items-end gap-2">
        {/* Compact minimap placeholder */}
        <div className={`${panel} w-[140px] h-[140px] flex items-center justify-center`}>
          <Map className="w-6 h-6 text-gray-600" />
        </div>
      </div>

      {/* ─── Notification Toasts (right side) ─────────────── */}
      <div className="absolute right-2 top-[220px] z-50 flex flex-col gap-1.5 w-72">
        {visibleToasts.map((toast) => (
          <NotificationToast key={toast.id} notification={toast} onDismiss={dismissToast} />
        ))}
      </div>

      {/* ─── Center: Context Prompt ───────────────────────── */}
      {contextPrompt && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40">
          <div className={`${panel} px-4 py-2 text-xs text-gray-300 flex items-center gap-2`}>
            <ChevronUp className="w-3.5 h-3.5 text-cyan-400 animate-bounce" />
            {contextPrompt}
          </div>
        </div>
      )}

      {/* ─── Bottom Bar ───────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 z-40">
        <div className={`${panel} mx-2 mb-2 px-4 py-2 flex items-center justify-between`}>
          {/* Currency */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 text-xs">
              <Coins className="w-3.5 h-3.5 text-yellow-400" />
              <span className="text-yellow-300 font-medium">
                {currency.concordCoin.toLocaleString()}
              </span>
              <span className="text-[10px] text-gray-600">CC</span>
            </span>
            {currency.pendingRoyalties > 0 && (
              <span className="flex items-center gap-1 text-[10px] text-amber-400">
                +{currency.pendingRoyalties.toLocaleString()} pending
              </span>
            )}
          </div>

          {/* Profession + Reputation */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs">
              <Award className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-gray-300">{professionBadge}</span>
            </span>
            <span className="flex items-center gap-1 text-xs">
              <Star className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-amber-300">Lv.{reputationLevel}</span>
            </span>
          </div>

          {/* Keybind hints */}
          <div className="flex items-center gap-2 text-[10px] text-gray-600">
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-500">1</kbd>
            <span>-</span>
            <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-gray-500">8</kbd>
            <span className="text-gray-500 ml-1">Tools</span>
          </div>
        </div>
      </div>
    </div>
  );
}
