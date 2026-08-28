import React, { useEffect, useState } from 'react';

const TRANSITION_MS = 200;

function XIcon({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className}>
			<path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
		</svg>
	);
}

interface ModalProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
}

/** A centered dialog with a dimmed backdrop, fading (+ scaling slightly) in and out — for optional, user-triggered content. */
export function Modal({ open, onClose, title, children }: ModalProps) {
	// Kept mounted a little past `open` going false so the exit transition
	// can actually play instead of the dialog just vanishing.
	const [mounted, setMounted] = useState(open);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		if (open) {
			setMounted(true);
			// Double rAF: a single rAF can still land in the same paint as the
			// "mounted" commit (React's effect flush + rAF timing sometimes
			// coincide), so the browser never paints the invisible state and
			// there's nothing for the CSS transition to animate from. Waiting
			// a full extra frame guarantees that initial paint actually happens.
			let raf2 = 0;
			const raf1 = requestAnimationFrame(() => {
				raf2 = requestAnimationFrame(() => setVisible(true));
			});
			return () => {
				cancelAnimationFrame(raf1);
				cancelAnimationFrame(raf2);
			};
		}

		setVisible(false);
		const timeout = setTimeout(() => setMounted(false), TRANSITION_MS);
		return () => clearTimeout(timeout);
	}, [open]);

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!mounted) return null;

	return (
		<div
			role="presentation"
			onClick={onClose}
			className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 transition-opacity duration-200 ${
				visible ? 'opacity-100' : 'opacity-0'
			}`}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onClick={(e) => e.stopPropagation()}
				className={`relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl p-6 transition-all duration-200 ${
					visible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
				}`}
			>
				<button
					type="button"
					onClick={onClose}
					aria-label="Close"
					className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
				>
					<XIcon className="h-5 w-5" />
				</button>
				<h2 className="font-display text-2xl font-semibold text-foreground mb-4 pr-8">{title}</h2>
				<div className="space-y-4 text-sm text-muted-foreground leading-relaxed">{children}</div>
			</div>
		</div>
	);
}
