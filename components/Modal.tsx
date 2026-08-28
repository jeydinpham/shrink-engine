import React, { useEffect } from 'react';

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

/** A centered dialog with a dimmed backdrop — for optional, user-triggered content (not for status that appears mid-workflow). */
export function Modal({ open, onClose, title, children }: ModalProps) {
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div
			role="presentation"
			onClick={onClose}
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				onClick={(e) => e.stopPropagation()}
				className="relative w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl p-6"
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
