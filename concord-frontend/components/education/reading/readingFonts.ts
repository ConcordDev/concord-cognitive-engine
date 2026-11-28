import { Libre_Baskerville, Public_Sans, Special_Elite } from 'next/font/google';

/**
 * The Reading Room's faces: Libre Baskerville for everything that is read
 * (lessons, course title pages, certificates), Special Elite for the
 * typewritten catalogue cards and call numbers, Public Sans for controls.
 */
const rrBook = Libre_Baskerville({ subsets: ['latin'], weight: ['400', '700'], style: ['normal', 'italic'], variable: '--rr-font-book', display: 'swap' });
const rrType = Special_Elite({ subsets: ['latin'], weight: ['400'], variable: '--rr-font-type', display: 'swap' });
const rrSans = Public_Sans({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--rr-font-sans', display: 'swap' });

export const readingFontVars = `${rrBook.variable} ${rrType.variable} ${rrSans.variable}`;
