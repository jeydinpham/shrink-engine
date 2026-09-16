import React, { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { detectBrowser, getEnvironmentInfo, getGpuInfo } from '@/lib/diagnostics';
import type { BrowserInfo, GpuInfo, EnvironmentInfo } from '@/lib/diagnostics';
import { canUseWebCodecs, probeWebCodecsEncodeCapability } from '@/lib/webCodecsCompress';
import type { DecodeProbeResult, EncodeProbeResult } from '@/lib/webCodecsCompress';

interface DiagnosticsPanelProps {
	open: boolean;
	onClose: () => void;
	decodeProbe: DecodeProbeResult | null;
	fileDecodeSupport: 'checking' | 'supported' | 'unsupported' | null;
}

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
	const toneClass = tone === 'good' ? 'text-secondary-foreground' : tone === 'bad' ? 'text-yellow-500' : 'text-foreground';
	return (
		<div className="flex items-start justify-between gap-4 py-1.5 border-b border-border/60 last:border-b-0">
			<span className="text-muted-foreground shrink-0">{label}</span>
			<span className={`text-right font-mono text-[12px] ${toneClass}`}>{value}</span>
		</div>
	);
}

/**
 * Separates two things the app otherwise conflates into one gate: whether
 * THIS file can be decoded via WebCodecs (probeWebCodecsDecode, tied to one
 * file) vs. whether this browser/GPU can encode H.264 via WebCodecs at all
 * (probeWebCodecsEncodeCapability, independent of any file). A cold discrete
 * GPU driver can make the decode probe time out even when the encoder is
 * perfectly capable — surfacing both side by side is the whole point here.
 */
