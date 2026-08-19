import type { Metadata } from 'next';
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

/**
 * Same before-first-paint theme resolution as the dashboard (see
 * apps/dashboard/src/app/layout.tsx) — a marketing site that flashes
 * between themes on load looks exactly as unfinished as a product that does.
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
