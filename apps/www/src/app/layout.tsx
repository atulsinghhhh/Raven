import type { Metadata } from 'next';
import { Geist_Mono, Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

const TITLE = 'Raven — Infrastructure for real-time applications';
const DESCRIPTION =
  'Audio, video, chat, and live streaming infrastructure with the APIs and SDKs to build real-time applications — token-based auth, real diagnostics, and SDKs for web, mobile, and server.';

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

// Body text and UI copy. Headlines run in the display face below.
const sans = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Display face for headlines only — the geometric, slightly technical
// cut that separates "Raven is infrastructure" from body copy. Wired to
// the `.display` utility in globals.css; never applied to paragraphs.
const displayFace = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-raven-display',
  display: 'swap',
});

// Console-style microcopy (nav links, section eyebrows, code chrome);
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
    <html lang="en" data-theme="dark" className={`${sans.variable} ${displayFace.variable} ${mono.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
