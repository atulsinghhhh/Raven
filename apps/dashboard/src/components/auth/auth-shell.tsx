import Link from 'next/link';
import type { ReactNode } from 'react';
import { RavenMark } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

/**
 * One frame for every auth surface — sign in, sign up, forgot/reset
 * password, verify email — so they read as a single product instead of
 * five ad-hoc pages.
 *
 * Two-column on desktop: a quiet brand panel that says what Raven is, and
 * the form. The panel is presentation only (aria-hidden) — everything a
 * screen reader needs lives in the form column, and on mobile the panel
 * simply isn't rendered.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="auth-backdrop flex min-h-screen">
      <aside
        aria-hidden
        className="hidden w-[44%] max-w-xl flex-col justify-between border-r border-line p-10 lg:flex"
      >
        <Link href="/" className="flex w-fit items-center gap-2.5">
          <RavenMark className="size-7" />
          <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
        </Link>

        <div>
          <p className="display text-3xl leading-snug text-fg">
            Realtime infrastructure
            <br />
            for your applications.
          </p>
          <ul className="mt-10 flex flex-col gap-6">
            <BrandPillar
              label="RTC"
              description="Voice and video over a global SFU fleet, with observability built in."
            />
            <BrandPillar label="Chat" description="Persistent realtime messaging with presence, typing, and webhooks." />
            <BrandPillar label="Live Streaming" description="Broadcast to large audiences with host controls and live chat." />
          </ul>
        </div>

        <p className="text-xs text-subtle">Open-source realtime infrastructure — control plane and RTC plane.</p>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <header className="flex flex-col items-start">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <RavenMark className="size-7" />
              <span className="text-base font-semibold tracking-tight text-fg">Raven</span>
            </Link>
            <h1 className="mt-6 text-2xl font-semibold tracking-tight text-fg lg:mt-0">{title}</h1>
            {subtitle && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>}
          </header>

          <div className="mt-8">{children}</div>

          {footer && <div className="mt-6 flex flex-col gap-2 text-sm text-muted">{footer}</div>}
        </div>

        <footer className="mt-10">
          <a
            href={DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-subtle transition-colors hover:text-muted"
          >
            Documentation
          </a>
        </footer>
      </div>
    </main>
  );
}

function BrandPillar({ label, description }: { label: string; description: string }) {
  return (
    <li className="flex flex-col gap-1 border-l-2 border-accent-line pl-4">
      <span className="mono-label text-xs text-accent-text">{label}</span>
      <span className="max-w-xs text-sm leading-relaxed text-muted">{description}</span>
    </li>
  );
}
