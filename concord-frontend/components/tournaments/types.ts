// Shared types for the tournaments lens (Challonge / Battlefy parity).

export type TFormat =
  | 'single_elimination'
  | 'double_elimination'
  | 'round_robin'
  | 'swiss';

export type TStatus =
  | 'upcoming'
  | 'checkin'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface TEntrant {
  id: string;
  name: string;
  seed: number;
  rating: number;
  checkedIn: boolean;
  eliminated: boolean;
  roster: string[];
}

export interface TMatch {
  id: string;
  bracket: string;
  round: number;
  slotIndex: number;
  aId: string | null;
  bId: string | null;
  scoreA: number;
  scoreB: number;
  winnerId: string | null;
  status: 'pending' | 'complete' | 'bye';
}

export interface TStanding {
  rank: number;
  entrantId: string;
  name: string;
  wins: number;
  losses: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
}

export interface TPayout {
  rank: number;
  entrantId: string;
  name: string;
  amountCc: number;
}

export interface TLog {
  at: number;
  msg: string;
}

export interface Tournament {
  id: string;
  title: string;
  game: string;
  format: TFormat;
  mode: 'solo' | 'team';
  teamSize: number;
  status: TStatus;
  maxEntrants: number;
  prizePoolCc: number;
  payoutSplit: number[];
  swissRounds: number;
  startsAt: number;
  checkinOpensAt: number | null;
  shareSlug: string;
  createdAt: number;
  completedAt: number | null;
  winnerId: string | null;
  entrants: TEntrant[];
  matches: TMatch[];
  standings: TStanding[];
  payouts: TPayout[];
  locked: boolean;
  log: TLog[];
}

export const FORMAT_LABELS: Record<TFormat, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  round_robin: 'Round Robin',
  swiss: 'Swiss',
};

export const STATUS_LABELS: Record<TStatus, string> = {
  upcoming: 'Upcoming',
  checkin: 'Check-in',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
