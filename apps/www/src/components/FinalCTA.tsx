import { DASHBOARD_URL, DISCORD_URL, DOCS_ROUTES } from '../lib/links';

/**
 * Left-aligned closing beat, matching the reference's last block: the
 * question, one paragraph, and the same two buttons the hero opened
 * with, plus the community link for anyone who wants to ask first.
 */
export function FinalCTA() {
  return (
    <section className="border-t border-line py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="display text-3xl text-fg md:text-4xl">
          Ready to <span className="kw">build</span>?
        </h2>
        <p className="mt-5 max-w-lg text-base leading-relaxed text-muted">
          Create a project, mint your first token, and join a room — RTC, messaging, live streaming, and effects through
          one API.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-2.5">
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="rounded-(--radius-panel) bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Start building
          </a>
          <a
            href={DOCS_ROUTES.quickstart}
            className="rounded-(--radius-panel) border border-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface"
          >
            Read the quickstart
          </a>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-(--radius-panel) border border-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-line-strong hover:bg-surface"
          >
            Ask in Discord
          </a>
        </div>
      </div>
    </section>
  );
}
