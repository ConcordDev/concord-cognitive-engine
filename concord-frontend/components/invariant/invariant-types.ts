export interface Invariant {
  id: string;
  name: string;
  description: string;
  status: 'enforced' | 'warning' | 'violated';
  category: 'ethos' | 'structural' | 'capability';
  frozen: boolean;
}

export type InvariantStatusFilter = 'all' | 'enforced' | 'warning' | 'violated';
