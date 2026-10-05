import React, { useEffect, useState } from 'react';

const KEY = 'theme';

// Runs in <head> before first paint (pages/_document.tsx) so a saved light
// theme doesn't flash dark first. Same key as jeydinpham.com.
export const THEME_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

/** Dark/light switch from jeydinpham.com. Dark is the default; the new theme wipes in diagonally. */
export function ThemeToggle() {
	const [light, setLight] = useState(false);
	useEffect(() => {
		setLight(document.documentElement.dataset.theme === 'light');
	}, []);

	function flip() {
		const next = !light;
		const root = document.documentElement;
		const apply = () => {
			if (next) root.dataset.theme = 'light';
			else delete root.dataset.theme;
		};
		try {
			localStorage.setItem(KEY, next ? 'light' : 'dark');
		} catch {}
		setLight(next);
		if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) apply();
		else document.startViewTransition(apply);
	}

	return (
		<button
			type="button"
			className="theme-toggle"
			onClick={flip}
			aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
		>
			<span aria-hidden="true" className={light ? 'moon' : 'sun'} />
		</button>
	);
}
