import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Lexend } from 'next/font/google';
import './globals.css';
import { assertNavMatchesContent } from '../lib/docs';
import { SITE_URL } from '../lib/site';

const DESCRIPTION = 'Guides and reference for building on Livqeno — real-time video, audio, chat, and live streaming.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Livqeno Docs', template: '%s — Livqeno Docs' },
  description: DESCRIPTION,
  openGraph: {
    siteName: 'Livqeno Docs',
    title: 'Livqeno Docs',
    description: DESCRIPTION,
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Livqeno Docs',
    description: DESCRIPTION,
  },
};

// Fails the build loudly if the sidebar ever points at a page that
// doesn't exist: a dead nav link is a bug, not a 404 to discover later.
assertNavMatchesContent();

// Body/UI text — shared with the marketing site and the console.
const sans = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Display face for page titles and content headings — the editorial
// serif that ties the three apps together.
const displayFace = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400'],
  style: ['normal', 'italic'],
  variable: '--font-raven-display',
  display: 'swap',
});

// Code blocks, inline code, and mono chrome labels.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-raven-mono',
  display: 'swap',
});

const THEME_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('raven-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${sans.variable} ${displayFace.variable} ${mono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
