'use client';

export interface HouseRow {
  id: string;
  user_id?: string;
  name: string | null;
  building_id: string;
  world_id?: string;
  visibility: 'private' | 'friends' | 'public';
  allow_live_visits: number;
  last_decorated_at: number;
}

export interface LandClaim {
  id: string;
  world_id: string;
  anchor_x: number;
  anchor_z: number;
  radius_m: number;
  status: string;
  owner_user_id: string;
}

export interface WorldBuilding {
  id: string;
  world_id: string;
  building_type?: string;
  name?: string;
  x: number;
  z: number;
  owner_type?: string;
  owner_id?: string;
  state?: string;
}

export interface FurnitureItem { itemId: string; x: number; y: number; z: number; rot: number; }
export interface RoomDetail {
  id: string;
  room_type: string;
  name: string;
  width: number; depth: number; height: number;
  floor: number;
  lock_tier: number;
  lock_state: string;
  furniture_layout: FurnitureItem[];
  furniture: string[];
}
export interface HouseDetail extends HouseRow {
  rooms: RoomDetail[];
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
