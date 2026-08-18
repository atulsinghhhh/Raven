import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Raven — Developer Dashboard',
  description: 'Manage projects, API keys, rooms, and usage for Raven RTC infrastructure.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased font-sans">{children}</body>
    </html>
  );
}
