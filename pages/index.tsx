import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { VideoCompressor } from '@/components/VideoCompressor';
import { ThemeToggle } from '@/components/ThemeToggle';

export default function Home() {
  return (
    <>
      <Head>
        <title>Shrink Engine</title>
        <meta
          name="description"
          content="Perfectly compressed files entirely in your browser. Get around Discord's file size limit and share your videos with ease!"
        />
        <meta name="theme-color" content="#FF7A2F" />
        <link rel="icon" href="/favicon.png" />
      </Head>

      {/* top bar, as on jeydinpham.com: the logo on the left, links and the theme toggle on the right */}
      <header className="sticky top-0 z-20 border-b border-faint bg-bg/70 backdrop-blur-md backdrop-saturate-[1.2] px-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 py-4">
          <Link href="/" className="font-display text-xl font-extrabold uppercase leading-none tracking-[0.02em] text-ink transition-colors hover:text-accent">
            Shrink Engine
          </Link>
          <div className="flex items-center gap-5">
            <a href="https://jeydinpham.com" target="_blank" rel="noopener noreferrer" className="link !text-ink/85 hover:!text-ink text-[15px] max-sm:hidden">
              jeydinpham.com
            </a>
            <a href="https://github.com/jeydinpham/shrink-engine" target="_blank" rel="noopener noreferrer" className="link !text-ink/85 hover:!text-ink text-[15px]">
              GitHub
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="min-h-[calc(100vh-61px)] flex flex-col px-5 pt-10 md:pt-16">
        <VideoCompressor />
      </main>
    </>
  );
}
