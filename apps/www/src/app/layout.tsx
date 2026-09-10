import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Lexend } from 'next/font/google';
import './globals.css';
import { SITE_URL } from '../lib/site';

const TITLE = 'Livqeno — Infrastructure for real-time applications';
const DESCRIPTION =
  'Audio, video, chat, and live streaming infrastructure with the APIs and SDKs to build real-time applications — token-based auth, real diagnostics, and SDKs for web, mobile, and server.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  alternates: { canonical: '/' },
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'Livqeno',
    url: '/',
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

// Body text and UI copy. Light weights keep the interface airy; 500-600
// are reserved for buttons and labels. Headlines run in the serif below.
const sans = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Display face for headlines only — the thin editorial serif that
// carries the whole identity, with the italic cut for the one or two
// emphasis words per headline. Wired to the `.display` utility in
// globals.css; never applied to paragraphs.
const displayFace = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400'],
  style: ['normal', 'italic'],
  variable: '--font-raven-display',
  display: 'swap',
});

// Console-style microcopy (section eyebrows, code chrome, technical
// labels) and every code sample on the page.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-raven-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${sans.variable} ${displayFace.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
