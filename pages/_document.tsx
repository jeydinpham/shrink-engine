import { Html, Head, Main, NextScript } from 'next/document';
import { THEME_SCRIPT } from '@/components/ThemeToggle';

export default function Document() {
	return (
		<Html lang="en">
			<Head>
				{/* Applies a saved light theme before the page paints. */}
				<script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
