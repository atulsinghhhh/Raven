import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Lexend } from 'next/font/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'Livqeno — Developer Console',
  description: 'Real-time communication infrastructure: rooms, connections, observability, and SDKs.',
};

// Body/UI text. Light weights keep the console airy; 500-600 carry
// buttons and labels.
const sans = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Display face for page titles only — the editorial serif shared with
// the marketing site, so the console and the front door read as one
// product.
const displayFace = Fraunces({
  subsets: ['latin'],
  weight: ['300', '400'],
  style: ['normal', 'italic'],
  variable: '--font-raven-display',
  display: 'swap',
});

// Console chrome: mono labels, code, keys, metrics.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-raven-mono',
  display: 'swap',
});

/**
 * Resolves the theme before first paint. Without this the page renders in
 * the default theme for a frame and then snaps: the classic dark-mode
 * flash. Has to be inline and synchronous in <head> for that reason.
 *
 * Light-first: an explicit stored choice wins, an explicit OS dark
 * preference is honored, and everything else — no storage, no matchMedia,
 * script failure — lands on light, the flagship theme.
 */
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
