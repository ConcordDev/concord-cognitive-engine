import { Chakra_Petch } from 'next/font/google';

/** HUD labels, view tabs, Kay's lines: a hard-edged technical face. Numbers use the platform's JetBrains Mono. */
export const hudFont = Chakra_Petch({ weight: ['400', '500', '600'], subsets: ['latin'], display: 'swap', variable: '--ws-font-hud' });

export const workshopFontVars = hudFont.variable;
