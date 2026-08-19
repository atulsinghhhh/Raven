import { Reveal } from './Reveal';

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

export function UseCases() {
  return (
    <section className="border-t border-line bg-surface-sunken/40 py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-light tracking-tight text-fg md:text-4xl">Built for what you&apos;re shipping</h2>
            <p className="mt-4 text-muted">
              One real-time platform instead of stitching together a calling SDK, a chat service, and a streaming
              provider.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map((useCase, i) => (
            <Reveal key={useCase.title} delayMs={i * 40}>
              <div className="h-full rounded-(--radius-panel) border border-line bg-surface p-5">
                <h3 className="text-sm font-medium text-fg">{useCase.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{useCase.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
