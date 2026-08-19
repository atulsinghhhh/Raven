import { Reveal } from './Reveal';

/**
 * "You build the experience, Raven handles the real-time layer" as a
 * diagram — deliberately stops at the three products. What runs
 * underneath (signaling, SFU, TURN, the datastore) is Raven's problem,
 * not something a visitor evaluating the SDK needs to reason about.
 */
export function Architecture() {
  return (
    <section className="border-t border-line py-24">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-light tracking-tight text-fg md:text-4xl">
              You build the experience.
              <br />
              Raven handles the real-time layer.
            </h2>
          </div>
        </Reveal>

        <Reveal delayMs={100}>
          <div className="mt-14">
            <ArchitectureDiagram />
            <p className="mono-label mt-6 text-center text-[11px] text-subtle">
              Effects runs inside the SDK, client-side — no extra round trip through the Raven API.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 480 380" className="mx-auto w-full max-w-2xl" role="img" aria-label="Your application connects through the Raven SDK and Raven API to RTC, Chat, and Live Streaming, reaching your users">
      <defs>
        <radialGradient id="arch-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Wires, drawn before nodes so nodes sit on top */}
      <path id="arch-app-sdk" d="M 240 64 L 240 96" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-sdk-api" d="M 240 140 L 240 172" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-api-rtc" d="M 240 216 C 240 232, 95 232, 95 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-api-chat" d="M 240 216 L 240 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-api-live" d="M 240 216 C 240 232, 385 232, 385 248" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-rtc-users" d="M 95 292 C 95 308, 240 308, 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-chat-users" d="M 240 292 L 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="arch-live-users" d="M 385 292 C 385 308, 240 308, 240 324" fill="none" stroke="var(--line-strong)" strokeWidth="2" />

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
        <circle key={i} r="3.5" fill="var(--accent)" className="arch-pulse" style={{ offsetPath: `path('${p.path}')`, animationDelay: p.delay }} />
      ))}

      {/* Your Application */}
      <ArchNode x={170} y={20} label="Your Application" tone="fg" />
      {/* Raven SDK */}
      <ArchNode x={170} y={96} label="Raven SDK" tone="fg" />
      {/* Raven API — the hub, gets the glow */}
      <g transform="translate(170, 172)">
        <circle cx="70" cy="22" r="60" fill="url(#arch-glow)" />
      </g>
      <ArchNode x={170} y={172} label="Raven API" tone="accent" />

      {/* Product row */}
      <ArchNode x={40} y={248} w={110} label="RTC" tone="accent" />
      <ArchNode x={185} y={248} w={110} label="Chat" tone="accent" />
      <ArchNode x={330} y={248} w={110} label="Live Streaming" tone="accent" />

      {/* Users */}
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

function ArchNode({ x, y, w = 140, label, tone }: { x: number; y: number; w?: number; label: string; tone: 'fg' | 'accent' }) {
  const isAccent = tone === 'accent';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={w}
        height="44"
        rx="6"
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
