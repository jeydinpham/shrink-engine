import React from 'react';

interface SwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	label: React.ReactNode;
	description?: React.ReactNode;
}

/** A labeled toggle switch, styled to match jeydinpham.com's shadcn-derived component set. */
export function Switch({ checked, onChange, disabled, label, description }: SwitchProps) {
	return (
		<label className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
			<span className="text-sm text-foreground">
				{label}
				{description && <span className="block text-xs text-muted-foreground mt-0.5">{description}</span>}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={`relative shrink-0 inline-flex h-6 w-10 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
					checked ? 'bg-primary' : 'bg-muted'
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
						checked ? 'translate-x-5' : 'translate-x-1'
					}`}
				/>
			</button>
		</label>
	);
}
