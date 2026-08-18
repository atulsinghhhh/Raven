import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Raven — Open-source real-time infrastructure',
  description:
    'Audio, video, and chat infrastructure you can self-host. Token-based auth, real diagnostics, and SDKs for web, mobile, and server.',
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
