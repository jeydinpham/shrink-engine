export type Resolution = 'original' | '1080' | '720' | '480' | '360';

export interface CompressOptions {
	targetSizeMB: number;
	resolution: Resolution;
	muteAudio: boolean;
	/** Uses a slower libx264 preset for better quality at the same bitrate. */
	extraQuality: boolean;
	trimStartSec: number;
	trimEndSec: number;
}

export const AUDIO_BITRATE_KBPS = 128;
const MIN_VIDEO_BITRATE_KBPS = 80;
// Leaves headroom for container/muxing overhead and estimation error so the
// result lands under the target instead of slightly over it.
const SAFETY_MARGIN = 0.96;

export interface BitratePlan {
	videoBitrateKbps: number;
	audioBitrateKbps: number;
	/** True when the target size is so small the video bitrate had to be floored. */
	belowMinimum: boolean;
}

export function planBitrate(effectiveDurationSeconds: number, options: CompressOptions): BitratePlan {
	const audioBitrateKbps = options.muteAudio ? 0 : AUDIO_BITRATE_KBPS;
	const targetBits = options.targetSizeMB * 1024 * 1024 * 8 * SAFETY_MARGIN;
	const totalKbps = targetBits / effectiveDurationSeconds / 1000;
	const rawVideoKbps = totalKbps - audioBitrateKbps;

	return {
		videoBitrateKbps: Math.max(Math.round(rawVideoKbps), MIN_VIDEO_BITRATE_KBPS),
		audioBitrateKbps,
		belowMinimum: rawVideoKbps < MIN_VIDEO_BITRATE_KBPS,
	};
}

/** Returns an ffmpeg -vf scale filter, or null if no scaling is needed. */
export function buildScaleFilter(resolution: Resolution, sourceHeight: number): string | null {
	if (resolution === 'original') return null;
	const targetHeight = Number(resolution);
	if (!sourceHeight || sourceHeight <= targetHeight) return null;
	return `scale=-2:${targetHeight}`;
}

export function getFileExtension(filename: string): string {
	const idx = filename.lastIndexOf('.');
	return idx >= 0 ? filename.slice(idx) : '.mp4';
}

/** Which encoding backend actually ran a given compression job. */
export type EngineUsed = 'webcodecs' | 'multi' | 'single';
