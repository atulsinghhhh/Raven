import { Reveal } from './Reveal';

const STEPS = [
  {
    step: '01',
    title: 'Mint a token on your backend',
    body: 'Your server holds the API key and decides who a user is. It asks Raven for a short-lived token scoped to one room and one set of permissions.',
  },
  {
    step: '02',
    title: 'Connect from the client',
    body: 'Hand that token to @raven/rtc, @raven/chat, or @raven/client for live streaming. The SDK never sees your API key — it can only do what the token explicitly grants.',
  },
  {
    step: '03',
    title: 'Build the feature, not the plumbing',
    body: 'Reconnection, presence, diagnostics, and event delivery are handled underneath. You write the call screen, the chat panel, or the stream page.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-24">
      <div className="mx-auto max-w-5xl px-6">
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-fg md:text-4xl">How it works</h2>
            <p className="mt-4 text-muted">
              Your server never hands out its API key. A client only ever holds a
              token that expires and grants exactly what it says.
            </p>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <Reveal key={s.step} delayMs={i * 100}>
              <div className="relative">
                <span className="text-5xl font-bold text-accent/20">{s.step}</span>
                <h3 className="mt-3 text-lg font-semibold text-fg">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
