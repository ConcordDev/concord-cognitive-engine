'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { api } from '@/lib/api/client';
import { disconnectSocket } from '@/lib/realtime/socket';
import { User, LogOut, Settings, Shield, Zap, Users } from 'lucide-react';

const AvatarSwitcher = dynamic(() => import('@/components/concordia/AvatarSwitcher'), { ssr: false });

interface UserMenuProps {
  powerMode?: boolean;
  onTogglePowerMode?: () => void;
}

export function UserMenu({ powerMode, onTogglePowerMode }: UserMenuProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showAvatarSwitcher, setShowAvatarSwitcher] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleLogout = async () => {
    try {
      await api.post('/api/auth/logout', {});
    } catch {
      // Logout even if the API call fails
    }
    disconnectSocket();
    localStorage.removeItem('concord_entered');
    localStorage.removeItem('concord_api_key');
    window.location.href = '/login';
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-2 p-1.5 lg:p-2 rounded-lg hover:bg-lattice-elevated transition-colors"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="true"
      >
        <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-full bg-gradient-to-br from-neon-purple to-neon-blue flex items-center justify-center">
          <User className="w-3.5 h-3.5 lg:w-4 lg:h-4" />
        </div>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-48 bg-lattice-surface border border-lattice-border rounded-lg shadow-xl z-50 overflow-hidden"
          role="menu"
        >
          <button
            onClick={() => {
              setOpen(false);
              router.push('/lenses/resonance');
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-lattice-elevated transition-colors"
            role="menuitem"
          >
            <Shield className="w-4 h-4" />
            System Health
          </button>
          <button
            onClick={() => {
              setOpen(false);
              router.push('/lenses/admin');
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-lattice-elevated transition-colors"
            role="menuitem"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
          {onTogglePowerMode && (
            <button
              onClick={() => {
                onTogglePowerMode();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-lattice-elevated transition-colors"
              role="menuitem"
            >
              <Zap className={`w-4 h-4 ${powerMode ? 'text-neon-blue' : ''}`} />
              Power Mode
              <span
                className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                  powerMode
                    ? 'bg-neon-blue/20 text-neon-blue'
                    : 'bg-lattice-elevated text-gray-500'
                }`}
              >
                {powerMode ? 'ON' : 'OFF'}
              </span>
            </button>
          )}
          <div className="border-t border-lattice-border" />
          <button
            onClick={() => setShowAvatarSwitcher((v) => !v)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-300 hover:bg-lattice-elevated transition-colors"
            role="menuitem"
          >
            <Users className="w-4 h-4" />
            Avatars
          </button>
          {showAvatarSwitcher && (
            <div className="px-3 pb-3">
              <AvatarSwitcher />
            </div>
          )}
          <div className="border-t border-lattice-border" />
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
            role="menuitem"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
