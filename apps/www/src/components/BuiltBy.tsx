import { DEVELOPER_GITHUB_URL, DEVELOPER_X_URL } from '../lib/links';
import { GitHubIcon, XIcon } from './icons';

/**
 * A single credit line, not a team page. Raven is one person's
 * infrastructure — this says so plainly, once, and gets out of the way.
 * Deliberately flat: no photo, no role/title, no card grid — the things
 * that would make this read as a SaaS "our team" section instead of an
 * honest attribution.
 */
export function BuiltBy() {
  return (
    <section className="border-t border-line py-16 md:py-20">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-start gap-8 rounded-(--radius-panel) border border-line bg-surface-sunken/40 p-8 sm:flex-row sm:items-center sm:justify-between md:p-10">
          <div className="max-w-xl">
            <span className="mono-label text-[11px] text-muted">The builder</span>
            <h2 className="display mt-3 text-2xl text-fg md:text-3xl">
              Built by <span className="kw">Atul</span>.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted md:text-base">
              No team, no company behind it — Raven is one developer&apos;s real-time infrastructure, designed,
              built, and run end to end by Atul.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            <a
              href={DEVELOPER_GITHUB_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-(--radius-panel) border border-accent-line px-3.5 py-2 text-[13px] font-medium text-fg transition-colors hover:border-accent-text hover:bg-canvas"
            >
              <GitHubIcon className="h-4 w-4" />
              GitHub
            </a>
            <a
              href={DEVELOPER_X_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded-(--radius-panel) border border-accent-line px-3.5 py-2 text-[13px] font-medium text-fg transition-colors hover:border-accent-text hover:bg-canvas"
            >
              <XIcon className="h-4 w-4" />
              X
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
