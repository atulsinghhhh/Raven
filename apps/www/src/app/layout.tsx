import type { Metadata } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import './globals.css';

const TITLE = 'Raven — Real-time infrastructure for developers';
const DESCRIPTION =
  'Build audio, video, messaging, and live streaming experiences with Raven — a developer-first real-time platform with token-based auth, real diagnostics, and SDKs for web, mobile, and server.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'Raven',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Headlines run as light as weight 300 (see Hero) — a variable font with
// a real light cut, not a browser-synthesized fake bold-in-reverse.
const sans = Inter({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Console-style microcopy (nav links, section eyebrows, code chrome) —
// Geist Mono is Vercel's open-source mono, not anything proprietary to
// the sites that also happen to use it.
const mono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-raven-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
