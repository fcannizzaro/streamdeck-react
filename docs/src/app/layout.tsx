import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import type { Metadata } from 'next';
import './global.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://fcannizzaro.github.io/streamdeck-react'),
  title: {
    default: '@fcannizzaro/streamdeck-react',
    template: '%s | @fcannizzaro/streamdeck-react',
  },
  description:
    'Build Stream Deck plugins with React — render components directly to keys, dials, and touch screens',
  openGraph: {
    title: '@fcannizzaro/streamdeck-react',
    description:
      'Build Stream Deck plugins with React — render components directly to keys, dials, and touch screens',
    siteName: '@fcannizzaro/streamdeck-react',
    type: 'website',
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
