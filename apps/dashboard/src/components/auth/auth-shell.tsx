import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconChat, IconLiveStreaming, IconRooms, RavenMark } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

/**
 * One frame for every auth surface — sign in, sign up, forgot/reset
 * password, verify email — so they read as a single product instead of
 * five ad-hoc pages.
 *
 * Two-column on desktop: a brand panel that shows what Livqeno is (a code
 * card and the three products), and the form. The panel is presentation
 * only (aria-hidden) — everything a screen reader needs lives in the form
 * column, and on mobile the panel simply isn't rendered.
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
    <main className="flex min-h-screen bg-canvas">
      <aside
        aria-hidden
        className="auth-panel-backdrop relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden border-r border-line p-10 lg:flex"
      >
        <div className="auth-dot-grid absolute inset-0" />

        <Link href="/" className="relative z-10 flex w-fit items-center gap-2.5">
          <RavenMark className="size-7" />
          <span className="text-base font-semibold tracking-tight text-fg">Livqeno</span>
        </Link>

        <div className="relative z-10">
          <p className="display text-3xl leading-snug text-fg xl:text-4xl">
            Realtime infrastructure
            <br />
            for your applications.
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            One project, three products: voice &amp; video, messaging, and live streaming — with the observability to
            run them in production.
          </p>

          <QuickstartCard />

          <ul className="mt-8 flex flex-col gap-3">
            <BrandPillar
              icon={<IconRooms className="size-4" />}
              label="RTC"
              description="Voice and video over a global SFU fleet."
            />
            <BrandPillar
              icon={<IconChat className="size-4" />}
              label="Chat"
              description="Persistent messaging with presence and webhooks."
            />
            <BrandPillar
              icon={<IconLiveStreaming className="size-4" />}
              label="Live Streaming"
              description="Broadcast to large audiences with live chat."
            />
          </ul>
        </div>

        <div className="relative z-10 flex flex-wrap items-center gap-2">
          <TrustChip>Open source</TrustChip>
          <TrustChip>Self-hostable</TrustChip>
          <TrustChip>TypeScript, React, Flutter &amp; Python SDKs</TrustChip>
        </div>
      </aside>

      <div className="auth-backdrop flex min-h-screen flex-1 flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm animate-fade-in">
          <header className="flex flex-col items-start">
            <Link href="/" className="flex items-center gap-2 lg:hidden">
              <RavenMark className="size-7" />
              <span className="text-base font-semibold tracking-tight text-fg">Livqeno</span>
            </Link>
            <h1 className="mt-8 text-2xl font-semibold tracking-tight text-fg lg:mt-0">{title}</h1>
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

/**
 * A five-line taste of the developer experience — the same call the real
 * quickstart teaches, drawn as a code card. Static markup, no highlighter:
 * this is imagery with the panel, not a copy-paste surface.
 */
function QuickstartCard() {
  return (
    <div className="mt-8 max-w-md overflow-hidden rounded-md border border-line bg-canvas/85 shadow-raven-md backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <span className="mono-label text-[10px] text-subtle">quickstart.ts</span>
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-xs leading-6 text-muted">
        <code>
          <span className="text-accent-text">import</span>
          {' { createRTCClient } '}
          <span className="text-accent-text">from</span> <span className="text-success-text">{"'@ravenkash/rtc'"}</span>
          {';\n\n'}
          <span className="text-subtle">{'// grant minted by your backend — never an API key\n'}</span>
          <span className="text-accent-text">const</span>
          {' room = '}
          <span className="text-accent-text">await</span> <span className="text-info-text">createRTCClient</span>
          {'(grant).'}
          <span className="text-info-text">join</span>
          {'(grant.roomName);\n'}
          <span className="text-accent-text">await</span>
          {' room.'}
          <span className="text-info-text">enableCamera</span>
          {'();\n'}
          <span className="text-subtle">{'// video, chat & presence — live.'}</span>
        </code>
      </pre>
    </div>
  );
}

function BrandPillar({ icon, label, description }: { icon: ReactNode; label: string; description: string }) {
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-accent-line bg-accent-subtle text-accent-text">
        {icon}
      </span>
      <span className="text-sm text-muted">
        <span className="font-medium text-fg">{label}</span> — {description}
      </span>
    </li>
  );
}

function TrustChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-muted backdrop-blur-sm">
      {children}
    </span>
  );
}
