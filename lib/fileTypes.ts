// Beyond mp4/webm, browsers frequently fail to report a MIME type (or play
// the file back at all) for these, even though ffmpeg can decode them fine.
const VIDEO_EXTENSIONS = [
	'mp4', 'm4v', 'mov', 'avi', 'wmv', 'flv', 'webm', 'mkv',
	'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'ts', 'mts', 'm2ts',
	'vob', 'ogv', 'asf', 'rm', 'divx',
];

// Listing extensions explicitly (not just "video/*") keeps formats the OS
// file picker doesn't recognize as video from being filtered out.
export const VIDEO_ACCEPT = ['video/*', ...VIDEO_EXTENSIONS.map((ext) => `.${ext}`)].join(',');

export function looksLikeVideoFile(file: File): boolean {
	if (file.type.startsWith('video/')) return true;
	const ext = file.name.split('.').pop()?.toLowerCase();
	return !!ext && VIDEO_EXTENSIONS.includes(ext);
}
