import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { decodeSessionEmail } from '@/lib/decode-session';
import { ravenApi } from '@/lib/api-client';
import { AccountShell } from '@/components/shell/account-shell';
import { deriveSystemStatus } from '@/components/ui/badge';
import { Card, SectionHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { PageHeader } from '@/components/ui/page-header';
import { IconChevronRight, IconCli, IconExternal, IconGitHub, IconKeys, IconWebhooks } from '@/components/ui/icons';
import { DOCS_URL, GITHUB_URL } from '@/lib/nav';

export const metadata: Metadata = {
  title: 'Developers — Raven',
};

/**
 * The developer hub: every integration surface in one place. API keys and
 * webhooks are project-scoped resources, so those cards link into each
 * project rather than pretending an account-level list exists.
 */

const SDKS = [
  {
    name: '@ravenkash/rtc',
    description: 'Browser RTC client — rooms, tracks, telemetry.',
    install: 'npm install @ravenkash/rtc',
  },
  {
    name: '@ravenkash/react',
    description: 'React hooks and components over the RTC client.',
    install: 'npm install @ravenkash/react',
  },
  {
    name: '@ravenkash/chat',
    description: 'Realtime chat client — conversations, presence, typing.',
    install: 'npm install @ravenkash/chat',
  },
  {
    name: '@ravenkash/server',
    description: 'Node.js server SDK — mint tokens, manage rooms and streams.',
    install: 'npm install @ravenkash/server',
  },
];

export default async function DevelopersPage() {
  const token = await getSessionToken();
  if (!token) redirect('/login');
  const email = decodeSessionEmail(token);

  const [projectsResult, healthResult] = await Promise.allSettled([ravenApi.listProjects(token), ravenApi.getHealth()]);
  const systemStatus =
    healthResult.status === 'fulfilled' ? deriveSystemStatus(healthResult.value.dependencies) : 'unknown';
  const projects =
    projectsResult.status === 'fulfilled' ? projectsResult.value.filter((p) => p.status === 'ACTIVE') : [];

  return (
    <AccountShell email={email} systemStatus={systemStatus}>
      <div className="flex flex-col gap-10">
        <PageHeader
          title="Developers"
          description="SDKs, keys, webhooks, and tooling — everything you integrate against."
          actions={
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded border border-line bg-surface px-3 text-sm text-fg transition-colors hover:bg-surface-raised"
            >
              <IconExternal className="size-3.5" />
              API documentation
            </a>
          }
        />

        <section>
          <SectionHeader title="SDKs" subtitle="Official packages, published from this repository." />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {SDKS.map((sdk) => (
              <Card key={sdk.name} className="flex flex-col gap-3">
                <div>
                  <p className="font-mono text-sm text-fg">{sdk.name}</p>
                  <p className="mt-1 text-sm text-muted">{sdk.description}</p>
                </div>
                <CodeBlock code={sdk.install} language="bash" />
              </Card>
            ))}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <section>
            <SectionHeader title="API keys" subtitle="Keys are scoped to a project and an environment." />
            <ProjectResourceList projects={projects} slug="api-keys" icon={<IconKeys className="size-3.5" />} />
          </section>

          <section>
            <SectionHeader title="Webhooks" subtitle="Signed event deliveries, configured per project." />
            <ProjectResourceList projects={projects} slug="webhooks" icon={<IconWebhooks className="size-3.5" />} />
          </section>
        </div>

        <section>
          <SectionHeader title="Tooling" />
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconCli className="size-4 text-subtle" />
                <p className="text-sm font-medium text-fg">Raven CLI</p>
              </div>
              <p className="text-sm text-muted">Manage projects, keys, and rooms from your terminal.</p>
              <CodeBlock code="npm install -g @ravenkash/cli" language="bash" />
            </Card>
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <IconGitHub className="size-4 text-subtle" />
                <p className="text-sm font-medium text-fg">Examples</p>
              </div>
              <p className="text-sm text-muted">
                Working apps for every product — video calls, chat, live streaming, mobile — in the open-source repo.
              </p>
              <a
                href={`${GITHUB_URL}/tree/main/examples`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-accent-text hover:underline"
              >
                Browse examples
                <IconExternal className="size-3" />
              </a>
            </Card>
          </div>
        </section>
      </div>
    </AccountShell>
  );
}

function ProjectResourceList({
  projects,
  slug,
  icon,
}: {
  projects: Array<{ id: string; name: string }>;
  slug: string;
  icon: React.ReactNode;
}) {
  if (projects.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">
          No projects yet —{' '}
          <Link href="/dashboard/projects?new=1" className="font-medium text-accent-text hover:underline">
            create one
          </Link>{' '}
          to get keys and webhooks.
        </p>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      <ul className="divide-y divide-line">
        {projects.slice(0, 6).map((project) => (
          <li key={project.id}>
            <Link
              href={`/dashboard/projects/${project.id}/${slug}`}
              className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-raised"
            >
              <span className="shrink-0 text-subtle">{icon}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{project.name}</span>
              <IconChevronRight className="size-4 shrink-0 text-subtle" />
            </Link>
          </li>
        ))}
      </ul>
      {projects.length > 6 && (
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          <Link href="/dashboard/projects" className="text-accent-text hover:underline">
            View all {projects.length} projects
          </Link>
        </div>
      )}
    </Card>
  );
}
