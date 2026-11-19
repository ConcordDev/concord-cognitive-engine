/** Section colours are data: they are saved with each marker (studio.markers-add requires #rrggbb). */
export const SECTION_NAMES = ['Intro', 'Verse', 'Pre', 'Chorus', 'Bridge', 'Drop', 'Outro'] as const;
export const SECTION_COLOURS: Record<string, string> = {
  Intro: '#8fb3ff', Verse: '#6fd36a', Pre: '#ffd23e', Chorus: '#ff8a3d', Bridge: '#c58bff', Drop: '#ff3b2f', Outro: '#9c8f7f',
};
export const DEFAULT_SECTION_COLOUR = '#ffb23e';