export function DiagnosticsPanel({ open, onClose, decodeProbe, fileDecodeSupport }: DiagnosticsPanelProps) {
	const [gpu, setGpu] = useState<GpuInfo | null>(null);
	const [env, setEnv] = useState<EnvironmentInfo | null>(null);
	const [browser, setBrowser] = useState<BrowserInfo | null>(null);
	const [encodeProbe, setEncodeProbe] = useState<EncodeProbeResult | 'checking' | null>(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!open) return;
		setGpu(getGpuInfo());
		setEnv(getEnvironmentInfo());
		setBrowser(detectBrowser());
		setEncodeProbe('checking');
		probeWebCodecsEncodeCapability().then(setEncodeProbe);
		setCopied(false);
	}, [open]);

	const webCodecsPresent = canUseWebCodecs();
	const encodeChecking = encodeProbe === 'checking' || encodeProbe === null;
	const encodeSupported = !encodeChecking && (encodeProbe as EncodeProbeResult).supported;

	const decodeTimedOutButEncodeFine = decodeProbe?.timedOut && encodeSupported;

	const reportText = () => {
		const lines = [
			'shrink-engine hardware diagnostics',
			`Detected browser: ${browser?.name ?? 'unknown'}${browser?.isIOS ? ' (iOS — forced onto WebKit)' : ''}`,
			`User agent: ${env?.userAgent ?? 'unknown'}`,
			`Platform: ${env?.platform ?? 'unknown'}, ${env?.cores ?? '?'} logical cores`,
			`GPU (WebGL): ${gpu?.renderer ?? 'unavailable'} (${gpu?.vendor ?? 'unknown vendor'})`,
			`WebCodecs API present: ${webCodecsPresent ? 'yes' : 'no'}`,
			`Encode capability (avc, generic 1080p): ${encodeChecking ? 'checking…' : encodeSupported ? 'supported' : `NOT supported${(encodeProbe as EncodeProbeResult)?.error ? ` (${(encodeProbe as EncodeProbeResult).error})` : ''}`}`,
			decodeProbe
				? `Decode probe (current file): ${decodeProbe.ok ? 'passed' : 'FAILED'} in ${decodeProbe.durationMs}ms — ${decodeProbe.detail}${decodeProbe.timedOut ? ' [timed out]' : ''}`
				: 'Decode probe (current file): no file selected',
		];
		return lines.join('\n');
	};

	const copyReport = async () => {
		try {
			await navigator.clipboard.writeText(reportText());
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Clipboard API can be unavailable (e.g. insecure context) — nothing
			// useful to do beyond leaving the button in its unclicked state.
		}
	};

	return (
		<Modal open={open} onClose={onClose} title="Hardware diagnostics">
			<p>
				This checks two separate things the &ldquo;Hardware&rdquo; engine depends on: whether your browser can decode{' '}
				<em>this specific file</em>, and whether it can encode H.264 via WebCodecs <em>at all</em>. A machine with a
				strong dedicated GPU can still fail the first check &mdash; a cold GPU driver spinning up its video-decode
				context for the first time in a session can be slow enough to time out &mdash; even though the second check
				passes fine.
			</p>

			{decodeTimedOutButEncodeFine && (
				<div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-yellow-500">
					The decode check for this file timed out, but encoding is supported here. This looks like a slow/cold GPU
					driver rather than a real incompatibility &mdash; re-selecting the file (or trying again after your GPU driver
					has decoded something once already this session) may let it pass next time.
				</div>
			)}

			<div>
				<p className="font-mono text-xs uppercase tracking-[0.2em] text-foreground mb-1.5">This file</p>
				<div>
					{fileDecodeSupport === 'checking' && <Row label="Decode probe" value="checking…" />}
					{fileDecodeSupport === null && <Row label="Decode probe" value="no file selected" />}
					{decodeProbe && (
						<>
							<Row
								label="Decode probe"
								value={decodeProbe.ok ? 'passed' : decodeProbe.timedOut ? 'timed out' : 'failed'}
								tone={decodeProbe.ok ? 'good' : 'bad'}
							/>
							<Row label="Took" value={`${decodeProbe.durationMs}ms`} />
							<Row label="Detail" value={decodeProbe.detail} />
						</>
					)}
				</div>
			</div>

			<div>
				<p className="font-mono text-xs uppercase tracking-[0.2em] text-foreground mb-1.5">This browser</p>
				<div>
					<Row label="WebCodecs API" value={webCodecsPresent ? 'present' : 'not present'} tone={webCodecsPresent ? 'good' : 'bad'} />
					<Row
						label="H.264 encode capability"
						value={encodeChecking ? 'checking…' : encodeSupported ? 'supported' : 'not supported'}
						tone={encodeChecking ? undefined : encodeSupported ? 'good' : 'bad'}
					/>
					{!encodeChecking && !encodeSupported && (encodeProbe as EncodeProbeResult)?.error && (
						<Row label="Encode error" value={(encodeProbe as EncodeProbeResult).error} />
					)}
					<Row label="GPU (WebGL renderer)" value={gpu?.renderer || 'unavailable'} />
					<Row label="GPU vendor" value={gpu?.vendor || 'unavailable'} />
					<Row label="Platform" value={env?.platform ?? '…'} />
					<Row label="Logical cores" value={env?.cores ?? '…'} />
				</div>
			</div>

			<div>
				<p className="font-mono text-xs uppercase tracking-[0.2em] text-foreground mb-1.5">If hardware still won&rsquo;t turn on</p>
				<ul className="list-disc pl-4 space-y-1">
					{browser?.gpuPageUrl && (
						<li>
							Open <code className="text-foreground">{browser.gpuPageUrl}</code> in a new tab (detected browser:{' '}
							{browser.name}) and check the video decode/encode status, plus any &ldquo;problems detected&rdquo; section for
							the specific reason &mdash; often a driver version on the browser&rsquo;s internal blocklist.
						</li>
					)}
					{!browser?.gpuPageUrl && browser && (
						<li>
							Detected browser: <strong className="text-foreground">{browser.name}</strong>. {browser.accelerationSettingHint}
						</li>
					)}
					<li>Make sure your GPU driver is up to date &mdash; brand-new GPUs are sometimes temporarily blocklisted.</li>
					{browser?.gpuPageUrl && <li>{browser.accelerationSettingHint}</li>}
				</ul>
			</div>

			<button
				type="button"
				onClick={copyReport}
				className="w-full py-2 rounded-full bg-muted text-foreground text-sm font-medium hover:bg-accent transition-colors"
			>
				{copied ? 'Copied ✓' : 'Copy diagnostics report'}
			</button>
		</Modal>
	);
}
