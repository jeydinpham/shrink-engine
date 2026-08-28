# Video Compressor
A web app that compresses a video to a target file size (8MB, 25MB, 50MB, 100MB, or a custom size). All compression runs client-side via [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) — no server, no upload, the video never leaves your browser.

<!-- ## Preview
![](./public/assets/preview.png) -->

## Tech Stack
### Front-end:
- [React.js](https://react.dev/)
- [Next.js](https://nextjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) for in-browser video transcoding
### Back-end:
- There's no backend 💀

## Local Development
### 1. Clone the project
1. Clone the repository into your system and install the dependencies.
```bash
$ git clone https://github.com/Jeydin21/Video-Compressor.git
$ cd Video-Compressor
$ npm install # Or yarn install
```

### 2. Start local development
1. Create a local development server.
```bash
$ npm run dev
```
2. Open the preview [localhost:3000](http://localhost:3000) in your browser.

## License
This project is licensed under the [MIT License](https://opensource.org/license/mit) - see the [License](https://github.com/Jeydin21/Next.js-TailwindCSS-Template/blob/main/LICENSE) file for more details