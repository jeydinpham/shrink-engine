# Shrink Engine

A web app that compresses a video down to a target file size (10MB, 20MB, 50MB, 100MB, or a custom size). Everything runs client-side — no upload, no server, the video never leaves your browser.

<!-- ## Preview
![](./public/assets/preview.png) -->

## Features

- **Target size presets** — 10MB / 20MB / 50MB / 100MB, or type any custom size
- **Drag & drop, file picker, or a URL** to load a video
- **Options**
  - Remove all sound (mute)
  - Extra quality — slower 2-pass encode that lands closer to the target size
  - Trim the clip — skip seconds off the start and/or end
  - Play a sound when done
  - Auto-download when done
  - Resolution cap (Original / 1080p / 720p / 480p / 360p)
- **Pre-flight hardware check** — the moment you pick a file, it does a real first-frame decode test to confirm WebCodecs can actually handle *that* file, rather than just trusting a generic "does this browser support the API" query. The Compress button stays disabled ("Checking video…") until that finishes.
- **Live, animated engine status** — a 3-step ladder (Hardware → Multi-core → Single-core) shows every engine that could run, which one's planned, and animates in real time as attempts happen and fall back
- **"How does this work?"** — an in-app explainer of the engine/bitrate approach below
- The Compress button disables once a job finishes ("Compressed ✓") — use "Compress another" or pick a new file to run again

## How it works

Compression tries up to three engines, in order, until one succeeds:

1. **[WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)** (via [`mediabunny`](https://mediabunny.dev)) — routes encoding through the browser's native, hardware-accelerated video encoder when available. No wasm download, close to native-app speed. Skipped entirely if the pre-flight decode check rules it out for the current file, or if the browser doesn't expose the API at all.
2. **[ffmpeg.wasm](https://ffmpegwasm.netlify.app/)**, multi-threaded — a WebAssembly build of ffmpeg running across multiple CPU cores, guarded by a stall watchdog: if it goes 15s without emitting progress (a real hang the multi-threaded wasm core can hit on real-world video), it's hard-killed and the job restarts on the tier below. Skipped on mobile browsers entirely, since the multi-threaded core's larger fixed WASM memory footprint has caused hard out-of-memory crashes on real phones.
3. **ffmpeg.wasm, single-threaded** — the fully reliable fallback. Slower, but works everywhere.

To hit the requested size, it works out the bitrate the video can spend, for its whole length, to land under the target, then encodes at that bitrate — so the result is a file just under the size you asked for, not a fixed quality level. The WebCodecs path also double-checks the actual output size against the target (its "constant bitrate" mode is only a hint the browser doesn't always honor strictly) and falls back to ffmpeg if it overshoots.

Speed scales with your device: software encoding runs on your CPU with no dedicated hardware to lean on, so a fast desktop finishes in seconds while a weaker machine takes longer. Mobile is the toughest case — hardware sessions are more resource-constrained (more likely to fall back to software) and that software fallback is single-core only, so for the fastest, most consistent results, use this on a desktop or laptop.

## Tech stack

### Front-end
- [React](https://react.dev/) + [Next.js](https://nextjs.org/) (Pages Router)
- [Tailwind CSS](https://tailwindcss.com/), themed to match [jeydinpham.com](https://jeydinpham.com)
- [Geist Sans / Geist Mono](https://vercel.com/font) + [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque) for typography
- [`mediabunny`](https://mediabunny.dev) for WebCodecs-based demuxing/muxing/encoding
- [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) for the software fallback encoder

### Back-end
- There's no backend 💀 — everything above runs in the browser

## Local Development

### 1. Clone the project
Clone the repository and install the dependencies.
```bash
$ git clone https://github.com/jeydinpham/shrink-engine.git
$ cd shrink-engine
$ npm install
```
`npm install` also copies the ffmpeg.wasm core files into `public/ffmpeg/` and `public/ffmpeg-mt/` (via a `postinstall` script) — they're regenerated on every install rather than committed to the repo.

### 2. Start local development
```bash
$ npm run dev
```
Open [localhost:3000](http://localhost:3000) in your browser.

## License
This project is licensed under the [MIT License](https://opensource.org/license/mit) - see the [LICENSE](./LICENSE) file for more details
