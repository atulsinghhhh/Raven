import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { PageHeader } from '@/components/ui/page-header';
import { IconExternal } from '@/components/ui/icons';
import { DOCS_URL } from '@/lib/nav';

/**
 * Static reference page for `@ravenkash/cli`: same nature as SDKs and
 * Effects (no per-project data of its own; the CLI doesn't have a
 * dashboard-visible resource, it just calls the same Control API this
 * dashboard does). Command names are transcribed from
 * packages/cli/src/cli.ts's actual `register*Command` calls, not
 * invented: if a command is added or removed there, this list goes
 * stale and should be updated alongside it.
 */
const COMMAND_GROUPS: { name: string; description: string }[] = [
  { name: 'login / logout / whoami', description: 'Browser or token-based auth; check who you’re signed in as.' },
  { name: 'init / dev', description: 'Scaffold a local project config; run a local dev loop against it.' },
  { name: 'projects', description: 'list, create, inspect, use, delete — the same projects this dashboard manages.' },
  { name: 'keys', description: 'list, create, revoke API keys for the active project.' },
  { name: 'rooms', description: 'list, create, inspect RTC rooms.' },
  { name: 'chat', description: 'overview, conversations, connections, presence.' },
  { name: 'streams', description: 'list, create, inspect, update, end live streams.' },
  { name: 'connections / errors', description: 'list and inspect RTC connection and error records.' },
  { name: 'diagnostics / status / logs', description: 'dependency health, current session status, recent activity.' },
  { name: 'sdk', description: 'install a client SDK into the current project directory.' },
  { name: 'config', description: 'read/write local CLI config (e.g. apiUrl).' },
];

export default async function CliPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="CLI"
        description="Manage projects, API keys, rooms, chat, and live streams from the terminal — the same Control API this dashboard uses, over HTTP."
      />

      <Card padded={false}>
        <div className="border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-mono text-sm font-semibold text-fg">@ravenkash/cli</h2>
            <Badge tone="neutral">v0.1.0</Badge>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            Not yet published to a package registry — install locally while Livqeno is in this phase; see the
            installation section of the docs below.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">Install</h3>
              <CodeBlock language="bash" code={'cd packages/cli\npnpm install\npnpm build'} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">Reference</h3>
              <a
                href={`${DOCS_URL}/cli.md`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:underline"
              >
                docs/cli.md
                <IconExternal className="size-3" />
              </a>
            </div>
          </div>

          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-semibold text-muted">Sign in, then use it against this project</h3>
            <CodeBlock
              language="bash"
              code={`raven login\nraven projects use ${projectId}\nraven keys list\nraven rooms list --json`}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Command groups" subtitle="Every top-level command the CLI registers." />
        <ul className="flex flex-col divide-y divide-line">
          {COMMAND_GROUPS.map((group) => (
            <li key={group.name} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
              <span className="font-mono text-xs font-medium text-fg">raven {group.name}</span>
              <span className="text-xs leading-relaxed text-muted">{group.description}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="CI / headless" subtitle="No browser, no writable home directory required." />
        <p className="mb-3 text-sm leading-relaxed text-muted">
          Set <span className="font-mono text-xs text-fg">RAVEN_TOKEN</span> instead of running{' '}
          <span className="font-mono text-xs text-fg">raven login</span> — it takes precedence over a stored session for
          that one process only.
        </p>
        <CodeBlock language="bash" code={'export RAVEN_TOKEN="$CI_SECRET"\nraven projects list --json'} />
      </Card>
    </div>
  );
}
