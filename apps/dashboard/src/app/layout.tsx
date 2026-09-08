import type { Metadata } from 'next';
import { Geist_Mono, Inter, Space_Grotesk } from 'next/font/google';
import './globals.css';

export const metadata: Metadata = {
  title: 'Raven — Developer Console',
  description: 'Real-time communication infrastructure: rooms, connections, observability, and SDKs.',
};

// Body/UI text.
const sans = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-raven-sans',
  display: 'swap',
});

// Display face for page titles only — shared with the marketing site so
// the console and the front door read as one product.
const displayFace = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-raven-display',
  display: 'swap',
});

// Console chrome: mono labels, code, keys, metrics.
const mono = Geist_Mono({
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
 * Dark-first: an explicit stored choice wins, an explicit OS light
 * preference is honored, and everything else — no storage, no matchMedia,
 * script failure — lands on dark, the flagship theme.
 */
const THEME_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem('raven-theme');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
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
