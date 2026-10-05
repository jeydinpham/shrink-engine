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
	const toneClass = tone === 'good' ? 'text-accent' : tone === 'bad' ? 'text-danger' : 'text-ink';
	return (
		<div className="flex items-start justify-between gap-4 py-2 border-b border-faint last:border-b-0">
			<span className="text-dim shrink-0">{label}</span>
			<span className={`text-right font-mono text-[12px] [font-stretch:87.5%] ${toneClass}`}>{value}</span>
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
				<div className="rounded-md border border-accent-2/40 bg-accent-2/10 p-3.5 text-ink">
					The decode check for this file timed out, but encoding is supported here. This looks like a slow/cold GPU
					driver rather than a real incompatibility &mdash; re-selecting the file (or trying again after your GPU driver
					has decoded something once already this session) may let it pass next time.
				</div>
			)}

			<div>
				<p className="mono !text-ink mb-2">This file</p>
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
				<p className="mono !text-ink mb-2">This browser</p>
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
				<p className="mono !text-ink mb-2">If hardware still won&rsquo;t turn on</p>
				<ul className="space-y-2.5 [&>li]:relative [&>li]:pl-[22px] [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:top-[.72em] [&>li]:before:h-px [&>li]:before:w-3 [&>li]:before:bg-accent">
					{browser?.gpuPageUrl && (
						<li>
							Open <code className="font-mono text-[13px] text-ink">{browser.gpuPageUrl}</code> in a new tab (detected browser:{' '}
							{browser.name}) and check the video decode/encode status, plus any &ldquo;problems detected&rdquo; section for
							the specific reason &mdash; often a driver version on the browser&rsquo;s internal blocklist.
						</li>
					)}
					{!browser?.gpuPageUrl && browser && (
						<li>
							Detected browser: <strong className="font-medium text-ink">{browser.name}</strong>. {browser.accelerationSettingHint}
						</li>
					)}
					<li>Make sure your GPU driver is up to date &mdash; brand-new GPUs are sometimes temporarily blocklisted.</li>
					{browser?.gpuPageUrl && <li>{browser.accelerationSettingHint}</li>}
				</ul>
			</div>

			<button
				type="button"
				onClick={copyReport}
				className="btn w-full"
			>
				{copied ? 'Copied ✓' : 'Copy diagnostics report'}
			</button>
		</Modal>
	);
}
