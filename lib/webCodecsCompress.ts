import { AUDIO_BITRATE_KBPS, CompressOptions, MIN_VIDEO_BITRATE_KBPS, planBitrate } from './compress';

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

// Generous on purpose: a cold hardware decoder (first decode of the whole
// session) can have real one-time init latency, and this only has to run
// once per file, well before Compress is pressed — a false "unsupported"
// here is worse than making the user wait a few extra seconds for an
// accurate answer, since it silently takes hardware encoding off the table
// for the whole job.
const PROBE_TIMEOUT_MS = 15_000;

export interface DecodeProbeResult {
	ok: boolean;
	/** True specifically when the probe hit PROBE_TIMEOUT_MS, as opposed to a real decode rejection. */
	timedOut: boolean;
	durationMs: number;
	/** Human-readable reason, same text as what's sent to onLog. */
	detail: string;
}

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
 *
 * `onLog`, if given, reports *why* the probe passed/failed so a rejection
 * never shows up as a silent, unexplained switch to the software engine.
 *
 * Note this only tests DECODE. A cold discrete-GPU driver (first video
 * decode of the session) can take a while to spin up its context — enough
 * to occasionally eat the whole timeout on a machine with a powerful,
 * perfectly capable encoder that this probe never even reaches. `timedOut`
 * is broken out separately so callers (see DiagnosticsPanel) can tell that
 * failure mode apart from a genuine "this codec/profile isn't supported."
 */
export async function probeWebCodecsDecode(file: File, onLog?: (message: string) => void): Promise<DecodeProbeResult> {
	const start = performance.now();
	const elapsed = () => Math.round(performance.now() - start);

	if (!canUseWebCodecs()) {
		return { ok: false, timedOut: false, durationMs: elapsed(), detail: 'WebCodecs API not present in this browser.' };
	}

	const { ALL_FORMATS, BlobSource, Input, VideoSampleSink } = await import('mediabunny');
	const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });

	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		if (!videoTrack) {
			const detail = 'no video track found';
			onLog?.(`[webcodecs] pre-flight check: ${detail} — skipping hardware encoding for this file.`);
			return { ok: false, timedOut: false, durationMs: elapsed(), detail };
		}

		// getSample(timestamp) returns null if `timestamp` is before the
		// track's first packet — and that first timestamp is often NOT 0.
		// Confirmed in the wild: an OBS-recorded VP9 clip's video track
		// started at a small positive offset, so probing at a hardcoded 0
		// always came back "no sample" and wrongly ruled out WebCodecs for
		// every file like it.
		const firstTimestamp = await videoTrack.getFirstTimestamp();

		const sink = new VideoSampleSink(videoTrack);
		const sample = await Promise.race([
			sink.getSample(firstTimestamp),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('decode probe timed out')), PROBE_TIMEOUT_MS)),
		]);
		sample?.close();
		if (sample == null) {
			const detail = 'no decodable frame at the start of this file';
			onLog?.(`[webcodecs] pre-flight check: ${detail} — skipping hardware encoding.`);
			return { ok: false, timedOut: false, durationMs: elapsed(), detail };
		}
		return { ok: true, timedOut: false, durationMs: elapsed(), detail: 'decoded the first frame successfully' };
	} catch (err) {
		const message = err instanceof Error ? err.message : 'unknown error';
		onLog?.(`[webcodecs] pre-flight check failed (${message}) — this file will use the software engine instead.`);
		return { ok: false, timedOut: message === 'decode probe timed out', durationMs: elapsed(), detail: message };
	} finally {
		input.dispose();
	}
}

export interface EncodeProbeResult {
	supported: boolean;
	error: string | null;
}

/**
 * Standalone check of whether this browser/device can hardware-or-software
 * encode H.264 via WebCodecs at all, independent of any specific file or of
 * `probeWebCodecsDecode` above. Exists so the diagnostics panel can tell
 * "decode probe failed/timed out" apart from "this device genuinely can't
 * encode" — the two get conflated by the file-decode gate in
 * VideoCompressor, but they're unrelated capabilities under the hood.
 * Uses representative 1080p/4Mbps settings since there's no real file to
 * size the check against.
 */
