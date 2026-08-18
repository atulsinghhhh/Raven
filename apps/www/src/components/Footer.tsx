import { DASHBOARD_URL, DISCORD_URL, DOCS_URL, GITHUB_URL } from '../lib/links';
import { DiscordIcon, GitHubIcon } from './icons';

export function Footer() {
  return (
    <footer className="border-t border-line py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 md:flex-row">
        <p className="text-sm text-subtle">Raven is open source, under the MIT license.</p>

        <nav className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted">
          <a href={DOCS_URL} className="transition-colors hover:text-fg">
            Documentation
          </a>
          <a href={DASHBOARD_URL} className="transition-colors hover:text-fg">
            Dashboard
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 transition-colors hover:text-fg">
            <GitHubIcon className="h-4 w-4" />
            GitHub
          </a>
          <a href={DISCORD_URL} target="_blank" rel="noreferrer noopener" className="flex items-center gap-1.5 transition-colors hover:text-fg">
            <DiscordIcon className="h-4 w-4" />
            Discord
          </a>
        </nav>
      </div>
    </footer>
  );
}
