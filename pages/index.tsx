import React from 'react';
import Head from 'next/head';
import { VideoCompressor } from '@/components/VideoCompressor';

export default function Home() {
  return (
    <>
      <Head>
        <title>Shrink Engine</title>
        <meta
          name="description"
          content="Perfectly compressed files entirely in your browser. Get around Discord's file size limit and share your videos with ease!"
        />
        <meta name="theme-color" content="#34241B" />
        <link rel="icon" href="/favicon.png" />
      </Head>

      <div className="min-h-screen flex flex-col items-center px-4 py-8">
        <VideoCompressor />
      </div>
    </>
  );
}
