export interface PhotoItem {
  id: string;
  title: string;
  description: string;
  tags: string[];
  camera?: string;
  lens?: string;
  iso?: number;
  aperture?: string;
  shutter?: string;
  focalLength?: string;
  location?: string;
  mediaId?: string;
  likes: number;
  views: number;
  favorited?: boolean;
  createdAt: string;
}

export const PHOTO_CATEGORIES = [
  'Landscape', 'Portrait', 'Street', 'Architecture', 'Nature',
  'Macro', 'Astrophotography', 'Abstract', 'Documentary', 'Fashion',
] as const;

/** Masonry-style aspect ratios assigned deterministically by item index */
export const MASONRY_RATIOS = ['3/4', '4/3', '1/1', '3/4', '4/5', '16/9', '1/1', '4/3', '3/2', '4/5'] as const;

export type PhotoView =
  | 'catalog'
  | 'gallery'
  | 'capture'
  | 'upload'
  | 'collections'
  | 'editing'
  | 'stats'
  | 'stock'
  | 'tools';
