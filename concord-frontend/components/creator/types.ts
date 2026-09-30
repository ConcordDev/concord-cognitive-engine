export interface CreatorSummary {
  dtuCount: number;
  listingCount: number;
  totalDownloads: number;
  totalEarnings: number;
  citationsReceived: number;
  citationsMade: number;
  lineageDepth: number;
  reputationScore: number;
}

export interface DashboardResponse {
  ok: boolean;
  userId?: string;
  summary?: CreatorSummary;
  recentDTUs?: { id: string; title: string; domain: string; createdAt: string }[];
  recentListings?: { id: string; title: string; price: number; downloads: number; promotionSource: string | null }[];
  topCitedDTUs?: { id: string; title: string; domain: string; citationsReceived: number }[];
  error?: string;
}

export interface MyListing {
  id: string;
  title: string;
  description?: string;
  price: number;
  status: 'active' | 'withdrawn' | string;
  downloads: number;
  listedAt: string;
  tierPrices?: { usage?: number; remix?: number; commercial?: number };
  totalEarnings?: number;
  sourceDtuId?: string;
  contentType?: string | null;
  feaVerified?: boolean | null;
  feaSummary?: import('@/components/marketplace/ListingVerificationBadge').FeaSummary | null;
}

export interface PendingWithdrawal {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
}

export interface WithdrawalStatus {
  ok: boolean;
  balance: number;
  eligibleAmount: number;
  pendingHoldAmount: number;
  nextEligibleAt: string | null;
  pendingWithdrawals: PendingWithdrawal[];
  minWithdraw: number;
  holdHours: number;
  error?: string;
}

export interface DriftHit {
  userId: string;
  recentCitations: number;
  priorCitations: number;
  change: number;
}

export interface SocialProfile {
  userId: string;
  displayName: string;
  bio: string;
  avatar: string;
  isPublic: boolean;
  specialization: string[];
  website: string;
  stats: {
    dtuCount: number;
    publicDtuCount: number;
    citationCount: number;
    followerCount: number;
    followingCount: number;
  };
}

export interface FollowerRow {
  userId: string;
  displayName?: string;
}

export interface StudioDash {
  platforms: number;
  totalFollowers: number;
  ideas: number;
  inProgress: number;
  published: number;
  publishedThisMonth: number;
  revenueThisMonth: number;
}

export interface StudioGoal {
  hasGoal: boolean;
  metric?: string;
  target?: number;
  current?: number;
  pct?: number;
  met?: boolean;
}

export type CreatorView =
  | 'home'
  | 'pipeline'
  | 'listings'
  | 'scheduled'
  | 'calendar'
  | 'comments'
  | 'audience'
  | 'demographics'
  | 'performance'
  | 'trends'
  | 'followers'
  | 'revenue'
  | 'membership'
  | 'payouts'
  | 'cascade'
  | 'profile';
