export interface Organism {
  id: string; name: string; size: number; isOrganism: boolean;
  persona: { name?: string; personality?: string; objective?: string } | null;
  awakenedAt: string | null; topTags: string[]; lastUpdated: string;
}

export interface BridgeLogEntry {
  id: string; action: string; at: string;
  dtuId?: string; swarmName?: string;
  [key: string]: unknown;
}

export interface Debate {
  id: string; dtuId: string; challengerRole: string; challenge: string;
  transcript: { speaker: string; content: string }[];
  verdict: string; resolution: string; at: string;
}

export interface BirthCert {
  id: string; swarmId: string; swarmName: string; approved: boolean;
  approvalRatio: string; at: string;
  governanceReviews: { role: string; approve: boolean; note: string }[];
  persona: { name?: string } | null;
}

export interface EmergentRole {
  role: string;
  capabilities: { canQuery: boolean; canValidate: boolean; canDebate: boolean; canVote: boolean };
}

export type BridgeView = 'activity' | 'organisms' | 'debates' | 'lifecycle' | 'emergents' | 'federation' | 'actions';
