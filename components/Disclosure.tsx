import React, { useState } from 'react';

interface DisclosureProps {
	title: string;
	defaultOpen?: boolean;
	children: React.ReactNode;
}

export function Disclosure({ title, defaultOpen = false, children }: DisclosureProps) {
	const [open, setOpen] = useState(defaultOpen);

	return (
		<div className="rounded-lg border border-border bg-card/60 overflow-hidden">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				aria-expanded={open}
				className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm font-medium text-foreground hover:bg-accent/50 transition-colors"
			>
				<svg
					viewBox="0 0 20 20"
					fill="currentColor"
					className={`h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
				>
					<path fillRule="evenodd" d="M6 4l8 6-8 6V4z" clipRule="evenodd" />
				</svg>
				{title}
			</button>
			{open && <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>}
		</div>
	);
}
