/**
 * Hand-rolled 16px icon set: no icon package. Every icon here is used by
 * the shell or a page; the whole file is smaller than the import cost of
 * a tree-shaken icon library, and the stroke weight stays consistent
 * because there's only one source.
 */
type IconProps = { className?: string };

function Svg({ className = 'size-4', children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Svg>
);

export const IconRooms = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.5" />
    <path d="M5 13v1.25M11 13v1.25M4 6.25h3" />
  </Svg>
);

export const IconConnections = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="3.5" cy="8" r="1.75" />
    <circle cx="12.5" cy="4" r="1.75" />
    <circle cx="12.5" cy="12" r="1.75" />
    <path d="M5.1 7.2l5.9-2.4M5.1 8.8l5.9 2.4" />
  </Svg>
);

export const IconParticipants = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="6" cy="5.5" r="2.25" />
    <path d="M1.75 13.5c0-2.2 1.9-3.75 4.25-3.75s4.25 1.55 4.25 3.75" />
    <path d="M10.75 4.1a2.25 2.25 0 010 4.3M12 10.2c1.4.45 2.25 1.6 2.25 3.3" />
  </Svg>
);

export const IconMetrics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 13.5h12" />
    <path d="M4 13.5V9M7.3 13.5V5.5M10.7 13.5V7.5M14 13.5V3.5" />
  </Svg>
);

export const IconErrors = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7.1 2.6L1.6 12a1 1 0 00.9 1.5h11a1 1 0 00.9-1.5L8.9 2.6a1 1 0 00-1.8 0z" />
    <path d="M8 6.2v2.6M8 11.2h.01" />
  </Svg>
);

export const IconDiagnostics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 8h2.6l1.4-3.4 2.6 6.8L9.9 8h4.35" />
  </Svg>
);

export const IconKeys = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.25" cy="10.75" r="3" />
    <path d="M7.4 8.6L13 3M10.75 5.25l1.5 1.5M12.25 3.75l1.5 1.5" />
  </Svg>
);

export const IconSdk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5.5 11.5L2 8l3.5-3.5M10.5 4.5L14 8l-3.5 3.5" />
  </Svg>
);

export const IconQuickstart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 1.75c2.6 1.2 4.25 4 4.25 7.1 0 .9-.15 1.75-.4 2.55H3.65a8.2 8.2 0 01-.4-2.55c0-3.1 1.65-5.9 4.25-7.1a1 1 0 011 0z" />
    <circle cx="8" cy="6.5" r="1.5" />
    <path d="M6 11.4l-1.25 2.85M10 11.4l1.25 2.85" />
  </Svg>
);

export const IconUsage = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14.25 8A6.25 6.25 0 111.75 8" />
    <path d="M8 8l3.5-2.5" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M13 9.6a1 1 0 00.2 1.1l.05.05a1.2 1.2 0 11-1.7 1.7l-.05-.05a1 1 0 00-1.1-.2 1 1 0 00-.6.9v.15a1.2 1.2 0 01-2.4 0v-.08a1 1 0 00-.65-.9 1 1 0 00-1.1.2l-.05.05a1.2 1.2 0 11-1.7-1.7l.05-.05a1 1 0 00.2-1.1 1 1 0 00-.9-.6H2.9a1.2 1.2 0 010-2.4h.08a1 1 0 00.9-.65 1 1 0 00-.2-1.1l-.05-.05a1.2 1.2 0 111.7-1.7l.05.05a1 1 0 001.1.2h.05a1 1 0 00.6-.9V2.9a1.2 1.2 0 012.4 0v.08a1 1 0 00.6.9 1 1 0 001.1-.2l.05-.05a1.2 1.2 0 111.7 1.7l-.05.05a1 1 0 00-.2 1.1v.05a1 1 0 00.9.6h.15a1.2 1.2 0 010 2.4h-.08a1 1 0 00-.9.6z" />
  </Svg>
);

export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 9.5a2 2 0 01-2 2H5.5L2 14V4a2 2 0 012-2h8a2 2 0 012 2z" />
    <path d="M5.25 6.25h5.5M5.25 8.5h3.5" />
  </Svg>
);

export const IconConversations = (p: IconProps) => (
  <Svg {...p}>
    <path d="M11.25 8.75a1.75 1.75 0 01-1.75 1.75H5L2.25 12.5V4a1.75 1.75 0 011.75-1.75h5.5A1.75 1.75 0 0111.25 4z" />
    <path d="M13 6.5h.25A1.75 1.75 0 0115 8.25v6L12.5 12.5H7" />
  </Svg>
);

export const IconWebhooks = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="4.25" cy="11.75" r="2" />
    <circle cx="11.75" cy="11.75" r="2" />
    <circle cx="8" cy="4.25" r="2" />
    <path d="M6.9 5.95L5.15 9.9M9.1 5.95l1.75 3.95M6.25 11.75h3.5" />
  </Svg>
);

export const IconPresence = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M4.1 11.9a5.5 5.5 0 010-7.8M11.9 4.1a5.5 5.5 0 010 7.8" />
  </Svg>
);

