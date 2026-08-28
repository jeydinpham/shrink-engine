import { Bricolage_Grotesque } from 'next/font/google';

// Matches jeydinpham.com's type system: Geist Sans/Mono are self-hosted via
// plain @font-face in globals.css (see public/fonts/) rather than next/font
// local loading — the `geist` npm package's next/font/local usage trips an
// ERR_UNSUPPORTED_DIR_IMPORT during Next's page-data collection on this
// Next/Node combo. Bricolage Grotesque is a real Google Font, so next/font
// handles it (and self-hosts it) without issue.
export const bricolage = Bricolage_Grotesque({
	subsets: ['latin'],
	variable: '--font-display',
	display: 'swap',
});

export const fontVariables = bricolage.variable;
