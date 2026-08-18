import type { Metadata } from 'next';
import './globals.css';
import { assertNavMatchesContent } from '../lib/docs';

export const metadata: Metadata = {
  title: { default: 'Raven Docs', template: '%s — Raven Docs' },
  description: 'Guides and reference for building on Raven — real-time video, audio, and chat.',
};

// Fails the build loudly if the sidebar ever points at a page that
// doesn't exist — a dead nav link is a bug, not a 404 to discover later.
assertNavMatchesContent();

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
