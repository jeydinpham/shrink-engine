import React from 'react';

interface SwitchProps {
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
	label: React.ReactNode;
	description?: React.ReactNode;
}

/** A labeled toggle switch, in jeydinpham.com's style: a faint track that fills with the accent. */
export function Switch({ checked, onChange, disabled, label, description }: SwitchProps) {
	return (
		<label className={`flex items-center justify-between gap-4 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
			<span className="text-[15px] text-ink">
				{label}
				{description && <span className="block text-[13px] text-dim mt-0.5">{description}</span>}
			</span>
			<button
				type="button"
				role="switch"
				aria-checked={checked}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={`relative shrink-0 inline-flex h-6 w-10 items-center rounded-full border transition-colors duration-300 ${
					checked ? 'bg-accent border-accent' : 'bg-bg border-faint'
				}`}
			>
				<span
					className={`inline-block h-4 w-4 transform rounded-full shadow-sm transition-[transform,background-color] duration-300 ease-[cubic-bezier(.65,0,.35,1)] ${
						checked ? 'translate-x-[19px] bg-on-accent' : 'translate-x-[3px] bg-dim'
					}`}
				/>
			</button>
		</label>
	);
}
