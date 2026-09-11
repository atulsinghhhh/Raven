import { DOCS_ROUTES, DOCS_URL } from '../lib/links';

/**
 * The platform beat: a narrow left column of claims against an
 * isometric wireframe of the architecture bleeding off the right edge.
 *
 * The diagram is the same node graph the old standalone Architecture
 * section drew head-on, re-projected with a CSS 3D transform rather
 * than redrawn as isometric SVG: one source of truth for what
 * connects to what, and the projection stays a presentation detail.
 *
 * Every line in the checklist is shipped and has a doc page behind it.
 */
const CAPABILITIES = [
  { icon: <StackIcon />, text: 'One control plane for RTC, Chat, Live Streaming, and Effects' },
  { icon: <KeyIcon />, text: 'Short-lived scoped tokens — your API key never leaves your backend' },
  { icon: <CodeIcon />, text: 'SDKs for web, React, React Native, Flutter, Node.js, and Python' },
  { icon: <TerminalIcon />, text: 'A CLI for projects, keys, and tokens' },
  { icon: <BoltIcon />, text: 'Webhooks for room, message, and stream lifecycle events' },
  { icon: <LayersIcon />, text: 'Isolated development, staging, and production environments' },
  { icon: <PulseIcon />, text: 'Real WebRTC diagnostics — RTT, jitter, packet loss, bitrate, codec' },
];

