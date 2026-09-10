import { DASHBOARD_URL, DOCS_ROUTES, GITHUB_REPO_URL } from '../lib/links';

/**
 * Left-aligned closing beat, matching the reference's last block: the
 * question, one paragraph, and the same two buttons the hero opened
 * with, plus the community link for anyone who wants to ask first.
 */
export function FinalCTA() {
  return (
    <section className="aurora-footer border-t border-line py-28 md:py-40">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="display text-4xl text-fg md:text-6xl">
          Your application.
          <br />
          <span className="kw">Livqeno&apos;s</span> infrastructure.
        </h2>
        <p className="mt-6 max-w-lg text-base leading-relaxed text-muted">
          Create a project, mint your first token, and join a room — RTC, messaging, live streaming, and effects through
          one API.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-2.5">
          <a
            href={`${DASHBOARD_URL}/signup`}
            className="glow-accent rounded-(--radius-panel) bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-fg transition-colors hover:bg-accent-hover"
          >
            Start building
          </a>
          <a
            href={DOCS_ROUTES.quickstart}
            className="rounded-(--radius-panel) border border-accent-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-accent-text hover:bg-canvas"
          >
            Read the quickstart
          </a>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-(--radius-panel) border border-accent-line px-4 py-2.5 text-[13px] font-medium text-fg transition-colors hover:border-accent-text hover:bg-canvas"
          >
            Read the source
          </a>
        </div>
      </div>
    </section>
  );
}
