'use client';

import { ROOMS, type Room } from './rooms';

/** Three console keys: Write · Produce · Mix (keys 1 · 2 · 3). */
export function RoomSwitch({ room, onRoom }: { room: Room; onRoom: (r: Room) => void }) {
  return (
    <div role="tablist" aria-label="Studio rooms" className="flex items-center gap-1" data-testid="booth-rooms">
      {ROOMS.map((r) => (
        <button
          key={r.id}
          type="button"
          role="tab"
          aria-selected={room === r.id}
          onClick={() => onRoom(r.id)}
          title={`${r.who} (${r.key})`}
          className="bo-key flex h-8 items-center gap-1.5 rounded px-2.5 text-sm sm:px-3"
          data-testid={`booth-room-${r.id}`}
        >
          {r.label}
          <kbd className="hidden rounded bg-black/25 px-1 font-sans text-[9px] leading-4 opacity-70 sm:inline">{r.key}</kbd>
        </button>
      ))}
    </div>
  );
}
