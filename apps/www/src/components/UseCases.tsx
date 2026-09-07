/**
 * The horizontal marquee, in the slot the reference fills with customer
 * testimonials. Raven has none to show, and inventing quotes or logos
 * would be the one thing this page must never do — so the same
 * two-row, opposite-direction rail carries what Raven is actually
 * built for instead.
 *
 * Pure CSS: each row holds its list twice and slides exactly half its
 * own width, so the seam never lands in view and there's no JS ticker
 * to drift or leak. Hover or focus anywhere in a row pauses it.
 */
const USE_CASES = [
  { title: 'Video calling', body: '1:1 and group calls without standing up your own SFU.' },
  { title: 'Telehealth', body: 'Video visits with reconnection handled — a dropped signal shouldn’t end an appointment.' },
  { title: 'Education', body: 'Live classes with screen sharing, chat, and participant lists built in.' },
  { title: 'Gaming', body: 'Voice rooms and party chat that reconnect through a lobby switch.' },
  { title: 'Social apps', body: 'Rooms, presence, and reactions for community and creator features.' },
  { title: 'Customer support', body: 'Video and chat escalation from the same conversation a ticket already lives in.' },
  { title: 'Events', body: 'Multi-host video with a live chat conversation attached from the start.' },
  { title: 'Live commerce', body: 'Host-led streams with viewer reactions and moderation on one connection.' },
];

const TOP_ROW = USE_CASES.slice(0, 4);
const BOTTOM_ROW = USE_CASES.slice(4);

export function UseCases() {
  return (
    <section className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <span className="mono-label text-[11px] text-muted">What teams build</span>
        <h2 className="display mt-4 text-3xl text-fg md:text-4xl">
          One platform, every <span className="kw">real-time</span> surface
        </h2>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
          Instead of stitching together a calling SDK, a chat service, and a streaming provider — with three
          sets of credentials and three ideas of what a user is.
        </p>
      </div>

      <div className="marquee marquee-mask mt-14 flex flex-col gap-4 overflow-hidden">
        <MarqueeRow items={TOP_ROW} durationSeconds={52} />
        <MarqueeRow items={BOTTOM_ROW} durationSeconds={64} reverse />
      </div>
    </section>
  );
}

function MarqueeRow({
  items,
  durationSeconds,
  reverse = false,
}: {
  items: typeof USE_CASES;
  durationSeconds: number;
  reverse?: boolean;
}) {
  // Four copies, not two: the row must overflow the viewport before it
  // can scroll seamlessly, and four cards alone don't on a wide screen.
  const doubled = [...items, ...items, ...items, ...items];

  return (
    <div
      className="marquee-track flex gap-4"
      style={{
        ['--marquee-duration' as string]: `${durationSeconds}s`,
        animationDirection: reverse ? 'reverse' : 'normal',
      }}
    >
      {doubled.map((useCase, i) => (
        <div
          key={`${useCase.title}-${i}`}
          className="w-72 shrink-0 rounded-(--radius-panel) border border-line bg-surface p-5"
          // The second half is a visual duplicate of the first — hide it
          // from assistive tech so the list isn't read out four times.
          aria-hidden={i >= items.length ? true : undefined}
        >
          <h3 className="text-sm font-medium text-fg">{useCase.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{useCase.body}</p>
        </div>
      ))}
    </div>
  );
}
