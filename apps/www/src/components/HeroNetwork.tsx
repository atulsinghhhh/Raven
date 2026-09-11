/**
 * The hero's brand animation: Livqeno as the infrastructure layer between
 * an application and its users. Web, mobile, and backend clients feed a
 * glowing central Livqeno core; the core fans out to the four realtime
 * capabilities (audio, video, chat, live); each capability reaches the
 * user cluster on the far side. Packets travel every edge continuously.
 *
 * Pure SVG + CSS `offset-path` — no canvas, no animation library — so
 * it plays from CSS alone before hydration, costs nothing on the main
 * thread, and respects prefers-reduced-motion via the global override
 * in globals.css. Live-stream traffic runs in the `--live` hue; every
 * other packet is the accent. That two-hue rule is the whole color
 * story of the diagram.
 */

const CORE = { x: 480, y: 217 };

/** Application → Livqeno core. */
const IN_EDGES = [
  { id: 'web-core', d: 'M 160 92 C 300 92 340 217 412 217', delay: 0 },
  { id: 'mobile-core', d: 'M 160 217 L 412 217', delay: 0.5 },
  { id: 'backend-core', d: 'M 160 342 C 300 342 340 217 412 217', delay: 1.0 },
];

/** Livqeno core → capability. LIVE runs hot. */
const OUT_EDGES = [
  { id: 'core-audio', d: 'M 548 217 C 585 217 572 62 610 62', delay: 0.35, live: false },
  { id: 'core-video', d: 'M 548 217 C 585 217 578 165 610 165', delay: 0.85, live: false },
  { id: 'core-chat', d: 'M 548 217 C 585 217 578 268 610 268', delay: 1.35, live: false },
  { id: 'core-live', d: 'M 548 217 C 585 217 572 371 610 371', delay: 1.85, live: true },
];

/** Capability → users. */
const USER_EDGES = [
  { id: 'audio-users', d: 'M 710 62 C 790 62 800 110 850 110', delay: 1.1, live: false },
  { id: 'video-users', d: 'M 710 165 C 790 165 800 180 850 180', delay: 1.6, live: false },
  { id: 'chat-users', d: 'M 710 268 C 790 268 800 252 850 252', delay: 2.1, live: false },
  { id: 'live-users', d: 'M 710 371 C 790 371 800 322 850 322', delay: 2.6, live: true },
];

const USERS = [
  { x: 856, y: 110 },
  { x: 896, y: 145 },
  { x: 856, y: 180 },
  { x: 856, y: 252 },
  { x: 896, y: 287 },
  { x: 856, y: 322 },
];