export function Platform() {
  return (
    <section className="relative overflow-hidden border-t border-line py-24 md:py-32">
      {/* Sits behind the diagram and fades out before it reaches the
          text column, so the checklist never reads over graph paper. */}
      <div
        className="grid-band pointer-events-none absolute inset-y-0 right-0 hidden w-2/3 opacity-40 lg:block"
        style={{ maskImage: 'linear-gradient(to right, transparent, black 40%)' }}
        aria-hidden="true"
      />

      <IsoDiagram />

      <div className="relative mx-auto max-w-6xl px-6">
        <div className="max-w-lg">
          <span className="mono-label text-[11px] text-muted">Developer platform</span>
          <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
            The complete stack for <span className="kw">real-time</span>
          </h2>

          <ul className="mt-8 flex flex-col gap-3.5">
            {CAPABILITIES.map((capability) => (
              <li key={capability.text} className="flex items-start gap-3 text-sm leading-relaxed text-muted">
                <span className="mt-0.5 shrink-0 text-accent">{capability.icon}</span>
                {capability.text}
              </li>
            ))}
          </ul>

          <div className="mt-9 flex flex-wrap gap-2.5">
            <a
              href={DOCS_URL}
              className="rounded-(--radius-panel) border border-accent-line px-3.5 py-2 text-[13px] font-medium text-fg transition-colors hover:border-accent-text"
            >
              Explore the documentation
            </a>
            <a
              href={DOCS_ROUTES.quickstart}
              className="rounded-(--radius-panel) border border-accent-line px-3.5 py-2 text-[13px] font-medium text-fg transition-colors hover:border-accent-text"
            >
              Quickstart
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * The architecture graph, projected isometrically. Hidden below lg;
 * at tablet width there is no room beside the text column for it to
 * bleed into, and a squashed isometric diagram is worse than none.
 */
function IsoDiagram() {
  return (
    <div
      className="pointer-events-none absolute -right-24 top-1/2 hidden w-[46rem] -translate-y-1/2 lg:block"
      style={{ perspective: '1400px' }}
      aria-hidden="true"
    >
      <div style={{ transform: 'rotateX(58deg) rotateZ(-42deg)', transformStyle: 'preserve-3d' }}>
        <ArchitectureDiagram />
      </div>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 480 380" className="w-full opacity-60" role="presentation">
      <defs>
        <radialGradient id="arch-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent-line)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent-line)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Wires, drawn before nodes so nodes sit on top */}
      <path d="M 240 64 L 240 96" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 240 140 L 240 172" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 240 216 C 240 232, 95 232, 95 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 240 216 L 240 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 240 216 C 240 232, 385 232, 385 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 95 292 C 95 308, 240 308, 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 240 292 L 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path d="M 385 292 C 385 308, 240 308, 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />

      {/* Traveling pulses — pure CSS via offset-path, same technique as the hero diagram */}
      {[
        { path: 'M 240 64 L 240 96', delay: '0s' },
        { path: 'M 240 140 L 240 172', delay: '0.3s' },
        { path: 'M 240 216 C 240 232, 95 232, 95 248', delay: '0.6s' },
        { path: 'M 240 216 L 240 248', delay: '0.6s' },
        { path: 'M 240 216 C 240 232, 385 232, 385 248', delay: '0.6s' },
        { path: 'M 95 292 C 95 308, 240 308, 240 324', delay: '1.1s' },
        { path: 'M 240 292 L 240 324', delay: '1.1s' },
        { path: 'M 385 292 C 385 308, 240 308, 240 324', delay: '1.1s' },
      ].map((p, i) => (
        <circle
          key={i}
          r="4"
          fill="var(--accent)"
          className="arch-pulse"
          style={{ offsetPath: `path('${p.path}')`, animationDelay: p.delay }}
        />
      ))}

      <ArchNode x={170} y={20} label="Your Application" tone="fg" />
      <ArchNode x={170} y={96} label="Livqeno SDK" tone="fg" />
      <g transform="translate(170, 172)">
        <circle cx="70" cy="22" r="60" fill="url(#arch-glow)" />
      </g>
      <ArchNode x={170} y={172} label="Livqeno API" tone="accent" />
      <ArchNode x={40} y={248} w={110} label="RTC" tone="accent" />
      <ArchNode x={185} y={248} w={110} label="Chat" tone="accent" />
      <ArchNode x={330} y={248} w={110} label="Live" tone="accent" />
      <ArchNode x={170} y={324} label="Users" tone="fg" />

      <style>{`
        .arch-pulse {
          offset-distance: 0%;
          animation: arch-travel 2.2s ease-in-out infinite;
        }
        @keyframes arch-travel {
          0% { offset-distance: 0%; opacity: 0; }
          10% { opacity: 1; }
          85% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
      `}</style>
    </svg>
  );
}

function ArchNode({
  x,
  y,
  w = 140,
  label,
  tone,
}: {
  x: number;
  y: number;
  w?: number;
  label: string;
  tone: 'fg' | 'accent';
}) {
  const isAccent = tone === 'accent';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={w}
        height="44"
        rx="4"
        fill={isAccent ? 'var(--accent-subtle)' : 'var(--surface)'}
        stroke={isAccent ? 'var(--accent-line)' : 'var(--line-strong)'}
        strokeWidth="1.5"
      />
      <text
        x={w / 2}
        y="27"
        textAnchor="middle"
        fontSize="12"
        fontWeight="500"
        fill={isAccent ? 'var(--accent-text)' : 'var(--fg)'}
        fontFamily="var(--font-mono)"
        letterSpacing="0.02em"
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}

function StackIcon() {
  return (
    <Glyph>
      <path d="M8 2 14 5.2 8 8.4 2 5.2 8 2Z" strokeLinejoin="round" />
      <path d="M2 8.4 8 11.6 14 8.4M2 11.2 8 14.4 14 11.2" strokeLinejoin="round" />
    </Glyph>
  );
}

function KeyIcon() {
  return (
    <Glyph>
      <circle cx="5.5" cy="10.5" r="2.8" />
      <path d="M7.6 8.4 13 3M11 3h2.4v2.4" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

function CodeIcon() {
  return (
    <Glyph>
      <path d="M5.6 5 2.4 8l3.2 3M10.4 5 13.6 8l-3.2 3" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

function TerminalIcon() {
  return (
    <Glyph>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M4.6 7 6.4 8.6 4.6 10.2M8.4 10.4h3" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

function BoltIcon() {
  return (
    <Glyph>
      <path d="M9 2 4 9h3.4L7 14l5-7H8.6L9 2Z" strokeLinejoin="round" />
    </Glyph>
  );
}

function LayersIcon() {
  return (
    <Glyph>
      <rect x="2" y="2.5" width="12" height="3.4" rx="1" />
      <rect x="2" y="7.3" width="12" height="3.4" rx="1" />
      <path d="M3.6 12.6h8.8" strokeLinecap="round" />
    </Glyph>
  );
}

function PulseIcon() {
  return (
    <Glyph>
      <path d="M2 8.4h2.8L6.2 5l2 6.4 1.6-3h4.2" strokeLinecap="round" strokeLinejoin="round" />
    </Glyph>
  );
}

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {children}
    </svg>
  );
}
