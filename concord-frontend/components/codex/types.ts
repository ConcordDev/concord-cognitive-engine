export interface LoreEvent {
  id: string;
  title: string;
  type: string;
  era: string;
  description: string;
  significance?: string;
  world_id?: string;
  factions_involved?: string[];
  known_by?: string[];
  tags?: string[];
}
export interface Facets { worlds: string[]; types: string[]; eras: string[]; count: number }

export const COLORS = {
  fg: '#e8e4dc',
  panel: '#15151c',
  panelBorder: '#2a2a35',
  input: '#1a1a22',
  inputBorder: '#333',
  accent: 'rgba(120,90,200,0.08)',
  accentBorder: 'rgba(120,90,200,0.25)',
  error: '#ff8888',
  errorBg: 'rgba(200,60,60,0.08)',
  errorBorder: 'rgba(200,60,60,0.3)',
};
