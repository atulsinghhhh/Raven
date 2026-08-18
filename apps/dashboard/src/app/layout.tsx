import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Raven — Developer Console',
  description: 'Real-time communication infrastructure: rooms, connections, observability, and SDKs.',
};

/**
 * Resolves the theme before first paint. Without this the page renders in
 * the default theme for a frame and then snaps — the classic dark-mode
 * flash. Has to be inline and synchronous in <head> for that reason.
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
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
