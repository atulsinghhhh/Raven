/**
 * The hero's animated visual: a backend minting a token, and two clients
 * joining the same room through it. Pure SVG + CSS `offset-path` motion —
 * no canvas, no animation library. Server-rendered; the animation runs
 * from CSS alone, so it plays even before hydration.
 *
 * This is an original layout, not traced from another product's diagram —
 * see the note on why in the commit that added it.
 */
export function ConnectionDiagram() {
  return (
    <svg
      viewBox="0 0 480 280"
      className="w-full max-w-lg mx-auto"
      role="img"
      aria-label="A backend server minting a token, with two clients connecting to a shared room through Raven"
    >
      <defs>
        <linearGradient id="raven-wire" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent-line)" />
          <stop offset="100%" stopColor="var(--accent)" />
        </linearGradient>
        <radialGradient id="raven-node-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Wires: backend -> room, room -> client A, room -> client B */}
      <path id="wire-backend" d="M 90 60 C 150 60, 150 140, 210 140" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="wire-a" d="M 270 140 C 320 140, 320 60, 370 60" fill="none" stroke="var(--line-strong)" strokeWidth="2" />
      <path id="wire-b" d="M 270 140 C 320 140, 320 220, 370 220" fill="none" stroke="var(--line-strong)" strokeWidth="2" />

      {/* Traveling pulses along each wire — offset-path keeps this to pure CSS, no JS/RAF loop. */}
      <circle r="4" fill="var(--accent)" className="raven-pulse-a" style={{ offsetPath: "path('M 90 60 C 150 60, 150 140, 210 140')" }} />
      <circle r="4" fill="var(--accent)" className="raven-pulse-b" style={{ offsetPath: "path('M 270 140 C 320 140, 320 60, 370 60')" }} />
      <circle r="4" fill="var(--accent)" className="raven-pulse-c" style={{ offsetPath: "path('M 270 140 C 320 140, 320 220, 370 220')" }} />

      {/* Backend node */}
      <g transform="translate(30, 40)">
        <rect width="60" height="40" rx="8" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <rect x="10" y="10" width="40" height="4" rx="2" fill="var(--fg-subtle)" />
        <rect x="10" y="18" width="28" height="4" rx="2" fill="var(--fg-subtle)" />
        <rect x="10" y="26" width="34" height="4" rx="2" fill="var(--fg-subtle)" />
        <text x="30" y="-8" textAnchor="middle" fontSize="11" fill="var(--fg-muted)" fontFamily="var(--font-mono)">
          your backend
        </text>
      </g>

      {/* Raven room node — the hub */}
      <g transform="translate(210, 110)">
        <circle cx="30" cy="30" r="46" fill="url(#raven-node-glow)" />
        <rect width="60" height="60" rx="14" fill="var(--accent-subtle)" stroke="var(--accent-line)" strokeWidth="1.5" />
        <circle cx="22" cy="24" r="5" fill="var(--accent)" />
        <circle cx="38" cy="24" r="5" fill="var(--accent)" />
        <path d="M 18 40 Q 30 48 42 40" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" />
        <text x="30" y="78" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent-text)" fontFamily="var(--font-mono)">
          raven room
        </text>
      </g>

      {/* Client A */}
      <g transform="translate(370, 40)">
        <rect width="60" height="40" rx="8" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <circle cx="30" cy="16" r="7" fill="var(--fg-subtle)" />
        <path d="M 16 32 Q 30 20 44 32" fill="var(--fg-subtle)" />
        <text x="30" y="-8" textAnchor="middle" fontSize="11" fill="var(--fg-muted)" fontFamily="var(--font-mono)">
          client A
        </text>
      </g>

      {/* Client B */}
      <g transform="translate(370, 200)">
        <rect width="60" height="40" rx="8" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
        <circle cx="30" cy="16" r="7" fill="var(--fg-subtle)" />
        <path d="M 16 32 Q 30 20 44 32" fill="var(--fg-subtle)" />
        <text x="30" y="52" textAnchor="middle" fontSize="11" fill="var(--fg-muted)" fontFamily="var(--font-mono)">
          client B
        </text>
      </g>

      <style>{`
        .raven-pulse-a, .raven-pulse-b, .raven-pulse-c {
          offset-distance: 0%;
          animation: raven-travel 2.4s linear infinite;
        }
        .raven-pulse-b { animation-delay: 0.9s; }
        .raven-pulse-c { animation-delay: 1.5s; }
        @keyframes raven-travel {
          0% { offset-distance: 0%; opacity: 0; }
          8% { opacity: 1; }
          92% { opacity: 1; }
          100% { offset-distance: 100%; opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .raven-pulse-a, .raven-pulse-b, .raven-pulse-c { animation: none; opacity: 0; }
        }
      `}</style>
    </svg>
  );
}
