// The Notebook faces: Newsreader (Concord's entries, set like a well-kept
// lab notebook), Instrument Sans (your entries and every control), Kalam
// (red-ink margin notes and entry numbers, as if written by hand).
import { Newsreader, Instrument_Sans, Kalam } from 'next/font/google';

export const nbSerif = Newsreader({ weight: ['400', '500', '600'], style: ['normal', 'italic'], subsets: ['latin'], display: 'swap', variable: '--nb-font-serif' });
export const nbSans = Instrument_Sans({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--nb-font-sans' });
export const nbHand = Kalam({ weight: ['400', '700'], subsets: ['latin'], display: 'swap', variable: '--nb-font-hand' });

export const notebookFontVars = `${nbSerif.variable} ${nbSans.variable} ${nbHand.variable}`;
