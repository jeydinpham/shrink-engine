import type { FFmpeg } from '@ffmpeg/ffmpeg';

export interface ProbeResult {
	durationSeconds: number;
	height: number;
}

/**
 * ffmpeg-core ships no ffprobe binary, so duration/resolution are read by
 * running a bare `-i` command and parsing its stderr log instead. This works
 * for any container ffmpeg can demux, unlike probing via the browser's
 * <video> element, which silently fails for formats browsers can't play
 * back at all (.avi, .mkv, .wmv, .flv, ...) even though ffmpeg can.
 */
export async function probeVideo(ffmpeg: FFmpeg, inputName: string): Promise<ProbeResult> {
	let log = '';
	const handler = ({ message }: { message: string }) => {
		log += message + '\n';
	};
	ffmpeg.on('log', handler);
	try {
		await ffmpeg.exec(['-i', inputName]);
	} finally {
		ffmpeg.off('log', handler);
	}

	const durationMatch = log.match(/Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/);
	if (!durationMatch) {
		throw new Error('Could not read this file — the format doesn’t look like a supported video.');
	}
	const [, hh, mm, ss] = durationMatch;
	const durationSeconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
	if (!(durationSeconds > 0)) {
		throw new Error('Could not determine the video’s duration.');
	}

	const dimMatch = log.match(/Video:.*?(\d{2,5})x(\d{2,5})/);
	const height = dimMatch ? Number(dimMatch[2]) : 0;

	return { durationSeconds, height };
}