/** Live Streaming overview: a play control, distinct from IconStreams' list glyph. */
export const IconLiveStreaming = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6.5 5.5l4 2.5-4 2.5z" />
  </Svg>
);

/** Streams list: a screen with a live dot, distinct from IconRooms' plain rectangle. */
export const IconStreams = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25" />
    <path d="M5.5 14h5" />
    <circle cx="10.75" cy="5.25" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.25" cy="7.25" r="4.75" />
    <path d="M10.75 10.75L14 14" />
  </Svg>
);

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="6.25" />
    <path d="M6.3 6.2a1.75 1.75 0 113.05 1.35c-.6.55-1.35.85-1.35 1.7M8 11.75h.01" />
  </Svg>
);

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5a4 4 0 018 0c0 3.2 1 4.25 1.25 4.75H2.75C3 10.75 4 9.7 4 6.5z" />
    <path d="M6.5 13.25a1.5 1.5 0 003 0" />
  </Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6.5L8 10.5l4-4" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Svg>
);

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.25M8 13.25v1.25M14.5 8h-1.25M2.75 8H1.5M12.6 3.4l-.9.9M4.3 11.7l-.9.9M12.6 12.6l-.9-.9M4.3 4.3l-.9-.9" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13.5 9.4A5.75 5.75 0 116.6 2.5a4.75 4.75 0 006.9 6.9z" />
  </Svg>
);

export const IconSignOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6" />
    <path d="M10.5 11L14 8l-3.5-3M14 8H6" />
  </Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 2.5H13.5V6.5M13.5 2.5L7.5 8.5" />
    <path d="M12 9.5v3A1.5 1.5 0 0110.5 14h-7A1.5 1.5 0 012 12.5v-7A1.5 1.5 0 013.5 4h3" />
  </Svg>
);

export const IconEffects = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M12.5 3.5l-1.4 1.4M4.9 11.1l-1.4 1.4" />
    <circle cx="8" cy="8" r="1.6" />
  </Svg>
);

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M1.75 4.25A1.5 1.5 0 013.25 2.75h2.6a1 1 0 01.8.4l.7.95h5.4a1.5 1.5 0 011.5 1.5v6.15a1.5 1.5 0 01-1.5 1.5H3.25a1.5 1.5 0 01-1.5-1.5z" />
  </Svg>
);

/** Members: two figures, one foregrounded, distinct from IconParticipants' call roster. */
export const IconMembers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="5.75" cy="5.25" r="2.25" />
    <path d="M1.75 13.25c0-2.1 1.8-3.5 4-3.5s4 1.4 4 3.5" />
    <circle cx="11.75" cy="6.5" r="1.75" />
    <path d="M10.5 10.4c2.05-.4 3.75.85 3.75 2.85" />
  </Svg>
);

/** Audit log: a document with ruled lines and a check, i.e. a record of what happened. */
export const IconAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.25 2.75h6.5l3 3v7.5a1 1 0 01-1 1h-8.5a1 1 0 01-1-1v-9.5a1 1 0 011-1z" />
    <path d="M9.5 2.75v3h3" />
    <path d="M5.5 8.5h5M5.5 11h3" />
  </Svg>
);

/** CLI: a terminal prompt with a chevron and cursor. */
export const IconCli = (p: IconProps) => (
  <Svg {...p}>
    <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
    <path d="M4.25 6.25 6.5 8l-2.25 1.75M7.75 9.75h3" />
  </Svg>
);

/** Analytics: a simple bar chart, distinct from IconMetrics' single trend line. */
export const IconAnalytics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.25 13.25h11.5" />
    <rect x="3.25" y="8.25" width="2.25" height="5" rx="0.5" />
    <rect x="6.875" y="5.25" width="2.25" height="8" rx="0.5" />
    <rect x="10.5" y="2.75" width="2.25" height="10.5" rx="0.5" />
  </Svg>
);

/** Logs: stacked lines with a leading timestamp marker, i.e. a scrolling event stream. */
export const IconLogs = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.75 4.25h3M7 4.25h6.25M2.75 8h3M7 8h6.25M2.75 11.75h3M7 11.75h6.25" />
  </Svg>
);

/** Events: a discrete pulse/spark, distinct from IconLogs' continuous lines. */
export const IconEvents = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 1.75 3.5 8.75h3.25L6.25 14.25l5.25-7.5H8.25z" />
  </Svg>
);

/** Raven wordmark glyph: a stylised bird head in a rounded square. */
export const RavenMark = ({ className = 'size-6' }: IconProps) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <rect width="24" height="24" rx="6" className="fill-accent" />
    <path
      d="M6.5 9.2c0-1.4 1.15-2.55 2.55-2.55h3.4c2.2 0 3.98 1.78 3.98 3.98 0 1.5-.83 2.8-2.05 3.48l1.62 2.24a.5.5 0 01-.4.8h-2.1a.9.9 0 01-.73-.38l-1.4-1.94H9.6v1.42a.9.9 0 01-.9.9H7.4a.9.9 0 01-.9-.9z"
      className="fill-accent-fg"
    />
    <circle cx="12.6" cy="10.1" r="1.05" className="fill-accent" />
  </svg>
);
