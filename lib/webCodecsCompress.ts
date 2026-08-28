import { AUDIO_BITRATE_KBPS, CompressOptions, planBitrate } from './compress';

export interface WebCodecsCompressionResult {
	blob: Blob;
	sizeBytes: number;
	belowMinimum: boolean;
	durationSeconds: number;
}

export interface WebCodecsCallbacks {
	onProgress?: (progress: number) => void;
	onLog?: (message: string) => void;
}

/** Feature-detects the WebCodecs API itself, cheap enough to call before importing mediabunny. */
export function canUseWebCodecs(): boolean {
	return typeof window !== 'undefined' && typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined';
}

const PROBE_TIMEOUT_MS = 8_000;

/**
 * Actually attempts to decode the video's first frame via WebCodecs, rather
 * than just checking whether the browser's API exists. Encoder-capability
 * checks say nothing about whether THIS file's source codec/bitstream can
 * be decoded — `isConfigSupported()`-style static checks can say yes and
 * still fail on real data (confirmed in the wild: a 4K vertical HEVC clip
 * failed with "Decoding task did not complete" despite nothing flagging it
 * in advance). This isn't a 100% guarantee either — a failure deeper in a
 * long file (e.g. hardware decoder resource exhaustion) can't be predicted
 * from frame 1 — but it catches the common case before the user ever hits
 * Compress instead of only discovering it mid-job.
 */
export async function probeWebCodecsDecode(file: File): Promise<boolean> {
	if (!canUseWebCodecs()) return false;

	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = await import('mediabunny');
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) return false;

		const sink = new VideoSampleSink(videoTrack);
		const sample = await Promise.race([
			sink.getSample(0),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('decode probe timed out')), PROBE_TIMEOUT_MS)),
		]);
		sample?.close();
		return sample != null;
	} catch {
		return false;
	} finally {
		input.dispose();
	}
}

// Hardware encoders haven't shown ffmpeg.wasm's pthread-hang failure mode in
// testing, but this is a cheap safety net in case a specific browser/GPU
// combination stalls: falls back to the ffmpeg.wasm pipeline just like a
// stalled multi-threaded core would.
const STALL_MS = 20_000;

// WebCodecs' "constant" bitrate mode is only a hint the browser's encoder
// isn't guaranteed to honor strictly (unlike x264's VBV constraints in the
// ffmpeg path, which are enforced). Confirmed by testing: high-motion/
// high-entropy content overshot a 8MB target by 5x+ on a software encoder.
// Since hitting the target size is the whole point of this app, a result
// this far over is treated as a failure so the caller falls back to the
// ffmpeg pipeline, which does honor the target.
const MAX_OVERSHOOT_RATIO = 1.3;

/**
 * Fast path: hardware-accelerated encoding via the browser's native
 * WebCodecs implementation (mediabunny handles demuxing/muxing on top of
 * it). No 30MB wasm download, and typically an order of magnitude faster
 * than software x264-in-wasm when the browser/GPU supports it. Throws if
 * unsupported or if anything goes wrong — callers should catch and fall
 * back to runCompression.ts's ffmpeg.wasm pipeline.
 */
export async function compressWithWebCodecs(
	file: File,
	options: CompressOptions,
	callbacks: WebCodecsCallbacks = {}
): Promise<WebCodecsCompressionResult> {
	// Dynamically imported so the ~150KB library isn't in the initial page
	// bundle for users who never compress anything (or whose browser can't
	// use this path anyway).
	const {
		ALL_FORMATS,
		BlobSource,
		BufferTarget,
		Conversion,
		Input,
		Mp4OutputFormat,
		Output,
		Quality,
		canEncodeVideo,
	} = await import('mediabunny');

	const { onLog } = callbacks;
	onLog?.('[webcodecs] probing video…');

	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

	try {
		const totalDuration = await input.computeDuration();
		if (!(totalDuration > 0)) {
			throw new Error('Could not determine video duration.');
		}

		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) {
			throw new Error('No video track found.');
		}
		const sourceHeight = await videoTrack.getDisplayHeight();
		onLog?.(`[webcodecs] duration ${totalDuration.toFixed(2)}s, source height ${sourceHeight}p`);

		const trimStart = Math.max(0, options.trimStartSec || 0);
		const trimEnd = Math.max(0, options.trimEndSec || 0);
		const effectiveDuration = totalDuration - trimStart - trimEnd;
		if (effectiveDuration <= 0.5) {
			throw new Error('That trim range leaves little or no video to compress.');
		}

		const { videoBitrateKbps, belowMinimum } = planBitrate(effectiveDuration, options);
		const videoBitrateBps = videoBitrateKbps * 1000;

		const targetHeight = (() => {
			if (options.resolution === 'original') return undefined;
			const h = Number(options.resolution);
			return sourceHeight > h ? h : undefined;
		})();

		const canEncode = await canEncodeVideo('avc', {
			height: targetHeight ?? sourceHeight,
			quality: new Quality({ bitrate: videoBitrateBps, bitrateMode: 'constant' }),
		});
		if (!canEncode) {
			throw new Error('Hardware/browser H.264 encoding is not available here.');
		}
		onLog?.(`[webcodecs] hardware/browser H.264 encoder available, target bitrate ~${videoBitrateKbps}kbps`);

		const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

		const conversion = await Conversion.init({
			input,
			output,
			video: {
				codec: 'avc',
				quality: new Quality({ bitrate: videoBitrateBps, bitrateMode: 'constant' }),
				...(targetHeight ? { height: targetHeight } : {}),
			},
			audio: options.muteAudio
				? { discard: true }
				: { codec: 'aac', quality: new Quality({ bitrate: AUDIO_BITRATE_KBPS * 1000, bitrateMode: 'constant' }) },
			trim: trimStart > 0 || trimEnd > 0 ? { start: trimStart, end: totalDuration - trimEnd } : undefined,
			showWarnings: false,
		});

		if (!conversion.isValid) {
			const reasons = conversion.discardedTracks.map((d) => d.reason).join(', ') || 'unknown reason';
			throw new Error(`This video can't be hardware-encoded here (${reasons}).`);
		}

		onLog?.('[webcodecs] encoding…');
		let lastProgressAt = Date.now();
		let lastLoggedTenth = -1;
		conversion.onProgress = (progress) => {
			lastProgressAt = Date.now();
			const tenth = Math.floor(progress * 10);
			if (tenth > lastLoggedTenth) {
				lastLoggedTenth = tenth;
				onLog?.(`[webcodecs] progress: ${Math.round(progress * 100)}%`);
			}
			callbacks.onProgress?.(progress);
		};

		const watchdog = setInterval(() => {
			if (Date.now() - lastProgressAt > STALL_MS) {
				conversion.cancel().catch(() => {});
			}
		}, 2000);

		try {
			await conversion.execute();
		} finally {
			clearInterval(watchdog);
		}

		const buffer = output.target.buffer;
		if (!buffer || buffer.byteLength === 0) {
			throw new Error('Hardware encoding produced an empty file.');
		}

		const targetBytes = options.targetSizeMB * 1024 * 1024;
		if (buffer.byteLength > targetBytes * MAX_OVERSHOOT_RATIO) {
			throw new Error(
				`Hardware encoder missed the target size badly (got ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB for a ${
					options.targetSizeMB
				}MB target).`
			);
		}

		onLog?.(`[webcodecs] done — output ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
		const blob = new Blob([buffer], { type: 'video/mp4' });
		return { blob, sizeBytes: blob.size, belowMinimum, durationSeconds: effectiveDuration };
	} finally {
		input.dispose();
	}
}
