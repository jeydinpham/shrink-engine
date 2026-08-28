import React from 'react';
import Head from 'next/head';
import { VideoCompressor } from '@/components/VideoCompressor';

export default function Home() {
  return (
    <>
      <Head>
        <title>Video Compressor — shrink videos to a target size</title>
        <meta
          name="description"
          content="Compress a video down to an exact target file size (8MB, 25MB, 50MB, 100MB, or custom), entirely in your browser."
        />
        <link rel="icon" href="/favicon.png" />
      </Head>

      <div className="min-h-screen flex flex-col justify-center items-center px-4 py-16">
        <VideoCompressor />
      </div>
    </>
  );
}
