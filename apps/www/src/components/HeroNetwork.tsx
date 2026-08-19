/**
 * The hero's brand animation: your app connects through Raven to its
 * three real-time products, which reach your users. Same technique as
 * Architecture.tsx — pure SVG + CSS `offset-path` for traveling packets,
 * no canvas or animation library, so it plays from CSS alone before
 * hydration and respects prefers-reduced-motion via the global override
 * in globals.css.
 *
 * This is an original diagram built around Raven's own product lineup,
 * not traced from another product's hero graphic.
 */
const EDGES = [
  { id: 'app-raven', d: 'M 400 34 L 400 84', delay: '0s' },
  { id: 'raven-rtc', d: 'M 400 152 C 400 190, 160 190, 160 228', delay: '0.35s' },
  { id: 'raven-chat', d: 'M 400 152 L 400 228', delay: '0.5s' },
  { id: 'raven-live', d: 'M 400 152 C 400 190, 640 190, 640 228', delay: '0.65s' },
  { id: 'rtc-users', d: 'M 160 272 C 160 306, 400 306, 400 336', delay: '1.05s' },
  { id: 'chat-users', d: 'M 400 272 L 400 336', delay: '1.15s' },
  { id: 'live-users', d: 'M 640 272 C 640 306, 400 306, 400 336', delay: '1.25s' },
];

export function HeroNetwork() {
  return (
    <div className="relative">
      <svg
        viewBox="0 0 800 380"
        className="mx-auto w-full max-w-3xl"
        role="img"
        aria-label="Your application connects through Raven to RTC, Chat, and Live Streaming, which reach your users"
      >
        <defs>
          <radialGradient id="raven-hub-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {EDGES.map((edge) => (
          <path key={edge.id} d={edge.d} fill="none" stroke="var(--line-strong)" strokeWidth="1.5" />
        ))}

        {EDGES.map((edge) => (
          <circle
            key={`pulse-${edge.id}`}
            r="3"
            fill="var(--accent)"
            className="raven-net-pulse"
            style={{ offsetPath: `path('${edge.d}')`, animationDelay: edge.delay }}
          />
        ))}

        {/* Developer App */}
        <Node x={330} y={4} w={140} label="Developer App" />

        {/* Raven hub */}
        <g transform="translate(340, 84)">
          <circle cx="60" cy="34" r="70" fill="url(#raven-hub-glow)" className="raven-net-hub-glow" />
        </g>
        <Node x={330} y={84} w={140} label="RAVEN" tone="accent" />

        {/* Products */}
        <Node x={90} y={228} w={140} label="RTC" tone="accent">
          <ActivityBars />
        </Node>
        <Node x={330} y={228} w={140} label="Chat" tone="accent">
          <ActivityDots />
        </Node>
        <Node x={570} y={228} w={140} label="Live" tone="accent">
          <ActivityPulse />
        </Node>

        {/* Users */}
        <Node x={330} y={336} w={140} label="Users" />
      </svg>

      <style>{`
        .raven-net-pulse {
          offset-distance: 0%;
          animation: raven-travel 2.6s ease-in-out infinite;
        }
        .raven-net-hub-glow {
          animation: raven-pulse 3s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .raven-net-pulse { animation: none; opacity: 0; }
          .raven-net-hub-glow { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Node({
  x,
  y,
  w,
  label,
  tone = 'fg',
  children,
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  tone?: 'fg' | 'accent';
  children?: React.ReactNode;
}) {
  const isAccent = tone === 'accent';
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect
        width={w}
        height="50"
        rx="6"
        fill={isAccent ? 'var(--accent-subtle)' : 'var(--surface)'}
        stroke={isAccent ? 'var(--accent-line)' : 'var(--line-strong)'}
        strokeWidth="1.5"
      />
      <text
        x={w / 2}
        y="24"
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="500"
        fill={isAccent ? 'var(--accent-text)' : 'var(--fg)'}
        fontFamily="var(--font-mono)"
        letterSpacing="0.04em"
      >
        {label.toUpperCase()}
      </text>
      {children && <g transform={`translate(${w / 2}, 32)`}>{children}</g>}
    </g>
  );
}

/** RTC: three participant audio levels, one active — same idea as RTCSection's live room preview. */
function ActivityBars() {
  return (
    <g transform="translate(-10, 0)" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={i * 8}
          y="-5"
          width="3"
          height="10"
          rx="1.5"
          fill="var(--accent)"
          className="raven-net-bar"
          style={{ animationDelay: `${i * 0.15}s`, transformOrigin: `${i * 8 + 1.5}px 5px` }}
        />
      ))}
      <style>{`
        .raven-net-bar { animation: raven-net-level 0.9s ease-in-out infinite; }
        @keyframes raven-net-level { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }
        @media (prefers-reduced-motion: reduce) { .raven-net-bar { animation: none; transform: scaleY(0.7); } }
      `}</style>
    </g>
  );
}

/** Chat: a typing-dots trio, same motif as ChatSection's thread preview. */
function ActivityDots() {
  return (
    <g transform="translate(-9, 0)" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={i * 9} cy="0" r="2" fill="var(--accent)" className="raven-net-dot" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
      <style>{`
        .raven-net-dot { animation: raven-net-typing 1.1s ease-in-out infinite; }
        @keyframes raven-net-typing { 0%, 60%, 100% { opacity: 0.35; } 30% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .raven-net-dot { animation: none; opacity: 0.8; } }
      `}</style>
    </g>
  );
}

/** Live: a single pulsing viewer indicator, echoing LiveStreamingSection's "LIVE" dot. */
function ActivityPulse() {
  return (
    <g aria-hidden="true">
      <circle r="6" fill="var(--accent)" opacity="0.25" className="raven-net-ring" />
      <circle r="2.5" fill="var(--accent)" />
      <style>{`
        .raven-net-ring { animation: raven-net-ring 1.6s ease-out infinite; }
        @keyframes raven-net-ring { 0% { r: 2.5; opacity: 0.5; } 100% { r: 9; opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .raven-net-ring { animation: none; opacity: 0; } }
      `}</style>
    </g>
  );
}
