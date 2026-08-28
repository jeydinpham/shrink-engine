import "@/styles/globals.css";
import { AppProps } from 'next/app';
import { fontVariables } from '@/lib/fonts';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div className={`${fontVariables} font-sans`}>
      <Component {...pageProps} />
    </div>
  );
}