export async function probeWebCodecsEncodeCapability(): Promise<EncodeProbeResult> {
	if (!canUseWebCodecs()) return { supported: false, error: 'WebCodecs API not present in this browser.' };
	try {
		const { Quality, canEncodeVideo } = await import('mediabunny');
		const supported = await canEncodeVideo('avc', {
			height: 1080,
			quality: new Quality({ bitrate: 4_000_000, bitrateMode: 'constant' }),
		});
		return { supported, error: null };
	} catch (err) {
		return { supported: false, error: err instanceof Error ? err.message : 'unknown error' };
	}
}

// Hardware encoders haven't shown ffmpeg.wasm's pthread-hang failure mode in
// testing, but this is a cheap safety net in case a specific browser/GPU
// combination stalls: falls back to the ffmpeg.wasm pipeline just like a
// stalled multi-threaded core would.
const STALL_MS = 20_000;

// WebCodecs' "constant" bitrate mode is only a hint the browser's encoder
// isn't guaranteed to honor strictly (unlike x264's VBV constraints in the
// ffmpeg path, which are enforced) — the API has no maxrate/bufsize concept
// at all, so there's no way to make it comply even in principle. Confirmed
// by testing: high-motion/high-entropy content overshot a target by 5x+ on
// a software encoder. Rather than give up on the fast path the moment that
// happens, MAX_SIZE_RETRIES below re-encodes at a proportionally lower
// bitrate first — hardware encoding is fast enough that a couple of retries
// still beats falling straight through to ffmpeg.wasm — and only throws
// (triggering the caller's fallback) once retries are exhausted or the
// bitrate's already floored.
const MAX_SIZE_RETRIES = 2;
const SIZE_RETRY_SAFETY = 0.95;

/**
 * Fast path: hardware-accelerated encoding via the browser's native
 * WebCodecs implementation (mediabunny handles demuxing/muxing on top of
 * it). No 30MB wasm download, and typically an order of magnitude faster
 * than software x264-in-wasm when the browser/GPU supports it. Throws if
 * unsupported or if every retry still misses the target — callers should
 * catch and fall back to runCompression.ts's ffmpeg.wasm pipeline.
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

		const targetHeight = (() => {
			if (options.resolution === 'original') return undefined;
			const h = Number(options.resolution);
			return sourceHeight > h ? h : undefined;
		})();

		const { videoBitrateKbps: plannedBitrateKbps } = planBitrate(effectiveDuration, options);
		const targetBytes = options.targetSizeMB * 1024 * 1024;

		let videoBitrateKbps = plannedBitrateKbps;
		let buffer: ArrayBuffer | undefined;
		let belowMinimum = false;

		for (let attempt = 0; attempt <= MAX_SIZE_RETRIES; attempt++) {
			const videoBitrateBps = videoBitrateKbps * 1000;
			belowMinimum = videoBitrateKbps <= MIN_VIDEO_BITRATE_KBPS;

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

			const attemptBuffer = output.target.buffer;
			if (!attemptBuffer || attemptBuffer.byteLength === 0) {
				throw new Error('Hardware encoding produced an empty file.');
			}
			buffer = attemptBuffer;

			if (buffer.byteLength <= targetBytes || belowMinimum || attempt === MAX_SIZE_RETRIES) {
				break;
			}

			const nextBitrateKbps = Math.max(
				MIN_VIDEO_BITRATE_KBPS,
				Math.floor(videoBitrateKbps * (targetBytes / buffer.byteLength) * SIZE_RETRY_SAFETY)
			);
			if (nextBitrateKbps >= videoBitrateKbps) {
				// No further reduction possible — another attempt wouldn't help either.
				break;
			}
			onLog?.(
				`[webcodecs] output was ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB, over the ${
					options.targetSizeMB
				}MB target — re-encoding at a lower bitrate (~${nextBitrateKbps}kbps) to fit (attempt ${attempt + 2}/${MAX_SIZE_RETRIES + 1})…`
			);
			videoBitrateKbps = nextBitrateKbps;
		}

		if (!buffer) {
			throw new Error('Hardware encoding produced an empty file.');
		}
		if (buffer.byteLength > targetBytes && !belowMinimum) {
			throw new Error(
				`Hardware encoder missed the target size (got ${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB for a ${
					options.targetSizeMB
				}MB target) even after retrying at a lower bitrate.`
			);
		}

		onLog?.(`[webcodecs] done — output ${(buffer.byteLength / 1024 / 1024).toFixed(2)}MB`);
		const blob = new Blob([buffer], { type: 'video/mp4' });
		return { blob, sizeBytes: blob.size, belowMinimum, durationSeconds: effectiveDuration };
	} finally {
		input.dispose();
	}
}