export function HeroNetwork() {
  const edges = [...IN_EDGES.map((e) => ({ ...e, live: false })), ...OUT_EDGES, ...USER_EDGES];

  return (
    <div className="relative">
      {/* Faint dot lattice under the topology, faded radially so it
          reads as depth, not wallpaper. */}
      <div
        className="dot-band pointer-events-none absolute inset-0 opacity-35"
        style={{ maskImage: 'radial-gradient(42rem 20rem at 50% 50%, black, transparent 78%)' }}
        aria-hidden="true"
      />

      <svg
        viewBox="0 0 960 440"
        className="relative mx-auto w-full max-w-4xl"
        role="img"
        aria-label="Web, mobile, and backend applications connect through the Livqeno core to audio, video, chat, and live streaming, which reach your users"
      >
        <defs>
          <radialGradient id="raven-core-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--accent-line)" stopOpacity="0.28" />
            <stop offset="60%" stopColor="var(--accent-line)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--accent-line)" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ColumnLabel x={100} label="Your application" />
        <ColumnLabel x={876} label="Your users" />

        {edges.map((edge) => (
          <path
            key={edge.id}
            d={edge.d}
            fill="none"
            stroke={edge.live ? 'var(--live-line)' : 'var(--line-strong)'}
            strokeWidth="1.5"
          />
        ))}

        {/* Traveling packets — two per wire, half a cycle apart */}
        {edges.map((edge) =>
          [0, 1].map((n) => (
            <circle
              key={`pkt-${edge.id}-${n}`}
              r="3"
              fill={edge.live ? 'var(--live)' : 'var(--accent)'}
              className="raven-net-pulse"
              style={{ offsetPath: `path('${edge.d}')`, animationDelay: `${edge.delay + n * 1.6}s` }}
            />
          )),
        )}

        <Chip x={40} y={74} w={120} label="Web" />
        <Chip x={40} y={199} w={120} label="Mobile" />
        <Chip x={40} y={324} w={120} label="Backend" />

        <g>
          <circle cx={CORE.x} cy={CORE.y} r="130" fill="url(#raven-core-glow)" className="raven-net-glow" />
          <circle
            cx={CORE.x}
            cy={CORE.y}
            r="34"
            fill="none"
            stroke="var(--accent-line)"
            className="raven-net-ring"
            opacity="0"
          />
          <g transform={`translate(${CORE.x}, ${CORE.y})`}>
            {/* Dashed orbit — spinning the dash pattern reads as slow rotation */}
            <circle
              r="58"
              fill="none"
              stroke="var(--accent-line)"
              strokeWidth="1"
              strokeDasharray="2 7"
              className="raven-net-orbit"
            />
            <g className="raven-net-orbit-dot">
              <circle cx="58" cy="0" r="2.5" fill="var(--accent)" />
            </g>
            <circle r="34" fill="var(--surface-raised)" stroke="var(--accent-line)" strokeWidth="1.5" />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="11.5"
              fontWeight="500"
              fill="var(--accent-text)"
              fontFamily="var(--font-mono)"
              letterSpacing="0.1em"
            >
              Livqeno
            </text>
          </g>
        </g>

        <Chip x={610} y={44} w={100} label="Audio" tone="accent" />
        <Chip x={610} y={147} w={100} label="Video" tone="accent" />
        <Chip x={610} y={250} w={100} label="Chat" tone="accent" />
        <Chip x={610} y={353} w={100} label="Live" tone="live" />

        {USERS.map((user, i) => (
          <g key={i} transform={`translate(${user.x}, ${user.y})`}>
            <circle r="9" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.25" />
            <circle cy="-2" r="2.6" fill="var(--fg-subtle)" />
            <path d="M -4.4 5.4 C -4.4 1.6 4.4 1.6 4.4 5.4" fill="var(--fg-subtle)" />
          </g>
        ))}
      </svg>

      <style>{`
        .raven-net-pulse {
          offset-distance: 0%;
          animation: raven-travel 3.2s ease-in-out infinite;
        }
        .raven-net-glow {
          animation: raven-pulse 4s ease-in-out infinite;
        }
        .raven-net-ring {
          animation: raven-net-ring 3s ease-out infinite;
        }
        @keyframes raven-net-ring {
          0% { r: 34; opacity: 0.45; }
          100% { r: 96; opacity: 0; }
        }
        .raven-net-orbit {
          animation: raven-net-spin 24s linear infinite;
        }
        .raven-net-orbit-dot {
          animation: raven-net-spin 12s linear infinite;
        }
        @keyframes raven-net-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .raven-net-pulse { animation: none; opacity: 0; }
          .raven-net-glow, .raven-net-ring, .raven-net-orbit, .raven-net-orbit-dot { animation: none; }
        }
      `}</style>
    </div>
  );
}

function ColumnLabel({ x, label }: { x: number; label: string }) {
  return (
    <text
      x={x}
      y="16"
      textAnchor="middle"
      fontSize="9.5"
      fill="var(--fg-subtle)"
      fontFamily="var(--font-mono)"
      letterSpacing="0.12em"
    >
      {label.toUpperCase()}
    </text>
  );
}

function Chip({
  x,
  y,
  w,
  label,
  tone = 'fg',
}: {
  x: number;
  y: number;
  w: number;
  label: string;
  tone?: 'fg' | 'accent' | 'live';
}) {
  const fill = tone === 'accent' ? 'var(--accent-subtle)' : tone === 'live' ? 'var(--live-subtle)' : 'var(--surface)';
  const stroke = tone === 'accent' ? 'var(--accent-line)' : tone === 'live' ? 'var(--live-line)' : 'var(--line-strong)';
  const text = tone === 'accent' ? 'var(--accent-text)' : tone === 'live' ? 'var(--live-text)' : 'var(--fg)';

  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect width={w} height="36" rx="4" fill={fill} stroke={stroke} strokeWidth="1.5" />
      {tone === 'live' && <circle cx="16" cy="18" r="2.5" fill="var(--live)" className="animate-pulse-dot" />}
      <text
        x={tone === 'live' ? w / 2 + 6 : w / 2}
        y="22"
        textAnchor="middle"
        fontSize="11.5"
        fontWeight="500"
        fill={text}
        fontFamily="var(--font-mono)"
        letterSpacing="0.06em"
      >
        {label.toUpperCase()}
      </text>
    </g>
  );
}
