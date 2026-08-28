import React, { useState } from 'react';

interface DisclosureProps {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}

export function Disclosure({ title, defaultOpen = false, children }: DisclosureProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className="border border-green-800/60 rounded-md overflow-hidden bg-black/40">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="w-full flex items-center gap-2 px-4 py-2.5 text-left font-semibold text-green-400 hover:bg-green-950/30 transition-colors"
			>
				<span className={`inline-block text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>
					▶
				</span>
				{title}
			</button>
			{open && <div className="px-4 pb-4 pt-1 border-t border-green-800/40">{children}</div>}
		</div>
	);
}
